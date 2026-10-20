import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { as, createTask, createTeamWith, createUser } from './helpers.js';

describe('creating tasks (user story 4)', () => {
  it('creates a personal task with sensible defaults', async () => {
    const user = await createUser();
    const res = await as(user).post('/api/tasks', {
      title: 'Write report',
      description: 'Quarterly numbers',
      dueDate: '2030-01-15',
    });

    assert.equal(res.status, 201);
    assert.match(res.headers.location, /^\/api\/tasks\/\d+$/);
    const task = res.body.data;
    assert.equal(task.title, 'Write report');
    assert.equal(task.description, 'Quarterly numbers');
    assert.equal(task.status, 'open');
    assert.equal(task.priority, 'medium');
    assert.equal(task.dueDate, '2030-01-15T00:00:00.000Z');
    assert.equal(task.teamId, null);
    assert.equal(task.createdBy.id, user.id);
    assert.equal(task.isOverdue, false);
  });

  it('normalises due dates with time zones to UTC', async () => {
    const user = await createUser();
    const task = await createTask(user, { dueDate: '2030-03-01T17:30:00+05:30' });
    assert.equal(task.dueDate, '2030-03-01T12:00:00.000Z');
  });

  it('validates input', async () => {
    const user = await createUser();
    const cases = [
      { title: '' },
      { title: 'x'.repeat(201) },
      { title: 'ok', status: 'nope' },
      { title: 'ok', priority: 'urgent' },
      { title: 'ok', dueDate: 'tomorrow' },
      { title: 'ok', dueDate: '2030-02-31' }, // V8 would silently roll this over to March 3
      { title: 'ok', dueDate: '2030-04-31' },
      { title: 'ok', dueDate: '2030-01-01T24:00:00Z' },
      { title: 'ok', dueDate: '2030-01-01T10:60:00Z' },
      { title: 'ok', dueDate: '2030-01-01T10:00:00' }, // no time zone
      { title: 'ok', assigneeId: '5' },
    ];
    for (const body of cases) {
      const res = await as(user).post('/api/tasks', body);
      assert.equal(res.status, 422, `should reject ${JSON.stringify(body)}`);
    }
  });

  it('creates a task inside a team and refuses teams the user is not in', async () => {
    const owner = await createUser();
    const outsider = await createUser();
    const team = await createTeamWith(owner);

    const ok = await as(owner).post('/api/tasks', { title: 'Team task', teamId: team.id });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.data.team.name, team.name);

    const denied = await as(outsider).post('/api/tasks', { title: 'Sneaky', teamId: team.id });
    assert.equal(denied.status, 404);
  });
});

describe('reading and visibility', () => {
  it('keeps personal tasks private to their creator', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const task = await createTask(alice, { title: 'Secret' });

    assert.equal((await as(bob).get(`/api/tasks/${task.id}`)).status, 404);
    assert.equal((await as(bob).patch(`/api/tasks/${task.id}`, { title: 'x' })).status, 404);
    assert.equal((await as(bob).delete(`/api/tasks/${task.id}`)).status, 404);
    assert.equal((await as(bob).get('/api/tasks')).body.meta.total, 0);
  });

  it('shares team tasks with every team member only', async () => {
    const owner = await createUser();
    const member = await createUser();
    const outsider = await createUser();
    const team = await createTeamWith(owner, [member]);
    const task = await createTask(owner, { title: 'Shared', teamId: team.id });

    assert.equal((await as(member).get(`/api/tasks/${task.id}`)).status, 200);
    assert.equal((await as(outsider).get(`/api/tasks/${task.id}`)).status, 404);
  });

  it('removes access when a member leaves the team', async () => {
    const owner = await createUser();
    const member = await createUser();
    const team = await createTeamWith(owner, [member]);
    const task = await createTask(owner, { teamId: team.id });

    await as(member).delete(`/api/teams/${team.id}/members/${member.id}`);
    assert.equal((await as(member).get(`/api/tasks/${task.id}`)).status, 404);
  });

  it('rejects malformed ids', async () => {
    const user = await createUser();
    assert.equal((await as(user).get('/api/tasks/abc')).status, 422);
    assert.equal((await as(user).get('/api/tasks/-1')).status, 422);
  });
});

