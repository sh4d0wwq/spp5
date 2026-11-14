import { openDb, scalar } from './db.js';

let db;

export function ingestDb() {
  if (!db) {
    db = openDb('ingest.db');
    db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        pid INTEGER,
        started_at TEXT,
        finished_at TEXT,
        message TEXT,
        aic_pages INTEGER,
        per_museum INTEGER
      );
      CREATE TABLE IF NOT EXISTS sources (
        source TEXT PRIMARY KEY,
        status TEXT,
        fetched INTEGER DEFAULT 0,
        stored INTEGER DEFAULT 0,
        last_page INTEGER DEFAULT 0,
        error TEXT,
        updated_at TEXT
      );
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT,
        source TEXT,
        level TEXT,
        message TEXT,
        fetched INTEGER,
        created_at TEXT
      );
    `);
  }
  return db;
}

export function countTable(filename, table) {
  try {
    const database = openDb(filename, { readOnly: true });
    return scalar(database, `SELECT COUNT(*) AS c FROM ${table}`);
  } catch {
    return 0;
  }
}

export function dataTotals() {
  return {
    artworks: countTable('catalog.db', 'artworks'),
    artists: countTable('artists.db', 'artists'),
    reviews: countTable('reviews.db', 'reviews'),
  };
}

export function latestRun() {
  const row = ingestDb().prepare(`
    SELECT id, status, pid, started_at, finished_at, message, aic_pages, per_museum
    FROM runs ORDER BY started_at DESC LIMIT 1
  `).get();
  return row || null;
}

export function sourceRows() {
  return ingestDb().prepare(`
    SELECT source, status, fetched, stored, last_page, error, updated_at
    FROM sources ORDER BY source
  `).all();
}

export function recentEvents(afterSeq = 0, limit = 50) {
  return ingestDb().prepare(`
    SELECT seq, run_id, source, level, message, fetched, created_at
    FROM events WHERE seq > ? ORDER BY seq ASC LIMIT ?
  `).all(afterSeq, limit);
}

export function ingestionStatus() {
  const run = latestRun();
  const sources = sourceRows().map((row) => ({
    source: row.source,
    status: row.status || 'idle',
    fetched: row.fetched || 0,
    stored: row.stored || 0,
    error: row.error,
    updatedAt: row.updated_at,
  }));
  return {
    runId: run?.id || null,
    status: run?.status || 'idle',
    startedAt: run?.started_at || null,
    finishedAt: run?.finished_at || null,
    message: run?.message || null,
    sources,
    totals: dataTotals(),
  };
}

export function writeEvent({ runId, source, level, message, fetched = null }) {
  ingestDb().prepare(`
    INSERT INTO events (run_id, source, level, message, fetched, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(runId, source, level, message, fetched, new Date().toISOString());
}

export function upsertSource(source, patch) {
  const current = ingestDb().prepare('SELECT * FROM sources WHERE source = ?').get(source) || {};
  const next = { ...current, ...patch, source };
  ingestDb().prepare(`
    INSERT INTO sources (source, status, fetched, stored, last_page, error, updated_at)
    VALUES (@source, @status, @fetched, @stored, @last_page, @error, @updated_at)
    ON CONFLICT(source) DO UPDATE SET
      status = excluded.status,
      fetched = excluded.fetched,
      stored = excluded.stored,
      last_page = excluded.last_page,
      error = excluded.error,
      updated_at = excluded.updated_at
  `).run({
    source,
    status: next.status || 'idle',
    fetched: next.fetched || 0,
    stored: next.stored || 0,
    last_page: next.last_page || 0,
    error: next.error || null,
    updated_at: new Date().toISOString(),
  });
}
