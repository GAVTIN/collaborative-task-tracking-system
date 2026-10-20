import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { app, as, createUser } from './helpers.js';

describe('registration (user story 1)', () => {
  it('creates an account and returns a token without leaking secrets', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Ada Lovelace', email: 'ada@example.com', password: 'Analytical1' });

    assert.equal(res.status, 201);
    const { user, token, tokenType, expiresIn } = res.body.data;
    assert.equal(user.name, 'Ada Lovelace');
    assert.equal(user.email, 'ada@example.com');
    assert.ok(token.split('.').length === 3, 'token is a JWT');
    assert.equal(tokenType, 'Bearer');
    assert.ok(expiresIn > 0);
    assert.ok(!JSON.stringify(res.body).toLowerCase().includes('password'), 'no password material in the response');
  });

  it('rejects a duplicate e-mail, ignoring case and whitespace', async () => {
    await request(app).post('/api/auth/register').send({ name: 'One', email: 'dup@example.com', password: 'Password1' });
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Two', email: '  DUP@Example.com ', password: 'Password1' });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'EMAIL_TAKEN');
  });

  it('validates input and reports every problem with its field path', async () => {
    const res = await request(app).post('/api/auth/register').send({ name: '', email: 'nope', password: 'short' });
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    const paths = res.body.error.details.map((d) => d.path);
    assert.ok(paths.includes('body.name'));
    assert.ok(paths.includes('body.email'));
    assert.ok(paths.includes('body.password'));
  });

  it('enforces the password policy (letter + number, max 72 bytes)', async () => {
    const base = { name: 'Pat', email: 'pat@example.com' };
    for (const password of ['onlyletters', '12345678', 'a1'.repeat(40)]) {
      const res = await request(app).post('/api/auth/register').send({ ...base, password });
      assert.equal(res.status, 422, `"${password.slice(0, 12)}..." should be rejected`);
    }
  });
});

describe('login (user story 2)', () => {
  it('returns a working token for correct credentials', async () => {
    const user = await createUser();
    const res = await request(app).post('/api/auth/login').send({ email: user.email, password: user.password });
    assert.equal(res.status, 200);

    const me = await request(app).get('/api/users/me').set('Authorization', `Bearer ${res.body.data.token}`);
    assert.equal(me.status, 200);
    assert.equal(me.body.data.email, user.email);
  });

  it('gives the same generic error for a wrong password and an unknown e-mail', async () => {
    const user = await createUser();
    const wrongPassword = await request(app).post('/api/auth/login').send({ email: user.email, password: 'Wrong-pass-1' });
    const unknownUser = await request(app).post('/api/auth/login').send({ email: 'ghost@example.com', password: 'Whatever1' });

    for (const res of [wrongPassword, unknownUser]) {
      assert.equal(res.status, 401);
      assert.equal(res.body.error.code, 'INVALID_CREDENTIALS');
      assert.equal(res.body.error.message, 'Invalid email or password');
    }
  });

  it('is case-insensitive on the e-mail address', async () => {
    const user = await createUser({ email: 'MixedCase@Example.com' });
    const res = await request(app).post('/api/auth/login').send({ email: 'mixedcase@example.com', password: user.password });
    assert.equal(res.status, 200);
  });
});

describe('token handling', () => {
  it('rejects missing, malformed and forged tokens', async () => {
    const user = await createUser();
    const bad = [
      undefined,
      'Bearer',
      'Bearer not.a.jwt',
      `Bearer ${jwt.sign({ tv: 0 }, 'some-other-secret', { subject: String(user.id) })}`,
      // an "alg: none" token must never be accepted
      `Bearer ${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: String(user.id), tv: 0 })).toString('base64url')}.`,
    ];
    for (const header of bad) {
      const req = request(app).get('/api/users/me');
      if (header) req.set('Authorization', header);
      const res = await req;
      assert.equal(res.status, 401, `header "${header}" should be rejected`);
    }
  });

  it('reports expired tokens distinctly', async () => {
    const user = await createUser();
    const expired = jwt.sign(
      { tv: 0, exp: Math.floor(Date.now() / 1000) - 60 },
      process.env.JWT_SECRET,
      { algorithm: 'HS256', issuer: 'task-tracker-api', subject: String(user.id), jwtid: 'expired-token' }
    );
    const res = await request(app).get('/api/users/me').set('Authorization', `Bearer ${expired}`);
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'TOKEN_EXPIRED');
  });
});

describe('logout (user story 12)', () => {
  it('revokes the token so it can no longer be used', async () => {
    const user = await createUser();
    assert.equal((await as(user).get('/api/users/me')).status, 200);

    const out = await as(user).post('/api/auth/logout');
    assert.equal(out.status, 204);

    const after = await as(user).get('/api/users/me');
    assert.equal(after.status, 401);
    assert.equal(after.body.error.code, 'TOKEN_REVOKED');
  });

  it('only revokes the token that was used - other sessions keep working', async () => {
    const user = await createUser();
    const second = await request(app).post('/api/auth/login').send({ email: user.email, password: user.password });
    const secondUser = { token: second.body.data.token };

    await as(user).post('/api/auth/logout');
    assert.equal((await as(secondUser).get('/api/users/me')).status, 200);
  });
});

describe('profile (user story 3)', () => {
  it('shows the profile and updates name, job title and bio', async () => {
    const user = await createUser({ name: 'Original Name' });

    const updated = await as(user).patch('/api/users/me', { name: 'New Name', jobTitle: 'Engineer', bio: 'Hello!' });
    assert.equal(updated.status, 200);
    assert.deepEqual(
      [updated.body.data.name, updated.body.data.jobTitle, updated.body.data.bio],
      ['New Name', 'Engineer', 'Hello!']
    );

    const fetched = await as(user).get('/api/users/me');
    assert.equal(fetched.body.data.name, 'New Name');
  });

  it('clears optional fields with null and rejects empty updates', async () => {
    const user = await createUser();
    await as(user).patch('/api/users/me', { jobTitle: 'Temp' });
    const cleared = await as(user).patch('/api/users/me', { jobTitle: null });
    assert.equal(cleared.body.data.jobTitle, null);

    const empty = await as(user).patch('/api/users/me', {});
    assert.equal(empty.status, 422);
  });

  it('does not let clients change e-mail, id or password hash through the profile endpoint', async () => {
    const user = await createUser();
    const res = await as(user).patch('/api/users/me', { name: 'Same', email: 'hacker@example.com', id: 9999 });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.email, user.email);
    assert.equal(res.body.data.id, user.id);
  });
});

describe('password change', () => {
  it('requires the current password, then signs out every other session', async () => {
    const user = await createUser();

    const wrong = await as(user).put('/api/users/me/password', { currentPassword: 'Nope12345', newPassword: 'BrandNew789' });
    assert.equal(wrong.status, 401);

    const changed = await as(user).put('/api/users/me/password', {
      currentPassword: user.password,
      newPassword: 'BrandNew789',
    });
    assert.equal(changed.status, 200);

    // The pre-change token is dead, the fresh one works.
    assert.equal((await as(user).get('/api/users/me')).status, 401);
    const fresh = { token: changed.body.data.token };
    assert.equal((await as(fresh).get('/api/users/me')).status, 200);

    // Old password no longer logs in; new one does.
    const oldLogin = await request(app).post('/api/auth/login').send({ email: user.email, password: user.password });
    assert.equal(oldLogin.status, 401);
    const newLogin = await request(app).post('/api/auth/login').send({ email: user.email, password: 'BrandNew789' });
    assert.equal(newLogin.status, 200);
  });
});
