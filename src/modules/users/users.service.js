import { prepare } from '../../db/index.js';
import { HttpError } from '../../utils/http-error.js';
import { buildSet } from '../../utils/sql.js';
import { nowIso } from '../../utils/time.js';
import { hashPassword, verifyPassword } from '../auth/passwords.js';
import { signToken } from '../auth/tokens.js';
import config from '../../config/index.js';

/** The only shape in which a user ever leaves the API - note: no password hash, no token version. */
export function toPublicUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    jobTitle: row.job_title ?? null,
    bio: row.bio ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Minimal embeddable reference used inside tasks, comments, etc. */
export function toUserRef(id, name) {
  return id == null ? null : { id, name };
}

export const findUserById = (id) => prepare('SELECT * FROM users WHERE id = ?').get(id);
export const findUserByEmail = (email) => prepare('SELECT * FROM users WHERE email = ?').get(email);

export function getProfile(userId) {
  const row = findUserById(userId);
  if (!row) throw HttpError.notFound('User not found', 'USER_NOT_FOUND');
  return toPublicUser(row);
}

export function updateProfile(userId, patch) {
  const { sets, params } = buildSet(patch, { name: 'name', jobTitle: 'job_title', bio: 'bio' });
  if (sets.length > 0) {
    prepare(`UPDATE users SET ${sets.join(', ')}, updated_at = @now WHERE id = @id`).run({
      ...params,
      now: nowIso(),
      id: userId,
    });
  }
  return getProfile(userId);
}

/**
 * Changes the password after re-checking the current one. Incrementing `token_version` instantly
 * invalidates every token issued before this moment (all other devices are signed out); the caller
 * gets a fresh token so the current client stays signed in.
 */
export async function changePassword(userId, { currentPassword, newPassword }) {
  const row = findUserById(userId);
  if (!row) throw HttpError.notFound('User not found', 'USER_NOT_FOUND');

  if (!(await verifyPassword(currentPassword, row.password_hash))) {
    throw HttpError.unauthorized('Current password is incorrect', 'INVALID_CREDENTIALS');
  }
  if (currentPassword === newPassword) {
    throw HttpError.unprocessable('New password must be different from the current one', undefined, 'PASSWORD_UNCHANGED');
  }

  const passwordHash = await hashPassword(newPassword);
  prepare(
    'UPDATE users SET password_hash = ?, token_version = token_version + 1, updated_at = ? WHERE id = ?'
  ).run(passwordHash, nowIso(), userId);

  const updated = findUserById(userId);
  return {
    user: toPublicUser(updated),
    token: signToken(updated),
    tokenType: 'Bearer',
    expiresIn: config.auth.expiresInSeconds,
  };
}
