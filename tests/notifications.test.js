import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import request from 'supertest';
import hub from '../src/modules/notifications/hub.js';
import { app, as, createTask, createTeamWith, createUser } from './helpers.js';

describe('notification inbox (user story 13)', () => {
  async function setup() {
    const owner = await createUser();
    const mate = await createUser();
    const team = await createTeamWith(owner, [mate]);
    return { owner, mate, team };
  }

  it('lists, counts and marks notifications as read', async () => {
    const { owner, mate, team } = await setup();
    await as(mate).post('/api/notifications/read-all'); // clear the team_invite received while joining
    await createTask(owner, { teamId: team.id, assigneeId: mate.id, title: 'One' });
    await createTask(owner, { teamId: team.id, assigneeId: mate.id, title: 'Two' });

    assert.equal((await as(mate).get('/api/notifications/unread-count')).body.data.count, 2);

    const list = await as(mate).get('/api/notifications?unread=true');
    assert.equal(list.body.data.length, 2);
    assert.equal(list.body.data[0].read, false);
    assert.match(list.body.data[0].message, /Two/); // newest first

    const read = await as(mate).patch(`/api/notifications/${list.body.data[0].id}/read`);
    assert.equal(read.body.data.read, true);
    assert.equal((await as(mate).get('/api/notifications/unread-count')).body.data.count, 1);
    assert.equal((await as(mate).get('/api/notifications?unread=true')).body.data.length, 1);

    const all = await as(mate).post('/api/notifications/read-all');
    assert.equal(all.body.data.updated, 1);
    assert.equal((await as(mate).get('/api/notifications/unread-count')).body.data.count, 0);
  });

  it("never exposes another user's notifications", async () => {
    const { owner, mate, team } = await setup();
    await createTask(owner, { teamId: team.id, assigneeId: mate.id });
    const id = (await as(mate).get('/api/notifications')).body.data[0].id;

    assert.equal((await as(owner).patch(`/api/notifications/${id}/read`)).status, 404);
    const ownerIds = (await as(owner).get('/api/notifications')).body.data.map((n) => n.id);
    assert.ok(!ownerIds.includes(id));
  });
});

/**
 * Real-time delivery needs a real socket, so these tests start the app on an ephemeral port and read
 * the Server-Sent Events stream with node's http client.
 */
describe('real-time stream over SSE (user story 13)', () => {
  const server = http.createServer(app);
  const ready = new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  after(() => {
    hub.closeAll();
    server.closeAllConnections();
    server.close();
  });

  /** Opens an SSE stream and collects parsed events; returns helpers to await them and close. */
  async function openStream(path, headers = {}) {
    await ready;
    const { port } = server.address();
    const events = [];
    const waiters = [];
    let buffer = '';

    const response = await new Promise((resolve, reject) => {
      const req = http.get({ host: '127.0.0.1', port, path, headers }, resolve);
      req.on('error', reject);
    });

    if (response.statusCode !== 200) {
      let body = '';
      response.on('data', (chunk) => (body += chunk));
      await new Promise((resolve) => response.on('end', resolve));
      return { status: response.statusCode, body: JSON.parse(body), headers: response.headers };
    }

    response.setEncoding('utf8');
    response.on('data', (chunk) => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const event = { id: null, event: 'message', data: null };
        for (const line of frame.split('\n')) {
          if (line.startsWith('id: ')) event.id = line.slice(4);
          else if (line.startsWith('event: ')) event.event = line.slice(7);
          else if (line.startsWith('data: ')) event.data = JSON.parse(line.slice(6));
        }
        if (event.data !== null) {
          events.push(event);
          waiters.splice(0).forEach((wake) => wake());
        }
      }
    });

    /** Resolves once an event matching `predicate` has arrived (or rejects after 3 s). */
    const next = (predicate) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timed out waiting for SSE event')), 3000);
        const check = () => {
          const found = events.find(predicate);
          if (found) {
            clearTimeout(timer);
            resolve(found);
          } else {
            waiters.push(check);
          }
        };
        check();
      });

    return { status: 200, headers: response.headers, events, next, close: () => response.destroy() };
  }

  it('rejects unauthenticated stream requests', async () => {
    const stream = await openStream('/api/notifications/stream');
    assert.equal(stream.status, 401);
  });

  it('pushes a notification the moment it is created (bearer auth)', async () => {
    const owner = await createUser();
    const mate = await createUser();
    const team = await createTeamWith(owner, [mate]);

    const stream = await openStream('/api/notifications/stream', { Authorization: `Bearer ${mate.token}` });
    assert.equal(stream.status, 200);
    assert.match(stream.headers['content-type'], /text\/event-stream/);
    await stream.next((e) => e.event === 'ready');

    await createTask(owner, { teamId: team.id, assigneeId: mate.id, title: 'Live task' });
    const pushed = await stream.next((e) => e.event === 'notification');
    assert.equal(pushed.data.type, 'task_assigned');
    assert.match(pushed.data.message, /Live task/);
    assert.equal(pushed.id, String(pushed.data.id));
    stream.close();
  });

  it('works with a one-time stream ticket (browser EventSource)', async () => {
    const user = await createUser();
    const issued = await as(user).post('/api/notifications/stream-ticket');
    assert.equal(issued.status, 201);
    const { ticket } = issued.body.data;

    const stream = await openStream(`/api/notifications/stream?ticket=${ticket}`);
    assert.equal(stream.status, 200);
    await stream.next((e) => e.event === 'ready');
    stream.close();

    const reused = await openStream(`/api/notifications/stream?ticket=${ticket}`);
    assert.equal(reused.status, 401);
    assert.equal(reused.body.error.code, 'INVALID_TICKET');
  });

  it('replays missed notifications from Last-Event-ID on reconnect', async () => {
    const owner = await createUser();
    const mate = await createUser();
    const team = await createTeamWith(owner, [mate]);
    await createTask(owner, { teamId: team.id, assigneeId: mate.id, title: 'First' });
    await createTask(owner, { teamId: team.id, assigneeId: mate.id, title: 'Second' });

    const [newest, oldest] = (await as(mate).get('/api/notifications')).body.data;
    const stream = await openStream('/api/notifications/stream', {
      Authorization: `Bearer ${mate.token}`,
      'Last-Event-ID': String(oldest.id),
    });
    const replayed = await stream.next((e) => e.event === 'notification');
    assert.equal(replayed.data.id, newest.id); // only what came after the last seen id
    assert.equal(stream.events.filter((e) => e.event === 'notification').length, 1);
    stream.close();
  });

  it('delivers only to the intended user', async () => {
    const owner = await createUser();
    const mate = await createUser();
    const bystander = await createUser();
    const team = await createTeamWith(owner, [mate]);

    const stream = await openStream('/api/notifications/stream', { Authorization: `Bearer ${bystander.token}` });
    await stream.next((e) => e.event === 'ready');
    await createTask(owner, { teamId: team.id, assigneeId: mate.id });
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(stream.events.filter((e) => e.event === 'notification').length, 0);
    stream.close();
  });

  it('unsubscribes when the client disconnects', async () => {
    const user = await createUser();
    const before = hub.connectionCount();
    const stream = await openStream('/api/notifications/stream', { Authorization: `Bearer ${user.token}` });
    await stream.next((e) => e.event === 'ready');
    assert.equal(hub.connectionCount(), before + 1);

    stream.close();
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(hub.connectionCount(), before);
  });
});

describe('plain request sanity', () => {
  it('requires authentication for the ticket endpoint', async () => {
    assert.equal((await request(app).post('/api/notifications/stream-ticket')).status, 401);
  });
});
