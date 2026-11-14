import { randomUUID, createHash } from 'node:crypto';
import { createCircuitBreaker } from '../shared/circuit.js';
import { log } from '../shared/logger.js';
import { ingestDb, upsertSource, writeEvent } from '../shared/ingestStore.js';
import {
  artistArtworkCounts,
  artworkCount,
  clearMuseum,
  initCatalog,
  rebuildArtworkIndex,
  upsertArtworks,
} from '../services/catalog/store.js';
import { clearArtists, initArtists, setArtworkCounts, upsertArtists } from '../services/artists/store.js';

const aicPages = readArg('--aic-pages', 100);
const perMuseum = readArg('--per-museum', 4000);
const force = process.argv.includes('--force');
const runId = randomUUID();

initCatalog();
initArtists();

const runStore = ingestDb();
runStore.prepare(`
  INSERT INTO runs (id, status, pid, started_at, message, aic_pages, per_museum)
  VALUES (?, 'running', ?, ?, ?, ?, ?)
`).run(runId, process.pid, new Date().toISOString(), 'Сбор запущен', aicPages, perMuseum);

let finished = false;

function finish(status, message) {
  if (finished) return;
  finished = true;
  runStore.prepare(`
    UPDATE runs SET status = ?, finished_at = ?, message = ? WHERE id = ?
  `).run(status, new Date().toISOString(), message, runId);
  note('ingest', status === 'success' ? 'info' : 'error', message);
}

function note(source, level, message, fetched = null) {
  log('ingest', level, message, { source });
  writeEvent({ runId, source, level, message, fetched });
}

process.on('SIGINT', () => { finish('failed', 'Сбор остановлен'); process.exit(1); });
process.on('SIGTERM', () => { finish('failed', 'Сбор остановлен'); process.exit(1); });

const UNKNOWN = /^(unknown|unidentified|anonymous|ubekendt|not identified)\b/i;

await main().catch((error) => {
  finish('failed', error.message);
  process.exit(1);
});

async function main() {
  if (force) clearArtists();
  const failures = [];
  await runSource('AIC', failures, collectAic);
  await runSource('CMA', failures, collectCma);
  await runSource('SMK', failures, collectSmk);
  rebuildArtworkIndex();
  setArtworkCounts(artistArtworkCounts());
  if (failures.length === 3) finish('failed', 'Ни один музей не ответил');
  else if (failures.length) finish('partial', `Часть музеев недоступна: ${failures.join(', ')}`);
  else finish('success', 'Сбор завершён');
}

async function runSource(source, failures, fn) {
  upsertSource(source, { status: 'running', error: null });
  try {
    await fn();
  } catch (error) {
    failures.push(source);
    upsertSource(source, { status: 'failed', error: error.message, stored: artworkCount(source) });
    note(source, 'error', error.message);
  }
}

function skip(source, target) {
  if (force || artworkCount(source) < target - 5) return false;
  upsertSource(source, { status: 'skipped', stored: artworkCount(source), fetched: artworkCount(source) });
  note(source, 'info', `Уже загружено ${artworkCount(source)}, повторный запрос пропущен`);
  return true;
}

function store(source, items) {
  const rows = items.filter(Boolean);
  if (!rows.length) return 0;
  upsertArtists(rows.filter((item) => item.artist).map((item) => ({ ...item.artist, museum: source })));
  upsertArtworks(rows.map((item) => item.artwork));
  return rows.length;
}

function report(source, fetched, failedPages, totalPages) {
  const stored = artworkCount(source);
  if (failedPages === totalPages) throw new Error('Источник не ответил ни на одну страницу');
  upsertSource(source, {
    status: failedPages ? 'partial' : 'success',
    fetched,
    stored,
    last_page: totalPages,
    error: failedPages ? `Ошибок страниц: ${failedPages}` : null,
  });
  note(source, 'info', `Записано ${stored}`, stored);
}

async function collectAic() {
  if (skip('AIC', aicPages * 100)) return;
  if (force) clearMuseum('AIC');
  const breaker = createCircuitBreaker({ failureThreshold: 6, resetMs: 20000 });
  const pages = range(aicPages).map((index) => index + 1);
  const fields = 'id,title,artist_title,artist_display,date_start,date_display,medium_display,place_of_origin,department_title,classification_title,image_id,credit_line,is_public_domain,description';
  let fetched = 0;
  let failed = 0;
  await pool(pages, 4, async (page) => {
    try {
      const json = await fetchJson(`https://api.artic.edu/api/v1/artworks?page=${page}&limit=100&fields=${fields}`, { breaker });
      fetched += store('AIC', (json.data || []).map(mapAic));
      note('AIC', 'info', `Страница ${page}/${aicPages}`, fetched);
    } catch (error) {
      failed += 1;
      note('AIC', 'error', `Страница ${page}: ${error.message}`, fetched);
    }
  });
  report('AIC', fetched, failed, pages.length);
}

