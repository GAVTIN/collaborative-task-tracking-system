/**
 * Tiny forward-only migration runner.
 *
 * Every file in ./migrations named `NNN_description.sql` is applied exactly once, in numeric
 * order. The highest applied number is stored in SQLite's built-in `PRAGMA user_version`, so no
 * bookkeeping table is needed. Each migration runs inside a transaction: it either fully applies
 * or not at all.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from './index.js';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

/** @returns {number} how many migrations were applied */
export function migrate() {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort();

  const currentVersion = db.pragma('user_version', { simple: true });
  let applied = 0;

  for (const file of files) {
    const version = Number.parseInt(file, 10);
    if (version <= currentVersion) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${version}`);
    })();
    applied += 1;
  }
  return applied;
}
