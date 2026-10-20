/**
 * SQLite connection (better-sqlite3).
 *
 * A single synchronous connection is shared by the whole process. better-sqlite3 is
 * synchronous by design: queries run in-process against a local file and typically finish
 * in microseconds, which is both faster and simpler than a callback/promise driver for this
 * workload. WAL mode lets readers and the single writer proceed concurrently.
 *
 * To move to PostgreSQL/MySQL later, the SQL lives only in the `*.service.js` files.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import config from '../config/index.js';

export function openDatabase(file = config.db.file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });

  const db = new Database(file);
  db.pragma('journal_mode = WAL'); // better concurrency (ignored for :memory:)
  db.pragma('foreign_keys = ON'); // SQLite does NOT enforce foreign keys unless asked
  db.pragma('busy_timeout = 5000'); // wait up to 5 s instead of failing on a locked DB
  return db;
}

const db = openDatabase();

/**
 * Prepared-statement cache.
 *
 * Statements are prepared lazily on first use (not at import time, because the schema may not be
 * migrated yet when modules load) and then reused. Usage:  prepare('SELECT ... WHERE id = ?').get(id)
 */
const statements = new Map();
export function prepare(sql) {
  let statement = statements.get(sql);
  if (!statement) {
    statement = db.prepare(sql);
    statements.set(sql, statement);
  }
  return statement;
}

export default db;
