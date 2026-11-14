import { openDb, scalar, transaction } from '../../shared/db.js';
import { createLoader } from '../../shared/dataloader.js';
import { directionOf, likeContains, normalizePage, toConnection } from '../../shared/paging.js';

const SORT = { NAME: 'name_lower', ARTWORKS: 'artwork_count', BIRTH: 'birth_year' };

let db;

export function initArtists() {
  db = openDb('artists.db');
  db.exec(`
    CREATE TABLE IF NOT EXISTS artists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      name_lower TEXT NOT NULL,
      nationality TEXT,
      birth_year INTEGER,
      death_year INTEGER,
      museums TEXT NOT NULL DEFAULT '[]',
      artwork_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_artists_name ON artists(name_lower);
    CREATE INDEX IF NOT EXISTS idx_artists_count ON artists(artwork_count);
    CREATE INDEX IF NOT EXISTS idx_artists_nat ON artists(nationality);
  `);
  return db;
}

export function artistCount() {
  return scalar(db, 'SELECT COUNT(*) AS c FROM artists');
}

export function upsertArtists(rows) {
  const select = db.prepare('SELECT * FROM artists WHERE id = ?');
  const insert = db.prepare(`
    INSERT INTO artists (id, name, name_lower, nationality, birth_year, death_year, museums)
    VALUES (@id, @name, @name_lower, @nationality, @birth_year, @death_year, @museums)
    ON CONFLICT(id) DO UPDATE SET
      nationality = COALESCE(artists.nationality, excluded.nationality),
      birth_year = COALESCE(artists.birth_year, excluded.birth_year),
      death_year = COALESCE(artists.death_year, excluded.death_year),
      museums = excluded.museums
  `);
  transaction(db, () => {
    for (const row of rows) {
      const current = select.get(row.id);
      const museums = new Set(current ? JSON.parse(current.museums) : []);
      museums.add(row.museum);
      insert.run({
        id: row.id,
        name: row.name,
        name_lower: row.name.toLowerCase(),
        nationality: row.nationality,
        birth_year: row.birth_year,
        death_year: row.death_year,
        museums: JSON.stringify([...museums].sort()),
      });
    }
  });
}

export function setArtworkCounts(counts) {
  const update = db.prepare('UPDATE artists SET artwork_count = ? WHERE id = ?');
  transaction(db, () => {
    db.exec('UPDATE artists SET artwork_count = 0');
    for (const { id, count } of counts) update.run(count, id);
    db.exec('DELETE FROM artists WHERE artwork_count = 0');
  });
}

export function clearArtists() {
  db.exec('DELETE FROM artists');
}

function mapArtist(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    nationality: row.nationality,
    birthYear: row.birth_year,
    deathYear: row.death_year,
    museumCodes: JSON.parse(row.museums || '[]'),
    artworkCount: row.artwork_count,
  };
}

export function listArtists({ filter = {}, sort, page } = {}) {
  const { pageNum, pageSize, offset } = normalizePage(page);
  const where = [];
  const params = [];
  const like = likeContains(filter.search);
  if (like) {
    where.push('name_lower LIKE ?');
    params.push(like);
  }
  if (filter.nationality) {
    where.push('nationality = ?');
    params.push(filter.nationality);
  }
  if (filter.museum) {
    where.push(`museums LIKE ?`);
    params.push(`%"${String(filter.museum).replace(/[%_"\\]/g, '')}"%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const column = SORT[sort?.field] || 'artwork_count';
  const dir = sort ? directionOf(sort) : 'DESC';
  const total = db.prepare(`SELECT COUNT(*) AS c FROM artists ${whereSql}`).get(...params).c;
  const rows = db.prepare(`
    SELECT * FROM artists ${whereSql}
    ORDER BY ${column} IS NULL, ${column} ${dir}, name_lower
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset);
  return toConnection(rows.map(mapArtist), total, pageNum, pageSize);
}

export function nationalities() {
  return db.prepare(`
    SELECT nationality AS value, COUNT(*) AS count
    FROM artists WHERE nationality IS NOT NULL AND nationality != ''
    GROUP BY nationality ORDER BY count DESC LIMIT 40
  `).all();
}

export function artistLoaders() {
  return {
    artist: createLoader(async (ids) => {
      const unique = [...new Set(ids.map(String))];
      if (!unique.length) return [];
      const rows = db.prepare(
        `SELECT * FROM artists WHERE id IN (${unique.map(() => '?').join(',')})`,
      ).all(...unique);
      const map = new Map(rows.map((row) => [row.id, mapArtist(row)]));
      return ids.map((id) => map.get(String(id)) || null);
    }),
  };
}

export function artistsHealth() {
  return { records: { artists: artistCount() } };
}
