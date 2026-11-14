import fs from 'node:fs';
import path from 'node:path';
import { openDb } from '../shared/db.js';
import { rootDir } from '../shared/paths.js';

const cacheDir = path.join(rootDir, 'data', 'media');
fs.mkdirSync(cacheDir, { recursive: true });
const pending = new Map();
let catalog = null;

const BROWSER = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

function source(id) {
  catalog ||= openDb('catalog.db', { readOnly: true });
  return catalog?.prepare('SELECT museum, image_url FROM artworks WHERE id = ?').get(id) || null;
}

export function attachMedia(app) {
  app.get('/media/artworks/:id', (req, res) => {
    const id = /^\d{1,12}$/.test(req.params.id) ? Number(req.params.id) : 0;
    const row = id ? source(id) : null;
    if (row?.museum !== 'AIC' || !/^https:\/\/www\.artic\.edu\/iiif\/2\/[a-z0-9-]+$/i.test(row.image_url || '')) {
      res.status(404).end();
      return;
    }
    deliver(res, `artwork-${id}`, [`${row.image_url}/full/800,/0/default.jpg`, `${row.image_url}/full/400,/0/default.jpg`]);
  });
}

function deliver(res, key, urls) {
  const file = path.join(cacheDir, `${key}.jpg`);
  if (fs.existsSync(file)) {
    res.setHeader('content-type', 'image/jpeg');
    res.setHeader('cache-control', 'public, max-age=86400');
    fs.createReadStream(file).pipe(res);
    return;
  }
  if (!pending.has(key)) {
    pending.set(key, load(file, urls).finally(() => pending.delete(key)));
  }
  pending.get(key).then((bytes) => {
    if (res.writableEnded) return;
    res.setHeader('content-type', 'image/jpeg');
    res.setHeader('cache-control', 'public, max-age=86400');
    res.send(bytes);
  }).catch(() => {
    if (!res.writableEnded) res.status(502).end();
  });
}

async function load(file, urls) {
  for (const url of urls) {
    const response = await fetch(url, {
      headers: { referer: 'https://www.artic.edu/', 'user-agent': BROWSER, accept: 'image/jpeg' },
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok || !(response.headers.get('content-type') || '').startsWith('image/')) continue;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 32) continue;
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, file);
    return bytes;
  }
  throw new Error('image unavailable');
}
