import { openDb } from './db.js';

let db;

function database() {
  if (!db) {
    db = openDb('platform.db');
    db.exec(`
      CREATE TABLE IF NOT EXISTS traces (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL,
        operation TEXT,
        duration_ms INTEGER NOT NULL,
        status TEXT NOT NULL,
        services TEXT,
        spans TEXT,
        error TEXT,
        created_at TEXT NOT NULL
      )
    `);
  }
  return db;
}

export function recordTrace(entry) {
  const store = database();
  store.prepare(`
    INSERT INTO traces (id, operation, duration_ms, status, services, spans, error, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry.id,
    entry.operation || 'anonymous',
    entry.durationMs,
    entry.status,
    JSON.stringify(entry.services || []),
    JSON.stringify(entry.spans || []),
    entry.error || null,
    new Date().toISOString(),
  );
  store.prepare(`
    DELETE FROM traces
    WHERE seq < COALESCE((SELECT MAX(seq) FROM traces), 0) - 300
  `).run();
}

export function listTraces(limit = 30) {
  const store = database();
  const rows = store.prepare(`
    SELECT id, operation, duration_ms, status, services, spans, error, created_at
    FROM traces
    ORDER BY seq DESC
    LIMIT ?
  `).all(Math.min(100, Math.max(1, limit)));
  return rows.map((row) => ({
    id: row.id,
    operation: row.operation,
    durationMs: row.duration_ms,
    status: row.status,
    services: JSON.parse(row.services || '[]'),
    spans: JSON.parse(row.spans || '[]'),
    error: row.error,
    createdAt: row.created_at,
  }));
}