describe('updating, completing and deleting (user story 6)', () => {
  it('partially updates a task and bumps updatedAt', async () => {
    const user = await createUser();
    const task = await createTask(user, { title: 'Before', priority: 'low' });
    await new Promise((resolve) => setTimeout(resolve, 5));

    const res = await as(user).patch(`/api/tasks/${task.id}`, { title: 'After', status: 'in_progress' });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.title, 'After');
    assert.equal(res.body.data.status, 'in_progress');
    assert.equal(res.body.data.priority, 'low'); // untouched
    assert.ok(res.body.data.updatedAt > task.updatedAt);
  });

  it('rejects an empty patch and ignores fields that cannot be changed', async () => {
    const user = await createUser();
    const task = await createTask(user);
    assert.equal((await as(user).patch(`/api/tasks/${task.id}`, {})).status, 422);

    const res = await as(user).patch(`/api/tasks/${task.id}`, { title: 'Renamed', createdBy: 999, teamId: 5 });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.createdBy.id, user.id);
    assert.equal(res.body.data.teamId, null);
  });

  it('completes a task, records completedAt, and clears it on reopen', async () => {
    const user = await createUser();
    const task = await createTask(user, { dueDate: '2000-01-01' });
    assert.equal(task.isOverdue, true);

    const done = await as(user).post(`/api/tasks/${task.id}/complete`);
    assert.equal(done.status, 200);
    assert.equal(done.body.data.status, 'completed');
    assert.ok(done.body.data.completedAt);
    assert.equal(done.body.data.isOverdue, false); // finished tasks are never overdue

    const reopened = await as(user).patch(`/api/tasks/${task.id}`, { status: 'open' });
    assert.equal(reopened.body.data.completedAt, null);
    assert.equal(reopened.body.data.isOverdue, true);
  });

  it('lets the creator delete, and 404s afterwards', async () => {
    const user = await createUser();
    const task = await createTask(user);
    assert.equal((await as(user).delete(`/api/tasks/${task.id}`)).status, 204);
    assert.equal((await as(user).get(`/api/tasks/${task.id}`)).status, 404);
  });

  it('restricts team task deletion to the creator or a team owner/admin', async () => {
    const owner = await createUser();
    const alice = await createUser();
    const bob = await createUser();
    const team = await createTeamWith(owner, [alice, bob]);

    const aliceTask = await createTask(alice, { teamId: team.id });
    const denied = await as(bob).delete(`/api/tasks/${aliceTask.id}`);
    assert.equal(denied.status, 403);

    assert.equal((await as(owner).delete(`/api/tasks/${aliceTask.id}`)).status, 204); // owner moderates
    const bobTask = await createTask(bob, { teamId: team.id });
    assert.equal((await as(bob).delete(`/api/tasks/${bobTask.id}`)).status, 204); // creator
  });
});

