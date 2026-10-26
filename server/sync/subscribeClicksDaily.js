// Keeps historical_subscribe_clicks current as part of the daily analytics
// sync, so a subscribe click is saved before it falls out of GA4's rolling
// 30-day per-article window instead of vanishing from Lifetime Value.
//
// Why this exists: the history used to come from a one-off script
// (scripts/backfill-historical-subscribe-clicks.mjs) that had to be re-run by
// hand. Anything clicked after its last run and more than 30 days old was in
// neither the history nor the live number, so an issue's Lifetime Value
// quietly shrank as its early days aged out.
//
// Unlike Marfeel's newsletter signups (newsletterDaily.js), GA4 accepts an
// arbitrary date range, so rather than saving one day per run this re-reads a
// window each time. That self-heals: a run missed to a deploy restart or a
// GA4 outage is filled by the next one, and the first run after this ships
// reaches back to the last stored day, closing the existing gap.

import { fetchHistoricalSubscribeClicks } from './ga4.js';
import { DATA_START } from '../utils/dataStart.js';

// Always re-read at least this far back. Past the 30-day boundary the history
// is what counts (callers filter `date < 30 days ago`), and GA4 can revise a
// recent day slightly, so the overlap keeps those days accurate.
const MIN_LOOKBACK_DAYS = 35;
// Never ask further back than DATA_START (see utils/dataStart.js): anything
// earlier is ignored by every reader (the subscribe_clicks_history view), so
// fetching it is wasted. Also capped at the ceiling GA4 will answer for.
const MAX_LOOKBACK_DAYS = 800;
const DAY_MS = 86400000;
export const daysSinceStart = (today = new Date().toISOString().slice(0, 10)) =>
  Math.min(MAX_LOOKBACK_DAYS, Math.round((Date.parse(today) - Date.parse(DATA_START)) / DAY_MS) + 1);
// Re-read from this many days before the newest stored day, since the old
// script also stored the day it ran (partial) and GA4 settles late.
const OVERLAP_DAYS = 2;

// Same pathname matching as the regular GA4 sync — pagePath has no origin.
export function buildPathToWpId(contentRows) {
  const map = new Map();
  for (const row of contentRows) {
    if (!row.url) continue;
    try {
      const path = new URL(row.url).pathname.replace(/\/$/, '') || '/';
      map.set(path, row.wp_id);
      map.set(path + '/', row.wp_id);
    } catch {
      map.set(row.url, row.wp_id);
    }
  }
  return map;
}

// Rows from fetchHistoricalSubscribeClicks → upserts. GA4's number for a day
// is authoritative, so this overwrites (unlike newsletterDaily's MAX, which
// guards a source that can return a partial day).
export function saveSubscribeClicks(db, rows, contentRows) {
  const pathMap = buildPathToWpId(contentRows);
  const upsert = db.prepare(`
    INSERT INTO historical_subscribe_clicks (wp_id, date, subscribe_clicks, imported_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(wp_id, date) DO UPDATE SET
      subscribe_clicks = excluded.subscribe_clicks,
      imported_at = excluded.imported_at
  `);
  let matched = 0, unmatched = 0;
  db.transaction(() => {
    for (const row of rows) {
      const path = (row.pagePath || '').replace(/\/$/, '') || '/';
      const wpId = pathMap.get(path) || pathMap.get(path + '/');
      if (!wpId) { unmatched++; continue; }
      upsert.run(wpId, row.date, row.subscribe_clicks);
      matched++;
    }
  })();
  return { matched, unmatched };
}

// How far back to ask GA4: the standard window, or further if the newest
// stored day is older than that (a gap to close). `today` is injectable for
// tests; both dates are plain YYYY-MM-DD.
export function lookbackDaysFor(latestStored, today = new Date().toISOString().slice(0, 10)) {
  const limit = daysSinceStart(today);
  if (!latestStored) return limit;
  const gap = Math.round((Date.parse(today) - Date.parse(latestStored)) / DAY_MS) + OVERLAP_DAYS;
  return Math.min(limit, Math.max(MIN_LOOKBACK_DAYS, gap));
}

// Ends at yesterday so a half-finished day is never stored.
export async function captureSubscribeClicks(db, contentRows) {
  const latest = db.prepare('SELECT MAX(date) AS d FROM historical_subscribe_clicks').get()?.d || null;
  const lookbackDays = lookbackDaysFor(latest);
  const rows = await fetchHistoricalSubscribeClicks(lookbackDays, 'yesterday');
  const { matched, unmatched } = saveSubscribeClicks(db, rows, contentRows);
  return { lookbackDays, fetched: rows.length, matched, unmatched };
}
