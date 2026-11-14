import { openDb, scalar, transaction } from '../../shared/db.js';
import { createLoader } from '../../shared/dataloader.js';
import { directionOf, normalizePage, toConnection, toFts } from '../../shared/paging.js';

const SORT = { TITLE: 'a.title', YEAR: 'a.year', ARTIST: 'a.artist_name', ADDED: 'a.id' };

let db;

export function initCatalog() {
  db = openDb('catalog.db');
  db.exec(`
    CREATE TABLE IF NOT EXISTS artworks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      museum TEXT NOT NULL,
      source_id TEXT NOT NULL,
      title TEXT NOT NULL,
      artist_id TEXT,
      artist_name TEXT,
      year INTEGER,
      date_display TEXT,
      medium TEXT,
      culture TEXT,
      department TEXT,
      classification TEXT,
      image_url TEXT,
      credit_line TEXT,
      is_public_domain INTEGER NOT NULL DEFAULT 0,
      description TEXT,
      source_url TEXT,
      UNIQUE (museum, source_id)
    );
    CREATE INDEX IF NOT EXISTS idx_art_museum ON artworks(museum, department);
    CREATE INDEX IF NOT EXISTS idx_art_artist ON artworks(artist_id);
    CREATE INDEX IF NOT EXISTS idx_art_year ON artworks(year);
    CREATE INDEX IF NOT EXISTS idx_art_title ON artworks(title);
    CREATE VIRTUAL TABLE IF NOT EXISTS artworks_fts USING fts5(
      title, artist_name, culture, medium, department,
      content='artworks', content_rowid='id'
    );
    CREATE TRIGGER IF NOT EXISTS artworks_ai AFTER INSERT ON artworks BEGIN
      INSERT INTO artworks_fts(rowid, title, artist_name, culture, medium, department)
      VALUES (new.id, new.title, new.artist_name, new.culture, new.medium, new.department);
    END;
    CREATE TRIGGER IF NOT EXISTS artworks_ad AFTER DELETE ON artworks BEGIN
      INSERT INTO artworks_fts(artworks_fts, rowid, title, artist_name, culture, medium, department)
      VALUES ('delete', old.id, old.title, old.artist_name, old.culture, old.medium, old.department);
    END;
    CREATE TRIGGER IF NOT EXISTS artworks_au AFTER UPDATE ON artworks BEGIN
      INSERT INTO artworks_fts(artworks_fts, rowid, title, artist_name, culture, medium, department)
      VALUES ('delete', old.id, old.title, old.artist_name, old.culture, old.medium, old.department);
      INSERT INTO artworks_fts(rowid, title, artist_name, culture, medium, department)
      VALUES (new.id, new.title, new.artist_name, new.culture, new.medium, new.department);
    END;
  `);
  return db;
}

export function artworkCount(museum) {
  if (museum) return scalar(db, 'SELECT COUNT(*) AS c FROM artworks WHERE museum = ?', museum);
  return scalar(db, 'SELECT COUNT(*) AS c FROM artworks');
}

export function upsertArtworks(rows) {
  const insert = db.prepare(`
    INSERT INTO artworks (
      museum, source_id, title, artist_id, artist_name, year, date_display, medium,
      culture, department, classification, image_url, credit_line, is_public_domain,
      description, source_url
    ) VALUES (
      @museum, @source_id, @title, @artist_id, @artist_name, @year, @date_display, @medium,
      @culture, @department, @classification, @image_url, @credit_line, @is_public_domain,
      @description, @source_url
    )
    ON CONFLICT(museum, source_id) DO UPDATE SET
      title = excluded.title,
      artist_id = excluded.artist_id,
      artist_name = excluded.artist_name,
      year = excluded.year,
      date_display = excluded.date_display,
      medium = excluded.medium,
      culture = excluded.culture,
      department = excluded.department,
      classification = excluded.classification,
      image_url = excluded.image_url,
      credit_line = excluded.credit_line,
      is_public_domain = excluded.is_public_domain,
      description = excluded.description,
      source_url = excluded.source_url
  `);
  transaction(db, () => {
    for (const row of rows) insert.run(row);
  });
}

export function clearMuseum(museum) {
  db.prepare('DELETE FROM artworks WHERE museum = ?').run(museum);
}

export function artistArtworkCounts() {
  return db.prepare(`
    SELECT artist_id AS id, COUNT(*) AS count
    FROM artworks WHERE artist_id IS NOT NULL
    GROUP BY artist_id
  `).all();
}

export function rebuildArtworkIndex() {
  db.exec(`INSERT INTO artworks_fts(artworks_fts) VALUES('rebuild')`);
}

export function mediaSource(id) {
  return db.prepare('SELECT museum, image_url FROM artworks WHERE id = ?').get(id) || null;
}

