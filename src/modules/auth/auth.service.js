import config from '../../config/index.js';
import { prepare } from '../../db/index.js';
import { HttpError } from '../../utils/http-error.js';
import { findUserByEmail, findUserById, toPublicUser } from '../users/users.service.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { revokeToken, signToken } from './tokens.js';

/** What register / login / change-password return: the user plus a ready-to-use bearer token. */
function createSession(userRow) {
  return {
    user: toPublicUser(userRow),
    token: signToken(userRow),
    tokenType: 'Bearer',
    expiresIn: config.auth.expiresInSeconds,
  };
}

export async function register({ name, email, password }) {
  if (findUserByEmail(email)) {
    throw HttpError.conflict('An account with this email already exists', 'EMAIL_TAKEN');
  }

  const passwordHash = await hashPassword(password);
  let userId;
  try {
    userId = prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)').run(
      name,
      email,
      passwordHash
    ).lastInsertRowid;
  } catch (err) {
    // Two simultaneous sign-ups with the same e-mail: the UNIQUE index is the final arbiter.
    if (err?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw HttpError.conflict('An account with this email already exists', 'EMAIL_TAKEN');
    }
    throw err;
  }

  return createSession(findUserById(Number(userId)));
}

export async function login({ email, password }) {
  const row = findUserByEmail(email);
  const valid = await verifyPassword(password, row?.password_hash ?? null);

  // One generic message for "unknown e-mail" and "wrong password" so attackers cannot probe for accounts.
  if (!row || !valid) {
    throw HttpError.unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
  }
  return createSession(row);
}

/** Logout = put this token's id on the deny-list until it would have expired anyway. */
export function logout({ jti, exp }) {
  revokeToken(jti, exp);
}