async function collectCma() {
  if (skip('CMA', perMuseum)) return;
  if (force) clearMuseum('CMA');
  const size = 1000;
  const offsets = range(Math.ceil(perMuseum / size)).map((index) => index * size);
  let fetched = 0;
  let failed = 0;
  await pool(offsets, 2, async (skipCount) => {
    const limit = Math.min(size, perMuseum - skipCount);
    try {
      const json = await fetchJson(
        `https://openaccess-api.clevelandart.org/api/artworks/?limit=${limit}&skip=${skipCount}&has_image=1`,
        { timeout: 120000 },
      );
      fetched += store('CMA', (json.data || []).map(mapCma));
      note('CMA', 'info', `Записи ${skipCount + 1}–${skipCount + limit}`, fetched);
    } catch (error) {
      failed += 1;
      note('CMA', 'error', `Смещение ${skipCount}: ${error.message}`, fetched);
    }
  });
  report('CMA', fetched, failed, offsets.length);
}

async function collectSmk() {
  if (skip('SMK', perMuseum)) return;
  if (force) clearMuseum('SMK');
  const size = 2000;
  const offsets = range(Math.ceil(perMuseum / size)).map((index) => index * size);
  const filters = encodeURIComponent('[has_image:true],[object_names:painting]');
  let fetched = 0;
  let failed = 0;
  await pool(offsets, 2, async (offset) => {
    const rows = Math.min(size, perMuseum - offset);
    try {
      const json = await fetchJson(
        `https://api.smk.dk/api/v1/art/search/?keys=*&offset=${offset}&rows=${rows}&filters=${filters}&lang=en`,
        { timeout: 120000 },
      );
      fetched += store('SMK', (json.items || []).map(mapSmk));
      note('SMK', 'info', `Записи ${offset + 1}–${offset + rows}`, fetched);
    } catch (error) {
      failed += 1;
      note('SMK', 'error', `Смещение ${offset}: ${error.message}`, fetched);
    }
  });
  report('SMK', fetched, failed, offsets.length);
}

