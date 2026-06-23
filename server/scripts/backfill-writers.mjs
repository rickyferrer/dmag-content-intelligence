// One-off backfill: populate content.writer for existing rows from acf.writers.
// Safe to re-run. Usage: node server/scripts/backfill-writers.mjs
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', '..', 'content.db');
const WP_BASE = 'https://www.dmagazine.com/wp-json/wp/v2';
const UA = 'SEO DMAG Crawl';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const TYPE_ENDPOINT = { post: 'posts', pages: 'pages', micropost: 'micropost' };

function decode(s) {
  return (s || '').replace(/&amp;/g, '&').replace(/&#8217;/g, '’').replace(/&#8216;/g, '‘')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)));
}

const db = new Database(DB_PATH);
const rows = db.prepare("SELECT wp_id, content_type FROM content WHERE writer IS NULL OR writer=''").all();
console.log(`Backfilling writers for ${rows.length} content items...`);

// Group ids by endpoint
const byEndpoint = new Map();
for (const r of rows) {
  const ep = TYPE_ENDPOINT[r.content_type];
  if (!ep) continue;
  if (!byEndpoint.has(ep)) byEndpoint.set(ep, []);
  byEndpoint.get(ep).push(r.wp_id);
}

const writerIdsByPost = new Map();
const allWriterIds = new Set();

for (const [ep, ids] of byEndpoint) {
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const url = `${WP_BASE}/${ep}?include=${chunk.join(',')}&per_page=100&_fields=id,acf.writers`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!res.ok) { console.warn(`  ${ep} ${i}: HTTP ${res.status}`); continue; }
      const posts = await res.json();
      for (const p of posts) {
        const wIds = (p.acf?.writers || []).map(w => w?.writer_id).filter(Boolean);
        if (wIds.length) { writerIdsByPost.set(p.id, wIds); wIds.forEach(id => allWriterIds.add(id)); }
      }
      console.log(`  ${ep}: ${Math.min(i + 100, ids.length)}/${ids.length}`);
      await sleep(250);
    } catch (e) { console.warn(`  ${ep} ${i}: ${e.message}`); }
  }
}

// Resolve writer names
console.log(`Resolving ${allWriterIds.size} unique writer names...`);
const nameCache = new Map();
const uniqueIds = [...allWriterIds];
for (let i = 0; i < uniqueIds.length; i += 100) {
  const chunk = uniqueIds.slice(i, i + 100);
  const url = `${WP_BASE}/writers?include=${chunk.join(',')}&per_page=100&_fields=id,title`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) continue;
    const items = await res.json();
    for (const it of items) nameCache.set(it.id, decode(it.title?.rendered || ''));
    await sleep(250);
  } catch (e) { console.warn(`  writers ${i}: ${e.message}`); }
}

// Update DB
const upd = db.prepare('UPDATE content SET writer = ? WHERE wp_id = ?');
let n = 0;
const tx = db.transaction(() => {
  for (const [wpId, ids] of writerIdsByPost) {
    const names = ids.map(id => nameCache.get(id)).filter(Boolean).join(', ');
    if (names) { upd.run(names, wpId); n++; }
  }
});
tx();
console.log(`Done. Updated writer for ${n} posts.`);
