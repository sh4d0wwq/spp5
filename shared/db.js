import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { rootDir } from './paths.js';

export function openDb(filename, { readOnly = false } = {}) {
  const file = path.join(rootDir, 'data', filename);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (readOnly && !fs.existsSync(file)) return null;
  const db = new DatabaseSync(file, { readOnly, timeout: 8000 });
  if (!readOnly) {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
    db.exec('PRAGMA temp_store = MEMORY');
    db.exec('PRAGMA cache_size = -20000');
    db.exec('PRAGMA busy_timeout = 8000');
  }
  return db;
}

export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* already closed */ }
    throw error;
  }
}

export function scalar(db, sql, ...params) {
  if (!db) return 0;
  const row = db.prepare(sql).get(...params);
  if (!row) return 0;
  const value = Object.values(row)[0];
  return Number(value || 0);
}
