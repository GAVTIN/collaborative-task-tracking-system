import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { app } from './helpers.js';

describe('application plumbing', () => {
  it('GET /health responds without authentication', async () => {
    const res = await request(app).get('/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
  });

  it('returns a JSON 404 envelope for unknown routes', async () => {
    const res = await request(app).get('/api/does-not-exist');
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'ROUTE_NOT_FOUND');
  });

  it('returns 400 INVALID_JSON for malformed JSON bodies', async () => {
    const res = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{ not json');
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'INVALID_JSON');
  });

  it('sets security headers and hides the framework', async () => {
    const res = await request(app).get('/health');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['x-powered-by'], undefined);
  });

  it('requires authentication on protected routes', async () => {
    for (const path of ['/api/users/me', '/api/tasks', '/api/teams', '/api/notifications', '/api/invites']) {
      const res = await request(app).get(path);
      assert.equal(res.status, 401, `${path} should be protected`);
      assert.equal(res.body.error.code, 'UNAUTHORIZED');
    }
  });
});
