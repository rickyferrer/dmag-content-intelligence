// One-off backfill: populate content.cover_image_url for existing rows from
// WordPress's featured_media. Safe to re-run — only targets rows still NULL.
// Usage: node server/scripts/backfill-cover-images.mjs
import { getDb } from '../db.js';

const WP_BASE = 'https://www.dmagazine.com/wp-json/wp/v2';
const UA = 'SEO DMAG Crawl';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const TYPE_ENDPOINT = { post: 'posts', pages: 'pages', micropost: 'micropost' };

const db = getDb();
const rows = db.prepare('SELECT wp_id, content_type FROM content WHERE cover_image_url IS NULL').all();
console.log(`Backfilling cover images for ${rows.length} content items...`);

// Group ids by endpoint
const byEndpoint = new Map();
for (const r of rows) {
  const ep = TYPE_ENDPOINT[r.content_type];
  if (!ep) continue;
  if (!byEndpoint.has(ep)) byEndpoint.set(ep, []);
  byEndpoint.get(ep).push(r.wp_id);
}

const mediaIdByPost = new Map();
const allMediaIds = new Set();

for (const [ep, ids] of byEndpoint) {
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const url = `${WP_BASE}/${ep}?include=${chunk.join(',')}&per_page=100&_fields=id,featured_media`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!res.ok) { console.warn(`  ${ep} ${i}: HTTP ${res.status}`); continue; }
      const posts = await res.json();
      for (const p of posts) {
        if (p.featured_media) { mediaIdByPost.set(p.id, p.featured_media); allMediaIds.add(p.featured_media); }
      }
      console.log(`  ${ep}: ${Math.min(i + 100, ids.length)}/${ids.length}`);
      await sleep(250);
    } catch (e) { console.warn(`  ${ep} ${i}: ${e.message}`); }
  }
}

// Resolve media IDs to display-size URLs (prefer medium_large/medium over the full original)
console.log(`Resolving ${allMediaIds.size} unique media items...`);
const urlCache = new Map();
const uniqueIds = [...allMediaIds];
const fields = 'id,source_url,media_details.sizes.medium_large.source_url,media_details.sizes.medium.source_url';
for (let i = 0; i < uniqueIds.length; i += 100) {
  const chunk = uniqueIds.slice(i, i + 100);
  const url = `${WP_BASE}/media?include=${chunk.join(',')}&per_page=100&_fields=${fields}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) continue;
    const items = await res.json();
    for (const it of items) {
      const sizes = it.media_details?.sizes;
      const src = sizes?.medium_large?.source_url || sizes?.medium?.source_url || it.source_url;
      if (src) urlCache.set(it.id, src);
    }
    await sleep(250);
  } catch (e) { console.warn(`  media ${i}: ${e.message}`); }
}

// Update DB
const upd = db.prepare('UPDATE content SET cover_image_url = ? WHERE wp_id = ?');
let n = 0;
const tx = db.transaction(() => {
  for (const [wpId, mediaId] of mediaIdByPost) {
    const src = urlCache.get(mediaId);
    if (src) { upd.run(src, wpId); n++; }
  }
});
tx();
console.log(`Done. Updated cover_image_url for ${n} posts.`);
