import { getDb } from '../db.js';
import { fetchGA4ArticleMetrics } from '../sync/ga4.js';
import { DATA_START } from './dataStart.js';

// Per-article figures for an arbitrary date window, so the Content tab's
// columns follow its date range ("last 7 days" shows 7 days of readers, "this
// year" shows the year) instead of always being the trailing 30 days that the
// daily snapshot holds.
//
// Three sources, each exact for the window:
//   - GA4 (users, pageviews, loyal, in-market, engagement, ad revenue): one
//     live per-article pass over the window, cached because it is the same
//     for every filter combination and a few seconds long.
//   - Subscribe clicks: the stored daily rows, summed over the window.
//   - Newsletter signups: stored daily rows summed, plus any weekly bucket
//     that overlaps the window, pro-rated by overlapping days.

const CACHE_TTL_MS = 30 * 60 * 1000;
const cache = new Map();    // key → { at, data }
const inFlight = new Map(); // key → Promise

const DAY_MS = 24 * 60 * 60 * 1000;

function fmtLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / DAY_MS);
}

// What the Content tab should do for a given range:
//   null          → keep the stored trailing-30-day snapshot (the default "last
//                   30 days" view, already exact and instant)
//   {from, to}    → compute the window
// "All time"/anything reaching back past DATA_START resolves to the whole
// life since DATA_START.
export function resolveWindow(dateFrom, dateTo, today = fmtLocal(new Date())) {
  const to = !dateTo || dateTo > today ? today : dateTo;
  const from = !dateFrom || dateFrom < DATA_START ? DATA_START : dateFrom;
  const last30 = new Date(today + 'T00:00:00Z');
  last30.setUTCDate(last30.getUTCDate() - 29);
  if (to === today && from === last30.toISOString().slice(0, 10)) return null;
  if (from > to) return { from, to, empty: true };
  return { from, to };
}

export function dbWindowMetrics(db, from, to) {
  const out = new Map();
  const slot = (wpId) => {
    if (!out.has(wpId)) out.set(wpId, { subscribe_clicks: 0, newsletter_signups: 0 });
    return out.get(wpId);
  };

  for (const r of db.prepare(`
    SELECT wp_id, SUM(subscribe_clicks) AS n FROM subscribe_clicks_history
    WHERE date >= ? AND date <= ? GROUP BY wp_id
  `).all(from, to)) slot(r.wp_id).subscribe_clicks = r.n || 0;

  for (const r of db.prepare(`
    SELECT wp_id,
      SUM(COALESCE(newsletter_signup, 0) + COALESCE(newsletter_signup_inline, 0) + COALESCE(newsletter_signup_modal, 0)) AS n
    FROM newsletter_signups_daily WHERE date >= ? AND date <= ? GROUP BY wp_id
  `).all(from, to)) slot(r.wp_id).newsletter_signups += r.n || 0;

  // Weekly buckets span week_start..week_start+6; count the share of the
  // bucket that falls inside the window.
  const weeks = db.prepare(`
    SELECT wp_id, week_start,
      COALESCE(newsletter_signup, 0) + COALESCE(newsletter_signup_inline, 0) + COALESCE(newsletter_signup_modal, 0) AS n
    FROM historical_newsletter_signups
    WHERE week_start >= ? AND week_start <= ? AND date(week_start, '+6 days') >= ?
  `).all(DATA_START, to, from);
  for (const w of weeks) {
    const end = new Date(w.week_start + 'T00:00:00Z');
    end.setUTCDate(end.getUTCDate() + 6);
    const wkEnd = end.toISOString().slice(0, 10);
    const overlapStart = w.week_start > from ? w.week_start : from;
    const overlapEnd = wkEnd < to ? wkEnd : to;
    const overlap = daysBetween(overlapStart, overlapEnd) + 1;
    if (overlap > 0) slot(w.wp_id).newsletter_signups += (w.n || 0) * Math.min(7, overlap) / 7;
  }
  for (const m of out.values()) m.newsletter_signups = Math.round(m.newsletter_signups);
  return out;
}

async function compute(from, to) {
  const db = getDb();
  const today = fmtLocal(new Date());
  // The whole life since DATA_START is already stored by the daily sync.
  const haveLifetime = db.prepare('SELECT 1 FROM lifetime_metrics LIMIT 1').get();
  const ga4 = from === DATA_START && to === today && haveLifetime
    ? new Map(db.prepare('SELECT wp_id, users, pageviews, sessions, loyal_users, inmarket_users, avg_engagement_time, ad_revenue FROM lifetime_metrics').all().map(r => [r.wp_id, r]))
    : await fetchGA4ArticleMetrics(from, to);
  const dbm = dbWindowMetrics(db, from, to);
  const out = new Map();
  for (const [wpId, g] of ga4) {
    out.set(wpId, { ...g, subscribe_clicks: 0, newsletter_signups: 0 });
  }
  for (const [wpId, d] of dbm) {
    if (!out.has(wpId)) {
      out.set(wpId, { users: 0, pageviews: 0, sessions: 0, loyal_users: 0, inmarket_users: 0, avg_engagement_time: 0, ad_revenue: 0 });
    }
    Object.assign(out.get(wpId), d);
  }
  return out;
}

// Map<wp_id, metrics> for the window; articles with no traffic in it are
// simply absent (callers treat that as zero).
export async function getWindowMetrics(from, to) {
  const key = `${from}|${to}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
  if (inFlight.has(key)) return inFlight.get(key);

  const p = compute(from, to)
    .then((data) => {
      cache.set(key, { at: Date.now(), data });
      // Keep the cache small: windows are keyed by date, so old ones go stale.
      if (cache.size > 12) cache.delete(cache.keys().next().value);
      return data;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

// Overlays a window's figures onto a content-list row, using the same field
// names the table already reads. In-market is carried as a user count here
// (ga4_inmarket_users); the snapshot's ga4_inmarket_pageviews is left alone
// for the snapshot view.
export function applyDbWindow(row, m) {
  row.ga4_subscribe_clicks = m?.subscribe_clicks || 0;
  row.subscribe_clicks_total = m?.subscribe_clicks || 0;
  row.newsletter_signups_total = m?.newsletter_signups || 0;
  return row;
}

export function applyWindow(row, m) {
  const w = m || { users: 0, pageviews: 0, sessions: 0, loyal_users: 0, inmarket_users: 0, avg_engagement_time: 0, ad_revenue: 0, subscribe_clicks: 0, newsletter_signups: 0 };
  row.ga4_users = w.users;
  row.ga4_pageviews = w.pageviews;
  row.ga4_sessions = w.sessions;
  row.ga4_loyal_users = w.loyal_users;
  row.ga4_inmarket_users = w.inmarket_users;
  row.ga4_inmarket_pageviews = null;
  row.ga4_avg_engagement_time = w.users > 0 ? w.avg_engagement_time : null;
  row.ga4_ad_revenue = w.ad_revenue;
  row.ga4_subscribe_clicks = w.subscribe_clicks;
  row.subscribe_clicks_total = w.subscribe_clicks;
  row.newsletter_signups_total = w.newsletter_signups;
  return row;
}
