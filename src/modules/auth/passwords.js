import bcrypt from 'bcryptjs';
import config from '../../config/index.js';

/**
 * Password hashing with bcrypt (via bcryptjs, a pure-JavaScript implementation that installs
 * everywhere - Windows, macOS, Linux, containers - without native compilation).
 *
 * bcrypt salts every hash automatically and its cost factor makes brute-forcing expensive.
 * Plain-text passwords are never stored or logged.
 */
export function hashPassword(plain) {
  return bcrypt.hash(plain, config.auth.bcryptRounds);
}

// A throw-away hash used to burn the same amount of CPU when the e-mail does not exist, so response
// time does not reveal whether an account is registered (user-enumeration timing attack).
const DUMMY_HASH = bcrypt.hashSync('timing-attack-mitigation', config.auth.bcryptRounds);

/** Compares a plain password with a stored hash. Pass `null` hash for "no such user". */
export async function verifyPassword(plain, hashOrNull) {
  const matches = await bcrypt.compare(plain, hashOrNull ?? DUMMY_HASH);
  return hashOrNull !== null && hashOrNull !== undefined && matches;
}
