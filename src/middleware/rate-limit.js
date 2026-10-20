import rateLimit from 'express-rate-limit';
import config from '../config/index.js';
import { HttpError } from '../utils/http-error.js';

const passthrough = (_req, _res, next) => next();

function createLimiter({ windowMs, limit }, message, keyGenerator) {
  if (!config.rateLimit.enabled) return passthrough;
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7', // RateLimit / RateLimit-Policy headers
    legacyHeaders: false,
    ...(keyGenerator ? { keyGenerator } : {}),
    // Route through the central error handler so 429s use the same JSON envelope.
    handler: (_req, _res, next) => next(new HttpError(429, 'RATE_LIMITED', message)),
  });
}

/** Broad safety net for the whole API (per client IP). */
export const generalLimiter = createLimiter(
  config.rateLimit.general,
  'Too many requests, please slow down and try again later'
);

/** Strict limit on register/login to slow down password guessing and account spam. */
export const authLimiter = createLimiter(
  config.rateLimit.auth,
  'Too many authentication attempts, please try again later'
);

/** AI calls cost money, so they are limited per authenticated user rather than per IP. */
export const aiLimiter = createLimiter(
  config.rateLimit.ai,
  'AI request limit reached, please wait a minute and try again',
  (req) => `user:${req.user.id}`
);
