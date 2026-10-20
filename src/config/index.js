/**
 * Central configuration.
 *
 * Every tunable value is read from environment variables here (and only here),
 * validated once at start-up, and exported as a plain object. The rest of the
 * code base imports `config` instead of touching `process.env` directly, which
 * keeps configuration discoverable and easy to override in tests.
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const env = process.env.NODE_ENV || 'development';
const isProd = env === 'production';
const isTest = env === 'test';

/** Reads an integer env var, falling back to a default; fails fast on garbage. */
function int(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value)) {
    throw new Error(`Environment variable ${name} must be an integer (received "${raw}")`);
  }
  return value;
}

/**
 * The JWT signing secret must never be a hard-coded default.
 *  - production: required, at least 32 characters
 *  - development: a random per-process secret is generated (tokens die on restart)
 */
function resolveJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (secret) {
    if (isProd && secret.length < 32) {
      throw new Error('JWT_SECRET must be at least 32 characters long in production');
    }
    return secret;
  }
  if (isProd) throw new Error('JWT_SECRET is required in production');
  if (!isTest) {
    console.warn(
      '[config] JWT_SECRET is not set - using a random secret for this process. ' +
        'Tokens become invalid after a restart. Copy .env.example to .env and set one.'
    );
  }
  return crypto.randomBytes(32).toString('hex');
}

const config = {
  env,
  isProd,
  isTest,
  root: ROOT,
  port: int('PORT', 3000),
  /** Number of reverse proxies in front of the app (needed for correct client IPs / rate limiting). */
  trustProxy: int('TRUST_PROXY', 0),
  corsOrigins: (process.env.CORS_ORIGINS || '*')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),

  db: {
    file: process.env.DB_FILE || path.join(ROOT, 'data', 'task-tracker.db'),
  },

  auth: {
    jwtSecret: resolveJwtSecret(),
    issuer: 'task-tracker-api',
    expiresInSeconds: int('JWT_EXPIRES_IN_SECONDS', 60 * 60),
    // bcrypt cost factor. 12 is a sensible 2020s default; tests use a low value for speed.
    bcryptRounds: int('BCRYPT_ROUNDS', isTest ? 4 : 12),
  },

  invites: {
    ttlDays: int('INVITE_TTL_DAYS', 7),
  },

  uploads: {
    dir: path.resolve(process.env.UPLOAD_DIR || path.join(ROOT, 'uploads')),
    maxFileSizeBytes: int('MAX_UPLOAD_MB', 5) * 1024 * 1024,
    // Allow-list of extensions. Anything that a browser could execute (html, svg, js) is deliberately absent.
    allowedExtensions: new Set([
      '.png', '.jpg', '.jpeg', '.gif', '.webp',
      '.pdf', '.txt', '.md', '.csv', '.json',
      '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
      '.zip',
    ]),
  },

  ai: {
    /** 'auto' (Anthropic when a key exists, otherwise the offline mock), 'anthropic' or 'mock'. */
    provider: (process.env.AI_PROVIDER || 'auto').toLowerCase(),
    anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
    model: process.env.AI_MODEL || 'claude-haiku-5-5',
    timeoutMs: int('AI_TIMEOUT_MS', 20_000),
  },

  rateLimit: {
    enabled: !isTest && process.env.RATE_LIMIT_ENABLED !== 'false',
    general: { windowMs: 15 * 60 * 1000, limit: int('RATE_LIMIT_GENERAL', 600) },
    auth: { windowMs: 15 * 60 * 1000, limit: int('RATE_LIMIT_AUTH', 20) },
    ai: { windowMs: 60 * 1000, limit: int('RATE_LIMIT_AI', 10) },
  },
};

export default config;