function mapArtwork(row) {
  if (!row) return null;
  let imageUrl = row.image_url;
  if (imageUrl && row.museum === 'AIC') imageUrl = `/media/artworks/${row.id}`;
  return {
    id: String(row.id),
    museumCode: row.museum,
    title: row.title,
    artistId: row.artist_id,
    artistName: row.artist_name,
    year: row.year,
    dateDisplay: row.date_display,
    medium: row.medium,
    culture: row.culture,
    department: row.department,
    classification: row.classification,
    imageUrl: imageUrl || null,
    creditLine: row.credit_line,
    isPublicDomain: Boolean(row.is_public_domain),
    description: row.description,
    sourceUrl: row.source_url,
  };
}

function buildWhere(filter = {}) {
  const where = [];
  const params = [];
  const fts = filter.search ? toFts(filter.search) : null;
  if (fts) {
    where.push('a.id IN (SELECT rowid FROM artworks_fts WHERE artworks_fts MATCH ?)');
    params.push(fts);
  }
  if (filter.museum) {
    where.push('a.museum = ?');
    params.push(filter.museum);
  }
  if (filter.department) {
    where.push('a.department = ?');
    params.push(filter.department);
  }
  if (filter.artistId) {
    where.push('a.artist_id = ?');
    params.push(filter.artistId);
  }
  if (filter.hasImage) where.push('a.image_url IS NOT NULL');
  if (filter.yearFrom != null) {
    where.push('a.year >= ?');
    params.push(filter.yearFrom);
  }
  if (filter.yearTo != null) {
    where.push('a.year <= ?');
    params.push(filter.yearTo);
  }
  return { whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

export function listArtworks({ filter, sort, page } = {}) {
  const { pageNum, pageSize, offset } = normalizePage(page);
  const { whereSql, params } = buildWhere(filter);
  const column = SORT[sort?.field] || 'a.title';
  const dir = directionOf(sort);
  const total = db.prepare(`SELECT COUNT(*) AS c FROM artworks a ${whereSql}`).get(...params).c;
  const rows = db.prepare(`
    SELECT a.* FROM artworks a ${whereSql}
    ORDER BY ${column} IS NULL, ${column} ${dir}, a.id
    LIMIT ? OFFSET ?
  `).all(...params, pageSize, offset);
  return toConnection(rows.map(mapArtwork), total, pageNum, pageSize);
}

export function getArtwork(id) {
  return mapArtwork(db.prepare('SELECT * FROM artworks WHERE id = ?').get(Number(id)));
}

export function catalogLoaders() {
  return {
    artwork: createLoader(async (ids) => {
      const unique = [...new Set(ids.map(Number).filter(Number.isFinite))];
      if (!unique.length) return ids.map(() => null);
      const rows = db.prepare(
        `SELECT * FROM artworks WHERE id IN (${unique.map(() => '?').join(',')})`,
      ).all(...unique);
      const map = new Map(rows.map((row) => [String(row.id), mapArtwork(row)]));
      return ids.map((id) => map.get(String(id)) || null);
    }),
    museumStats: createLoader(async (codes) => {
      const rows = db.prepare(`
        SELECT museum,
          COUNT(*) AS artworks,
          COUNT(DISTINCT artist_id) AS artists,
          SUM(CASE WHEN image_url IS NOT NULL THEN 1 ELSE 0 END) AS withImages,
          MIN(year) AS yearMin,
          MAX(year) AS yearMax
        FROM artworks GROUP BY museum
      `).all();
      const map = new Map(rows.map((row) => [row.museum, row]));
      return codes.map((code) => {
        const row = map.get(code) || {};
        return {
          artworks: row.artworks || 0,
          artists: row.artists || 0,
          withImages: row.withImages || 0,
          yearMin: row.yearMin ?? null,
          yearMax: row.yearMax ?? null,
        };
      });
    }),
  };
}

export function departments(museum) {
  const where = museum ? 'AND museum = ?' : '';
  return db.prepare(`
    SELECT department AS value, COUNT(*) AS count
    FROM artworks
    WHERE department IS NOT NULL AND department != '' ${where}
    GROUP BY department
    ORDER BY count DESC
    LIMIT 40
  `).all(...(museum ? [museum] : []));
}

export function catalogStats() {
  const row = db.prepare(`
    SELECT COUNT(*) AS artworks,
      COUNT(DISTINCT artist_id) AS artists,
      SUM(CASE WHEN image_url IS NOT NULL THEN 1 ELSE 0 END) AS withImages
    FROM artworks
  `).get();
  return {
    artworks: row.artworks || 0,
    artists: row.artists || 0,
    withImages: row.withImages || 0,
  };
}

export function catalogHealth() {
  return { records: { artworks: artworkCount() } };
}
