import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import config from '../../config/index.js';
import { prepare } from '../../db/index.js';
import { HttpError } from '../../utils/http-error.js';

/**
 * JWT session handling.
 *
 * A token is a signed (HS256) JWT:
 *   sub  user id
 *   jti  unique token id        -> lets us revoke ONE token on logout
 *   tv   user.token_version     -> lets us revoke ALL tokens of a user (password change)
 *   exp  expiry (default 1 h)
 *
 * On every request the middleware verifies the signature + expiry, loads the user, and checks both
 * the version and the deny-list. That one cheap indexed lookup is the price of real logout.
 */

export function signToken(user) {
  return jwt.sign({ tv: user.token_version }, config.auth.jwtSecret, {
    algorithm: 'HS256',
    issuer: config.auth.issuer,
    subject: String(user.id),
    jwtid: crypto.randomUUID(),
    expiresIn: config.auth.expiresInSeconds,
  });
}

/**
 * Fully authenticates a bearer token and returns the user it belongs to.
 * @throws {HttpError} 401 when the token is malformed, expired, revoked or superseded
 */
export function authenticateToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, config.auth.jwtSecret, {
      algorithms: ['HS256'], // pin the algorithm - never trust the token header to choose it
      issuer: config.auth.issuer,
    });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw HttpError.unauthorized('Token has expired, please log in again', 'TOKEN_EXPIRED');
    }
    throw HttpError.unauthorized('Invalid authentication token', 'INVALID_TOKEN');
  }

  const row = prepare('SELECT id, name, email, token_version FROM users WHERE id = ?').get(Number(payload.sub));
  if (!row || row.token_version !== payload.tv) {
    throw HttpError.unauthorized('Token is no longer valid, please log in again', 'INVALID_TOKEN');
  }
  if (prepare('SELECT 1 FROM revoked_tokens WHERE jti = ?').get(payload.jti)) {
    throw HttpError.unauthorized('Token has been revoked (logged out)', 'TOKEN_REVOKED');
  }

  return { user: { id: row.id, name: row.name, email: row.email }, jti: payload.jti, exp: payload.exp };
}

/** Adds a token to the deny-list until the moment it would have expired anyway. */
export function revokeToken(jti, exp) {
  prepare('INSERT OR IGNORE INTO revoked_tokens (jti, expires_at) VALUES (?, ?)').run(jti, exp);
}

/** Housekeeping: deny-list rows for already-expired tokens serve no purpose. */
export function purgeExpiredTokens() {
  const nowSeconds = Math.floor(Date.now() / 1000);
  return prepare('DELETE FROM revoked_tokens WHERE expires_at < ?').run(nowSeconds).changes;
}
