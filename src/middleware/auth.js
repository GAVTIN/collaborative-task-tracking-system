import { authenticateToken } from '../modules/auth/tokens.js';
import { HttpError } from '../utils/http-error.js';

/**
 * Requires `Authorization: Bearer <jwt>`.
 * On success it sets:
 *   req.user  -> { id, name, email }
 *   req.auth  -> { jti, exp }   (needed by logout to revoke this exact token)
 */
export function authenticate(req, _res, next) {
  const header = req.get('authorization') ?? '';
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match) {
    throw HttpError.unauthorized('Missing or malformed Authorization header. Expected "Authorization: Bearer <token>"');
  }

  const { user, jti, exp } = authenticateToken(match[1]);
  req.user = user;
  req.auth = { jti, exp };
  next();
}