function mapAic(raw) {
  if (!raw?.id) return null;
  const display = raw.artist_display ? String(raw.artist_display) : '';
  const [firstLine, ...rest] = display.split(/\r?\n/);
  const name = cleanText(raw.artist_title, 200) || cleanText(firstLine.replace(/\s*\(.*$/, ''), 200);
  const bio = parseBio(rest.join(' ') || (firstLine.match(/\((.*)\)/)?.[1] ?? ''));
  const artist = /\d/.test(display) ? makeArtist(name, bio) : null;
  const year = Number.isFinite(raw.date_start) && raw.date_start !== 0 ? raw.date_start : null;
  return {
    artist,
    artwork: {
      museum: 'AIC',
      source_id: String(raw.id),
      title: cleanText(raw.title, 500) || 'Без названия',
      artist_id: artist?.id ?? null,
      artist_name: artist?.name ?? null,
      year,
      date_display: cleanText(raw.date_display, 80),
      medium: cleanText(raw.medium_display, 500),
      culture: cleanText(raw.place_of_origin, 180),
      department: cleanText(raw.department_title, 180),
      classification: cleanText(raw.classification_title, 180),
      image_url: raw.image_id ? `https://www.artic.edu/iiif/2/${raw.image_id}` : null,
      credit_line: cleanText(raw.credit_line, 500),
      is_public_domain: raw.is_public_domain ? 1 : 0,
      description: cleanText(raw.description, 4000),
      source_url: `https://www.artic.edu/artworks/${raw.id}`,
    },
  };
}

function mapCma(raw) {
  if (!raw?.id) return null;
  const creator = (raw.creators || []).find((item) => item?.description) || null;
  let artist = null;
  if (creator) {
    const name = cleanText(String(creator.description).replace(/\s*\(.*$/, ''), 200);
    const bio = parseBio(String(creator.description).match(/\((.*)\)/)?.[1] ?? '');
    artist = makeArtist(name, {
      nationality: bio.nationality,
      birthYear: toYear(creator.birth_year) ?? bio.birthYear,
      deathYear: toYear(creator.death_year) ?? bio.deathYear,
    });
  }
  return {
    artist,
    artwork: {
      museum: 'CMA',
      source_id: String(raw.id),
      title: cleanText(raw.title, 500) || 'Без названия',
      artist_id: artist?.id ?? null,
      artist_name: artist?.name ?? null,
      year: Number.isFinite(raw.creation_date_earliest) ? raw.creation_date_earliest : null,
      date_display: cleanText(raw.creation_date, 80),
      medium: cleanText(raw.technique, 500),
      culture: cleanText(raw.culture?.[0], 180),
      department: cleanText(raw.department, 180),
      classification: cleanText(raw.type, 180),
      image_url: raw.images?.web?.url || null,
      credit_line: cleanText(raw.creditline, 500),
      is_public_domain: raw.share_license_status === 'CC0' ? 1 : 0,
      description: cleanText(raw.description || raw.did_you_know, 4000),
      source_url: raw.url || null,
    },
  };
}

function mapSmk(raw) {
  if (!raw?.object_number) return null;
  const titles = (raw.titles || []).filter((item) => item?.title);
  const title = titles.find((item) => item.language === 'engelsk') || titles[0];
  const maker = (raw.production || []).find((item) => item?.creator && !UNKNOWN.test(item.creator));
  let artist = null;
  if (maker) {
    const name = maker.creator_forename && maker.creator_surname
      ? `${maker.creator_forename} ${maker.creator_surname}`
      : String(maker.creator).split(',').reverse().map((part) => part.trim()).join(' ');
    artist = makeArtist(cleanText(name, 200), {
      nationality: cleanText(maker.creator_nationality, 80),
      birthYear: toYear(maker.creator_date_of_birth),
      deathYear: toYear(maker.creator_date_of_death),
    });
  }
  const date = raw.production_date?.[0];
  return {
    artist,
    artwork: {
      museum: 'SMK',
      source_id: String(raw.object_number),
      title: cleanText(title?.title, 500) || 'Без названия',
      artist_id: artist?.id ?? null,
      artist_name: artist?.name ?? null,
      year: toYear(date?.start),
      date_display: cleanText(date?.period, 80),
      medium: cleanText((raw.techniques || []).join(', '), 500),
      culture: cleanText(maker?.creator_nationality, 180),
      department: cleanText(raw.responsible_department, 180) || 'Paintings',
      classification: cleanText(raw.object_names?.[0]?.name, 180),
      image_url: raw.image_thumbnail || null,
      credit_line: cleanText(raw.credit_line?.[0] ?? raw.credit_line, 500),
      is_public_domain: raw.public_domain ? 1 : 0,
      description: cleanText([].concat(raw.content_description || []).join(' '), 4000),
      source_url: raw.frontend_url || null,
    },
  };
}

function makeArtist(name, bio = {}) {
  if (!name || UNKNOWN.test(name) || /unknown/i.test(name)) return null;
  const key = normalizeName(name);
  if (key.length < 2) return null;
  return {
    id: createHash('sha1').update(key).digest('hex').slice(0, 16),
    name,
    nationality: bio.nationality || null,
    birth_year: bio.birthYear ?? null,
    death_year: bio.deathYear ?? null,
  };
}

function parseBio(text) {
  const value = String(text || '').trim();
  if (!value) return {};
  const nationality = cleanText(value.split(',')[0], 80);
  const span = value.match(/(\d{3,4})\s*[–-]\s*(\d{3,4})/);
  const born = value.match(/born\s+(\d{4})/i);
  return {
    nationality: nationality && /^\p{Lu}[\p{L}\s.'-]{2,30}$/u.test(nationality) && !/\b(by|for|of|in|at|and)\b/i.test(nationality)
      ? nationality
      : null,
    birthYear: span ? Number(span[1]) : born ? Number(born[1]) : null,
    deathYear: span ? Number(span[2]) : null,
  };
}

function toYear(value) {
  if (value == null || value === '') return null;
  const match = String(value).match(/^-?\d{1,4}/);
  if (!match) return null;
  const year = Number(match[0]);
  return Number.isFinite(year) && year !== 0 ? year : null;
}

function normalizeName(value) {
  return String(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function cleanText(value, max) {
  if (value == null) return null;
  const text = String(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  return text.slice(0, max);
}

async function fetchJson(url, { breaker, retries = 3, timeout = 30000 } = {}) {
  if (breaker && !breaker.canRequest()) throw new Error('circuit open');
  let last;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(timeout),
        headers: { accept: 'application/json', 'user-agent': 'ATLAS/1.0' },
      });
      if (response.status === 429 || response.status >= 500) throw new Error(`HTTP ${response.status}`);
      if (!response.ok) throw new Error(`HTTP ${response.status} для ${url}`);
      const json = await response.json();
      breaker?.success();
      return json;
    } catch (error) {
      last = error;
      breaker?.failure();
      if (breaker && !breaker.canRequest()) break;
      await delay(400 * attempt * attempt);
    }
  }
  throw last;
}

async function pool(items, limit, worker) {
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()));
}

function range(count) {
  return Array.from({ length: Math.max(0, count) }, (_item, index) => index);
}

function readArg(flag, fallback) {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) ? value : fallback;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