describe('assignment (user stories 5 and 7)', () => {
  it('assigns a task to a teammate, notifies them, and lists it under ?assignee=me', async () => {
    const owner = await createUser();
    const mate = await createUser();
    const team = await createTeamWith(owner, [mate]);
    const task = await createTask(owner, { title: 'Ship it', teamId: team.id });

    const res = await as(owner).put(`/api/tasks/${task.id}/assignee`, { assigneeId: mate.id });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.assignee.id, mate.id);

    const mine = await as(mate).get('/api/tasks?assignee=me');
    assert.deepEqual(mine.body.data.map((t) => t.id), [task.id]);

    const notes = await as(mate).get('/api/notifications');
    assert.equal(notes.body.data[0].type, 'task_assigned');
    assert.equal(notes.body.data[0].data.taskId, task.id);
  });

  it('can assign at creation and does not notify when assigning yourself', async () => {
    const owner = await createUser();
    const mate = await createUser();
    const team = await createTeamWith(owner, [mate]);

    // Joining the team already produced notifications (team_invite / invite_accepted); compare deltas.
    const count = async (user) => (await as(user).get('/api/notifications/unread-count')).body.data.count;
    const mateBefore = await count(mate);
    const ownerBefore = await count(owner);

    await createTask(owner, { teamId: team.id, assigneeId: mate.id });
    assert.equal(await count(mate), mateBefore + 1);

    await createTask(owner, { teamId: team.id, assigneeId: owner.id });
    assert.equal(await count(owner), ownerBefore); // assigning yourself is not news
  });

  it('refuses assignees outside the team and cross-user personal assignment', async () => {
    const owner = await createUser();
    const outsider = await createUser();
    const team = await createTeamWith(owner);
    const teamTask = await createTask(owner, { teamId: team.id });

    const outside = await as(owner).put(`/api/tasks/${teamTask.id}/assignee`, { assigneeId: outsider.id });
    assert.equal(outside.status, 422);
    assert.equal(outside.body.error.code, 'INVALID_ASSIGNEE');

    const personal = await createTask(owner, {});
    const other = await as(owner).put(`/api/tasks/${personal.id}/assignee`, { assigneeId: outsider.id });
    assert.equal(other.status, 422);
    assert.equal((await as(owner).put(`/api/tasks/${personal.id}/assignee`, { assigneeId: owner.id })).status, 200);
  });

  it('unassigns with null', async () => {
    const owner = await createUser();
    const task = await createTask(owner, { assigneeId: owner.id });
    const res = await as(owner).put(`/api/tasks/${task.id}/assignee`, { assigneeId: null });
    assert.equal(res.body.data.assignee, null);
  });

  it('tells the creator and assignee about updates and completion, but never the actor', async () => {
    const owner = await createUser();
    const mate = await createUser();
    const team = await createTeamWith(owner, [mate]);
    const task = await createTask(owner, { teamId: team.id, assigneeId: mate.id });

    await as(mate).patch(`/api/tasks/${task.id}`, { priority: 'high' });
    await as(mate).post(`/api/tasks/${task.id}/complete`);

    const ownerNotes = (await as(owner).get('/api/notifications')).body.data.map((n) => n.type);
    assert.deepEqual(ownerNotes.slice(0, 2), ['task_completed', 'task_updated']);

    const mateTypes = (await as(mate).get('/api/notifications')).body.data.map((n) => n.type);
    // task_assigned (newest) + the team_invite from joining; nothing about their own edits
    assert.deepEqual(mateTypes, ['task_assigned', 'team_invite']);
  });
});

