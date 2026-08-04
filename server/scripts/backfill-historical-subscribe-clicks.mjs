// One-off backfill of per-article subscribe-click history from GA4's Data
// API into historical_subscribe_clicks. Unlike the Marfeel newsletter-signup
// backfill (import-historical-newsletter-signups.mjs), this needs no manual
// export — GA4 supports arbitrary historical date ranges directly, so this
// just asks further back than the regular 30-day sync does.
// Safe to re-run (upserts on wp_id+date); re-run periodically to extend
// coverage forward, since this is a one-off script, not part of the daily sync.
//
// Usage: node --env-file=.env server/scripts/backfill-historical-subscribe-clicks.mjs [--days N]
//   --days: how far back to request (default 400 — GA4 will just return
//   nothing for dates beyond its own retention window, no harm in asking).
import { getDb } from '../db.js';
import { fetchHistoricalSubscribeClicks } from '../sync/ga4.js';

const args = process.argv.slice(2);
const daysIdx = args.indexOf('--days');
const days = daysIdx !== -1 ? parseInt(args[daysIdx + 1], 10) : 400;

console.log(`Fetching subscribe_click history for the last ${days} days from GA4...`);

const rows = await fetchHistoricalSubscribeClicks(days);
console.log(`Fetched ${rows.length} pagePath+date rows from GA4.`);

const db = getDb();
const content = db.prepare("SELECT wp_id, url FROM content WHERE url IS NOT NULL AND url != ''").all();

// Same pathname-matching approach as the regular GA4 sync (syncGA4 in
// sync/ga4.js) — pagePath is a path only (no origin), unlike the URL-based
// matching the Marfeel/GSC scripts use.
const pathMap = new Map();
for (const row of content) {
  try {
    const u = new URL(row.url);
    const path = u.pathname.replace(/\/$/, '') || '/';
    pathMap.set(path, row.wp_id);
    pathMap.set(path + '/', row.wp_id);
  } catch {
    pathMap.set(row.url, row.wp_id);
  }
}
console.log(`Loaded ${content.length} content URLs for matching.`);

const upsert = db.prepare(`
  INSERT INTO historical_subscribe_clicks (wp_id, date, subscribe_clicks, imported_at)
  VALUES (?, ?, ?, datetime('now'))
  ON CONFLICT(wp_id, date) DO UPDATE SET
    subscribe_clicks = excluded.subscribe_clicks,
    imported_at = excluded.imported_at
`);

let matched = 0, unmatched = 0;
const tx = db.transaction(() => {
  for (const row of rows) {
    const path = (row.pagePath || '').replace(/\/$/, '') || '/';
    const wpId = pathMap.get(path) || pathMap.get(path + '/');
    if (!wpId) { unmatched++; continue; }
    matched++;
    upsert.run(wpId, row.date, row.subscribe_clicks);
  }
});
tx();

console.log(`Matched ${matched} rows to known content (${unmatched} unmatched — non-article pages, or content not yet in our sync).`);
console.log(`Imported ${matched} historical_subscribe_clicks rows.`);
