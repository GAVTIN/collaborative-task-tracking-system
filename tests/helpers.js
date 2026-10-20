import './setup-env.js'; // keep first: configures the environment before the app is loaded
import assert from 'node:assert/strict';
import fs from 'node:fs';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { migrate } from '../src/db/migrate.js';

migrate();

export const app = createApp();
export const uploadDir = process.env.UPLOAD_DIR;
export const countUploadedFiles = () => fs.readdirSync(uploadDir).length;

let counter = 0;

/** Registers a brand-new user through the real API and returns { id, name, email, token, password }. */
export async function createUser(overrides = {}) {
  counter += 1;
  const body = {
    name: overrides.name ?? `Test User ${counter}`,
    email: overrides.email ?? `user${counter}.${Date.now()}@example.com`,
    password: overrides.password ?? 'Password123',
  };
  const res = await request(app).post('/api/auth/register').send(body);
  assert.equal(res.status, 201, `register failed: ${JSON.stringify(res.body)}`);
  return { ...res.body.data.user, token: res.body.data.token, password: body.password };
}

/** A tiny supertest wrapper that sends the user's bearer token on every call. */
export function as(user) {
  const authed = (req) => req.set('Authorization', `Bearer ${user.token}`);
  return {
    get: (url) => authed(request(app).get(url)),
    post: (url, body) => authed(request(app).post(url)).send(body),
    put: (url, body) => authed(request(app).put(url)).send(body),
    patch: (url, body) => authed(request(app).patch(url)).send(body),
    delete: (url) => authed(request(app).delete(url)),
    /** Multipart upload helper: attach('/api/tasks/1/attachments', Buffer, 'name.txt') */
    attach: (url, buffer, filename) => authed(request(app).post(url)).attach('file', buffer, filename),
  };
}

/** Creates a team owned by `owner`; every user in `members` is invited and joins as a regular member. */
export async function createTeamWith(owner, members = [], name = 'Team Rocket') {
  const created = await as(owner).post('/api/teams', { name });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const team = created.body.data;

  for (const member of members) {
    const invite = await as(owner).post(`/api/teams/${team.id}/invites`, { email: member.email });
    assert.equal(invite.status, 201, JSON.stringify(invite.body));
    const accepted = await as(member).post(`/api/invites/${invite.body.data.token}/accept`);
    assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  }
  return team;
}

/** Creates a task and returns it (asserts success). */
export async function createTask(user, body) {
  const res = await as(user).post('/api/tasks', { title: 'A task', ...body });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.data;
}
