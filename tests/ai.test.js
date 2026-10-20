import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { as, createTask, createTeamWith, createUser } from './helpers.js';

describe('generative AI assist (user story 14) - offline mock provider', () => {
  it('drafts a description from a title', async () => {
    const user = await createUser();
    const res = await as(user).post('/api/ai/task-description', { title: 'Migrate billing to Stripe' });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.provider, 'mock');
    assert.match(res.body.data.description, /Migrate billing to Stripe/);
    assert.match(res.body.data.description, /Acceptance criteria:/);
  });

  it('validates the title and requires authentication', async () => {
    const user = await createUser();
    assert.equal((await as(user).post('/api/ai/task-description', { title: '' })).status, 422);
    const anon = await import('supertest').then(({ default: request }) =>
      import('./helpers.js').then(({ app }) => request(app).post('/api/ai/task-description').send({ title: 'x' }))
    );
    assert.equal(anon.status, 401);
  });

  it('auto-fills the description when a task is created with generateDescription', async () => {
    const user = await createUser();
    const res = await as(user).post('/api/tasks', { title: 'Plan offsite', generateDescription: true });
    assert.equal(res.status, 201);
    assert.match(res.body.data.description, /Plan offsite/);
  });

  it('never overwrites a description the user wrote', async () => {
    const user = await createUser();
    const res = await as(user).post('/api/tasks', {
      title: 'Plan offsite',
      description: 'My own words',
      generateDescription: true,
    });
    assert.equal(res.body.data.description, 'My own words');
  });

  it('summarises a task and its comments', async () => {
    const owner = await createUser();
    const mate = await createUser();
    const team = await createTeamWith(owner, [mate]);
    const task = await createTask(owner, { teamId: team.id, assigneeId: mate.id, title: 'Fix login bug' });
    await as(mate).post(`/api/tasks/${task.id}/comments`, { body: 'Reproduced on Safari' });

    const res = await as(owner).post(`/api/ai/tasks/${task.id}/summary`);
    assert.equal(res.status, 200);
    assert.match(res.body.data.summary, /1 comment/);
    assert.match(res.body.data.summary, /Reproduced on Safari/);
  });

  it('will not summarise tasks the caller cannot see', async () => {
    const owner = await createUser();
    const outsider = await createUser();
    const task = await createTask(owner);
    assert.equal((await as(outsider).post(`/api/ai/tasks/${task.id}/summary`)).status, 404);
  });
});
