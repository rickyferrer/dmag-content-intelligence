// Microsoft Clarity sync — per-article reader behavior (scroll depth, active
// time, and frustration signals: rage clicks, dead clicks, quick-backs,
// excessive scroll, script errors) from Clarity's Data Export API.
//
// Constraints that shape this module (Clarity's, not ours):
//   - The API only returns the last 1-3 days, so there is NO backfill. Each run
//     stores the trailing 24 hours under the sync date; clarity_page_daily is
//     the only history there will ever be.
//   - About 10 calls per project per day. We make ONE call per run (dimension =
//     URL, so every page comes back in one response), guard against re-running
//     too soon, and count calls so a restart loop or manual retries can't burn
//     the quota. Each response is capped (~1,000 rows per metric), which means
//     the busiest pages are captured and the long tail is not.
//   - Clarity samples, so these numbers flag pages worth a look. They are not
//     precise enough to feed the Content Value score.
import { getDb, getSyncState, setSyncState } from '../db.js';

const API_URL = 'https://www.clarity.ms/export-data/api/v1/project-live-insights';
const REQUEST_TIMEOUT_MS = 60000;
const MAX_CALLS_PER_DAY = 8;              // Clarity allows ~10; keep headroom
const MIN_HOURS_BETWEEN_RUNS = 6;         // the daily cron runs once; this stops restarts/retries re-spending quota
const RETENTION_DAYS = 400;

export function clarityConfigured() {
  return !!process.env.CLARITY_API_TOKEN;
}

// "Today" in Central time, matching the rest of the scheduler.
function centralDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(d); // YYYY-MM-DD
}

// Per-day call counter kept in sync_state so it survives a Render restart.
function callsToday() {
  try {
    const v = JSON.parse(getSyncState('clarity_calls') || 'null');
    return v && v.date === centralDate() ? v.count : 0;
  } catch { return 0; }
}
function countCall() {
  setSyncState('clarity_calls', JSON.stringify({ date: centralDate(), count: callsToday() + 1 }));
}

