// One-off backfill of per-article subscribe-click history from GA4's Data
// API into historical_subscribe_clicks. Unlike the Marfeel newsletter-signup
// backfill (import-historical-newsletter-signups.mjs), this needs no manual
// export — GA4 supports arbitrary historical date ranges directly, so this
// just asks further back than the regular 30-day sync does.
// Safe to re-run (upserts on wp_id+date). The daily analytics sync now keeps
// this table current on its own (sync/subscribeClicksDaily.js), so this is
// only for a manual deep backfill.
//
// Usage: node --env-file=.env server/scripts/backfill-historical-subscribe-clicks.mjs [--days N]
//   --days: how far back to request (default: back to DATA_START, see
//   utils/dataStart.js — earlier days are stored but never counted).
import { getDb } from '../db.js';
import { fetchHistoricalSubscribeClicks } from '../sync/ga4.js';
import { saveSubscribeClicks, daysSinceStart } from '../sync/subscribeClicksDaily.js';

const args = process.argv.slice(2);
const daysIdx = args.indexOf('--days');
const days = daysIdx !== -1 ? parseInt(args[daysIdx + 1], 10) : daysSinceStart();

console.log(`Fetching subscribe_click history for the last ${days} days from GA4...`);

const rows = await fetchHistoricalSubscribeClicks(days);
console.log(`Fetched ${rows.length} pagePath+date rows from GA4.`);

const db = getDb();
const content = db.prepare("SELECT wp_id, url FROM content WHERE url IS NOT NULL AND url != ''").all();
console.log(`Loaded ${content.length} content URLs for matching.`);

const { matched, unmatched } = saveSubscribeClicks(db, rows, content);

console.log(`Matched ${matched} rows to known content (${unmatched} unmatched — non-article pages, or content not yet in our sync).`);
console.log(`Imported ${matched} historical_subscribe_clicks rows.`);
