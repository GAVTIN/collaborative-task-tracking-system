/**
 * Must be the FIRST import of every test file (tests/helpers.js does this for you).
 *
 * ES module imports are evaluated in order, so by the time `src/config` is loaded these variables are
 * already in place: an in-memory database, a throw-away upload directory, a fixed JWT secret and the
 * offline AI mock. `node --test` runs each test file in its own process, so files never share state.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.NODE_ENV = 'test';
process.env.DB_FILE = ':memory:';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-123456';
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'task-tracker-test-'));
process.env.MAX_UPLOAD_MB = '1';
process.env.AI_PROVIDER = 'mock';
process.env.ANTHROPIC_API_KEY = '';