async function fetchInsights() {
  const url = `${API_URL}?numOfDays=1&dimension1=URL`;
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (callsToday() >= MAX_CALLS_PER_DAY) {
      throw new Error(`Clarity call budget reached for today (${MAX_CALLS_PER_DAY}); not calling again until tomorrow`);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    countCall();
    try {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${process.env.CLARITY_API_TOKEN}`, 'Content-Type': 'application/json' },
        signal: controller.signal,
      });
      if (res.ok) return await res.json();
      const text = (await res.text().catch(() => '')).slice(0, 200);
      const err = new Error(`Clarity API ${res.status}: ${text || res.statusText}`);
      // 4xx (bad token, 429 quota) won't improve on retry and a retry costs a call.
      if (res.status < 500) throw Object.assign(err, { fatal: true });
      lastError = err;
    } catch (err) {
      if (err.fatal) throw err;
      lastError = err.name === 'AbortError' ? new Error(`Clarity API timed out after ${REQUEST_TIMEOUT_MS / 1000}s`) : err;
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError;
}

// ── Parsing ──────────────────────────────────────────────────────────────────
// Response shape: [{ metricName: 'Traffic', information: [{ Url: '...', ...fields }] }, ...]
// Field names are read leniently (case-insensitive, string-or-number values) so
// a small naming difference degrades to zeros rather than throwing.

const num = (row, ...names) => {
  for (const want of names) {
    const key = Object.keys(row).find(k => k.toLowerCase() === want.toLowerCase());
    if (key != null) {
      const n = parseFloat(row[key]);
      if (Number.isFinite(n)) return n;
    }
  }
  return 0;
};
const urlOf = (row) => {
  const key = Object.keys(row).find(k => k.toLowerCase() === 'url');
  return key ? row[key] : null;
};
const metricRows = (data, ...names) => {
  const lower = names.map(n => n.toLowerCase());
  const m = (Array.isArray(data) ? data : []).find(x => lower.includes(String(x.metricName || '').toLowerCase()));
  return Array.isArray(m?.information) ? m.information : [];
};

// Sessions that hit a frustration signal. Clarity reports the count as
// sessionsCount; if only a percentage came back, derive it from sessions.
const sessionsWith = (row, sessions) => {
  const c = num(row, 'sessionsCount');
  if (c) return Math.round(c);
  const pct = num(row, 'sessionsWithMetricPercentage');
  return sessions && pct ? Math.round(sessions * pct / 100) : 0;
};

const pathKey = (u) => {
  try { return new URL(u).pathname.replace(/\/$/, '') || '/'; } catch { return null; }
};

// Pure parsing step, split out so it can be tested without the network.
// Returns Map<wp_id, row> aggregated across URL variants (query strings,
// trailing slashes) that all belong to one article.
export function parseInsights(data, pathMap) {
  const byWp = new Map();
  const slot = (url) => {
    const p = pathKey(url);
    const wpId = p && (pathMap.get(p) || pathMap.get(p + '/'));
    if (!wpId) return null;
    if (!byWp.has(wpId)) {
      byWp.set(wpId, { wp_id: wpId, sessions: 0, users: 0, scroll_depth: 0, active_time: 0, total_time: 0, dead_click: 0, rage_click: 0, quickback: 0, excessive_scroll: 0, script_error: 0, _scroll: 0, _scrollW: 0, _active: 0, _total: 0, _engW: 0 });
    }
    return byWp.get(wpId);
  };

  const traffic = metricRows(data, 'Traffic');
  const sessionsByUrl = new Map(); // url → sessions, so per-metric rows can be weighted
  for (const r of traffic) {
    const url = urlOf(r);
    const s = slot(url); if (!s) continue;
    const sessions = Math.round(num(r, 'totalSessionCount') - num(r, 'totalBotSessionCount'));
    sessionsByUrl.set(url, Math.max(0, sessions));
    s.sessions += Math.max(0, sessions);
    s.users += Math.round(num(r, 'distinctUserCount'));
  }
  // Averages are weighted by the sessions of the URL they came from.
  const weight = (url) => sessionsByUrl.get(url) || 1;

  for (const r of metricRows(data, 'ScrollDepth')) {
    const s = slot(urlOf(r)); if (!s) continue;
    s._scroll += num(r, 'averageScrollDepth') * weight(urlOf(r));
    s._scrollW += weight(urlOf(r));
  }
  for (const r of metricRows(data, 'EngagementTime')) {
    const s = slot(urlOf(r)); if (!s) continue;
    s._active += num(r, 'activeTime') * weight(urlOf(r));
    s._total += num(r, 'totalTime') * weight(urlOf(r));
    s._engW += weight(urlOf(r));
  }
  const counts = [
    ['DeadClickCount', 'dead_click'], ['RageClickCount', 'rage_click'], ['QuickbackClick', 'quickback'],
    ['ExcessiveScroll', 'excessive_scroll'], ['ScriptErrorCount', 'script_error'],
  ];
  for (const [metric, col] of counts) {
    for (const r of metricRows(data, metric)) {
      const s = slot(urlOf(r)); if (!s) continue;
      s[col] += sessionsWith(r, sessionsByUrl.get(urlOf(r)));
    }
  }

  for (const s of byWp.values()) {
    // Weighted mean over only the URL variants that reported the metric.
    s.scroll_depth = s._scrollW ? s._scroll / s._scrollW : 0;
    s.active_time = s._engW ? s._active / s._engW : 0;
    s.total_time = s._engW ? s._total / s._engW : 0;
    delete s._scroll; delete s._scrollW; delete s._active; delete s._total; delete s._engW;
  }
  return byWp;
}

export async function syncClarity({ force = false } = {}) {
  if (!clarityConfigured()) return { skipped: 'CLARITY_API_TOKEN not set' };

  if (!force) {
    const last = getSyncState('last_clarity_sync');
    if (last && Date.now() - new Date(last).getTime() < MIN_HOURS_BETWEEN_RUNS * 3600 * 1000) {
      return { skipped: `ran within the last ${MIN_HOURS_BETWEEN_RUNS}h` };
    }
  }

  const db = getDb();
  const content = db.prepare("SELECT wp_id, url FROM content WHERE url IS NOT NULL AND url != ''").all();
  const pathMap = new Map();
  for (const row of content) {
    const p = pathKey(row.url);
    if (p) { pathMap.set(p, row.wp_id); pathMap.set(p + '/', row.wp_id); }
  }

  const data = await fetchInsights();
  const metricNames = (Array.isArray(data) ? data : []).map(m => m.metricName);
  const urlRows = metricRows(data, 'Traffic').length;
  if (urlRows === 0) {
    // An empty/unrecognised response must not be recorded as a successful day.
    throw new Error(`Clarity returned no per-URL traffic rows (metrics seen: ${metricNames.join(', ') || 'none'})`);
  }

  const byWp = parseInsights(data, pathMap);
  const date = centralDate();
  const upsert = db.prepare(`
    INSERT INTO clarity_page_daily
      (wp_id, date, sessions, users, scroll_depth, active_time, total_time, dead_click, rage_click, quickback, excessive_scroll, script_error)
    VALUES (@wp_id, @date, @sessions, @users, @scroll_depth, @active_time, @total_time, @dead_click, @rage_click, @quickback, @excessive_scroll, @script_error)
    ON CONFLICT(wp_id, date) DO UPDATE SET
      sessions = excluded.sessions, users = excluded.users, scroll_depth = excluded.scroll_depth,
      active_time = excluded.active_time, total_time = excluded.total_time, dead_click = excluded.dead_click,
      rage_click = excluded.rage_click, quickback = excluded.quickback,
      excessive_scroll = excluded.excessive_scroll, script_error = excluded.script_error
  `);
  db.transaction(() => {
    for (const row of byWp.values()) upsert.run({ ...row, date });
    db.prepare(`DELETE FROM clarity_page_daily WHERE date < date('now', '-${RETENTION_DAYS} days')`).run();
  })();

  setSyncState('last_clarity_sync', new Date().toISOString());
  const result = { date, urls: urlRows, articles: byWp.size, calls_today: callsToday() };
  console.log(`[Clarity] ${date}: ${urlRows} URLs returned, ${byWp.size} matched to articles (metrics: ${metricNames.join(', ')})`);
  return result;
}

// Trailing-window summary for one article (used by the article detail route).
// Rates are sessions-with-signal ÷ sessions across the window; averages are
// weighted by each day's sessions. Returns null when there is no data yet.
export function getClarityForArticle(wpId, days = 30) {
  const db = getDb();
  const r = db.prepare(`
    SELECT COUNT(*) AS days_with_data, MIN(date) AS since,
      SUM(sessions) AS sessions, SUM(users) AS users,
      SUM(scroll_depth * sessions) AS scroll_w, SUM(active_time * sessions) AS active_w, SUM(total_time * sessions) AS total_w,
      SUM(dead_click) AS dead_click, SUM(rage_click) AS rage_click, SUM(quickback) AS quickback,
      SUM(excessive_scroll) AS excessive_scroll, SUM(script_error) AS script_error
    FROM clarity_page_daily
    WHERE wp_id = ? AND date >= date('now', ?)
  `).get(wpId, `-${days} days`);
  if (!r || !r.days_with_data || !r.sessions) return null;
  const rate = (n) => (n || 0) / r.sessions;
  return {
    window_days: days,
    days_with_data: r.days_with_data,
    since: r.since,
    sessions: r.sessions,
    scroll_depth: r.scroll_w / r.sessions,
    active_time: r.active_w / r.sessions,
    total_time: r.total_w / r.sessions,
    rage_click_rate: rate(r.rage_click),
    dead_click_rate: rate(r.dead_click),
    quickback_rate: rate(r.quickback),
    excessive_scroll_rate: rate(r.excessive_scroll),
    script_error_rate: rate(r.script_error),
  };
}
