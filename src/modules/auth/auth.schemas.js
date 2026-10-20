import { z } from 'zod';
import { text } from '../../utils/schemas.js';

/** E-mails are trimmed and lower-cased so "Ann@Example.com " and "ann@example.com" are one account. */
export const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'Email must be at most 254 characters')
  .pipe(z.email('Must be a valid email address'));

/**
 * Password policy: 8+ characters with at least one letter and one number.
 * The upper bound is bcrypt's hard limit - it silently ignores anything beyond 72 bytes,
 * so longer passwords are rejected rather than quietly truncated.
 */
export const newPassword = z
  .string()
  .min(8, 'Password must be at least 8 characters long')
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be at most 72 bytes long')
  .refine((value) => /[A-Za-z]/.test(value) && /\d/.test(value), 'Password must contain at least one letter and one number');

export const registerBody = z.object({
  name: text(100, 'Name'),
  email,
  password: newPassword,
});

export const loginBody = z.object({
  email,
  password: z.string().min(1, 'Password is required').max(200),
});
