import { randomUUID } from 'node:crypto';
import { GraphQLError } from 'graphql';
import { openDb, scalar } from '../../shared/db.js';
import { createLoader } from '../../shared/dataloader.js';
import { normalizePage, toConnection } from '../../shared/paging.js';

let db;

export function initReviews() {
  db = openDb('reviews.db');
  db.exec(`
    CREATE TABLE IF NOT EXISTS reviews (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      id TEXT UNIQUE NOT NULL,
      artwork_id TEXT NOT NULL,
      author_name TEXT NOT NULL,
      rating INTEGER NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reviews_artwork ON reviews(artwork_id);
  `);
  return db;
}

function bad(message) {
  throw new GraphQLError(message, { extensions: { code: 'BAD_USER_INPUT' } });
}

function clean(value, { min = 1, max = 200, label }) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (text.length < min) bad(`${label}: слишком коротко`);
  if (text.length > max) bad(`${label}: не длиннее ${max} символов`);
  return text;
}

function checkRating(value) {
  const rating = Number(value);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) bad('Оценка должна быть от 1 до 5');
  return rating;
}

function mapReview(row) {
  if (!row) return null;
  return {
    seq: row.seq,
    id: row.id,
    artworkId: row.artwork_id,
    authorName: row.author_name,
    rating: row.rating,
    text: row.text,
    createdAt: row.created_at,
  };
}

export function listReviews({ artworkId, authorName, page } = {}) {
  const { pageNum, pageSize, offset } = normalizePage(page);
  const where = [];
  const params = [];
  if (artworkId) {
    where.push('artwork_id = ?');
    params.push(String(artworkId));
  }
  if (authorName != null) {
    const name = String(authorName).trim();
    if (!name) return toConnection([], 0, pageNum, pageSize);
    where.push('author_name = ?');
    params.push(name);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = scalar(db, `SELECT COUNT(*) AS c FROM reviews ${whereSql}`, ...params);
  const rows = db.prepare(`
    SELECT * FROM reviews ${whereSql}
    ORDER BY seq DESC
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset);
  return toConnection(rows.map(mapReview), total, pageNum, pageSize);
}

export function createReview(input) {
  const artworkId = String(input.artworkId ?? '').trim();
  if (!/^\d{1,12}$/.test(artworkId)) bad('Некорректный идентификатор произведения');
  const authorName = clean(input.authorName, { max: 80, label: 'Имя' });
  const text = clean(input.text, { max: 2000, label: 'Текст отзыва' });
  const rating = checkRating(input.rating);
  const id = randomUUID();
  db.prepare(`
    INSERT INTO reviews (id, artwork_id, author_name, rating, text, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, artworkId, authorName, rating, text, new Date().toISOString());
  return mapReview(db.prepare('SELECT * FROM reviews WHERE id = ?').get(id));
}

function ownReview(id, authorName) {
  const current = db.prepare('SELECT * FROM reviews WHERE id = ?').get(String(id));
  if (!current) bad('Отзыв не найден');
  if (current.author_name !== String(authorName ?? '').trim()) bad('Можно менять только свои отзывы');
  return current;
}

export function updateReview({ id, authorName, rating, text }) {
  const current = ownReview(id, authorName);
  const nextText = text == null ? current.text : clean(text, { max: 2000, label: 'Текст отзыва' });
  const nextRating = rating == null ? current.rating : checkRating(rating);
  db.prepare('UPDATE reviews SET text = ?, rating = ? WHERE id = ?').run(nextText, nextRating, current.id);
  return mapReview(db.prepare('SELECT * FROM reviews WHERE id = ?').get(current.id));
}

export function deleteReview({ id, authorName }) {
  const current = ownReview(id, authorName);
  return db.prepare('DELETE FROM reviews WHERE id = ?').run(current.id).changes > 0;
}

export function reviewsAfter(seq) {
  return db.prepare('SELECT * FROM reviews WHERE seq > ? ORDER BY seq ASC LIMIT 20').all(seq).map(mapReview);
}

export function latestReviewSeq() {
  return scalar(db, 'SELECT COALESCE(MAX(seq), 0) AS c FROM reviews');
}

export function reviewLoaders() {
  return {
    summary: createLoader(async (ids) => {
      const unique = [...new Set(ids.map(String))];
      if (!unique.length) return [];
      const rows = db.prepare(`
        SELECT artwork_id, COUNT(*) AS count, AVG(rating) AS average
        FROM reviews
        WHERE artwork_id IN (${unique.map(() => '?').join(',')})
        GROUP BY artwork_id
      `).all(...unique);
      const map = new Map(rows.map((row) => [row.artwork_id, {
        count: row.count,
        average: Math.round(row.average * 10) / 10,
      }]));
      return ids.map((id) => map.get(String(id)) || { count: 0, average: null });
    }),
  };
}

export function reviewsHealth() {
  return { records: { reviews: scalar(db, 'SELECT COUNT(*) AS c FROM reviews') } };
}