describe('filtering, searching and sorting (user stories 5, 8, 9)', () => {
  async function seed() {
    const user = await createUser();
    const a = await createTask(user, { title: 'Alpha invoice', description: 'bill the client', status: 'open', priority: 'low', dueDate: '2030-03-01' });
    const b = await createTask(user, { title: 'Bravo', description: 'Review INVOICE draft', status: 'in_progress', priority: 'high', dueDate: '2030-01-01' });
    const c = await createTask(user, { title: 'Charlie', status: 'completed', priority: 'medium' });
    const d = await createTask(user, { title: '100% done_deal', status: 'open', priority: 'high', dueDate: '2001-01-01' });
    return { user, a, b, c, d };
  }
  const ids = (res) => res.body.data.map((t) => t.id).sort((x, y) => x - y);

  it('filters by status, including several at once (user story 8)', async () => {
    const { user, a, b, c, d } = await seed();
    assert.deepEqual(ids(await as(user).get('/api/tasks?status=completed')), [c.id]);
    assert.deepEqual(ids(await as(user).get('/api/tasks?status=open')), [a.id, d.id].sort((x, y) => x - y));
    assert.deepEqual(ids(await as(user).get('/api/tasks?status=open,in_progress')), [a.id, b.id, d.id].sort((x, y) => x - y));
    assert.equal((await as(user).get('/api/tasks?status=bogus')).status, 422);
  });

  it('filters by priority, assignee and overdue', async () => {
    const { user, b, d } = await seed();
    assert.deepEqual(ids(await as(user).get('/api/tasks?priority=high')), [b.id, d.id].sort((x, y) => x - y));
    assert.deepEqual(ids(await as(user).get('/api/tasks?overdue=true')), [d.id]);
    assert.equal((await as(user).get('/api/tasks?assignee=none')).body.meta.total, 4);
    assert.equal((await as(user).get('/api/tasks?assignee=me')).body.meta.total, 0);
  });

  it('searches title and description case-insensitively (user story 9)', async () => {
    const { user, a, b } = await seed();
    assert.deepEqual(ids(await as(user).get('/api/tasks?q=invoice')), [a.id, b.id]);
    assert.deepEqual(ids(await as(user).get('/api/tasks?q=BRAVO')), [b.id]);
    assert.equal((await as(user).get('/api/tasks?q=zzzz')).body.meta.total, 0);
  });

  it('treats % and _ in searches literally', async () => {
    const { user, d } = await seed();
    assert.deepEqual(ids(await as(user).get('/api/tasks?q=' + encodeURIComponent('100%'))), [d.id]);
    assert.deepEqual(ids(await as(user).get('/api/tasks?q=' + encodeURIComponent('done_deal'))), [d.id]);
    assert.equal((await as(user).get('/api/tasks?q=' + encodeURIComponent('%'))).body.meta.total, 1);
    assert.equal((await as(user).get('/api/tasks?q=' + encodeURIComponent('done%deal'))).body.meta.total, 0);
  });

  it('is not vulnerable to SQL injection through search or sort parameters', async () => {
    const { user } = await seed();
    const inj = await as(user).get('/api/tasks?q=' + encodeURIComponent("' OR 1=1 --"));
    assert.equal(inj.status, 200);
    assert.equal(inj.body.meta.total, 0);
    assert.equal((await as(user).get('/api/tasks?sortBy=title;DROP TABLE tasks')).status, 422);
    assert.equal((await as(user).get('/api/tasks')).body.meta.total, 4); // table still intact
  });

  it('sorts by title, priority and due date (undated last)', async () => {
    const { user, a, b, c, d } = await seed();
    const titles = (await as(user).get('/api/tasks?sortBy=title&order=asc')).body.data.map((t) => t.title);
    assert.deepEqual(titles, ['100% done_deal', 'Alpha invoice', 'Bravo', 'Charlie']);

    const byPriority = (await as(user).get('/api/tasks?sortBy=priority&order=desc')).body.data.map((t) => t.priority);
    assert.equal(byPriority[0], 'high');
    assert.equal(byPriority.at(-1), 'low');

    const asc = (await as(user).get('/api/tasks?sortBy=dueDate&order=asc')).body.data.map((t) => t.id);
    assert.deepEqual(asc, [d.id, b.id, a.id, c.id]);
    const desc = (await as(user).get('/api/tasks?sortBy=dueDate&order=desc')).body.data.map((t) => t.id);
    assert.deepEqual(desc, [a.id, b.id, d.id, c.id]); // c has no due date: still last
  });

  it('filters by due-date range', async () => {
    const { user, a, b } = await seed();
    const res = await as(user).get('/api/tasks?dueAfter=2029-12-01&dueBefore=2030-12-31');
    assert.deepEqual(ids(res), [a.id, b.id]);
  });

  it('paginates and reports totals', async () => {
    const { user } = await seed();
    const page1 = await as(user).get('/api/tasks?limit=3&page=1&sortBy=title&order=asc');
    const page2 = await as(user).get('/api/tasks?limit=3&page=2&sortBy=title&order=asc');
    assert.equal(page1.body.data.length, 3);
    assert.equal(page2.body.data.length, 1);
    assert.deepEqual(page1.body.meta, { page: 1, limit: 3, total: 4, totalPages: 2 });
    assert.equal((await as(user).get('/api/tasks?limit=1000')).status, 422);
  });

  it('scopes to personal tasks or a single team', async () => {
    const user = await createUser();
    const team = await createTeamWith(user);
    const personal = await createTask(user, { title: 'mine' });
    const shared = await createTask(user, { title: 'ours', teamId: team.id });

    assert.deepEqual((await as(user).get('/api/tasks?teamId=personal')).body.data.map((t) => t.id), [personal.id]);
    assert.deepEqual((await as(user).get(`/api/tasks?teamId=${team.id}`)).body.data.map((t) => t.id), [shared.id]);
  });
});
