// Daily capture of newsletter signups — the part of the Marfeel sync that
// makes sure a signup is saved the day it falls out of Marfeel's rolling
// 30-day window instead of vanishing.
//
// Why this exists: Marfeel's /traffic/realtime only reports "the last N
// days", never a date range, so the live per-article number is a rolling
// 30-day total and anything older is gone unless someone saved it. The first
// backfill was a one-off CSV export that stopped at Jul 27; nothing saved the
// weeks after it. This saves ONE complete day per sync, forever.
//
// What "last N days" means (verified against a per-day Marfeel export, exact
// match on four consecutive days, and against production: the value stored at
// 6 am equals what Marfeel reports at 2 pm): the last N COMPLETE calendar
// days ending YESTERDAY. It never includes today. So "last 1 day" is
// yesterday's finished total, and that's what's recorded here, under
// yesterday's date. (The old site-wide capture assumed it meant "today so
// far" and filed it under today, one day late — see the one-time shift in
// db.js.) Calendar days are taken in America/Chicago, the timezone this app
// already runs its schedule in; at the 6 am cron run that's the same date as
// UTC, so the daily run is unaffected either way.

export const NEWSLETTER_GOAL_COLUMNS = {
  'goal::newsletter_signup': 'newsletter_signup',
  'goal::newsletter_signup_inline': 'newsletter_signup_inline',
  'goal::newsletter_signup_modal': 'newsletter_signup_modal',
};

// YYYY-MM-DD for the Central-time calendar date `daysAgo` days before `now`.
export function centralDate(daysAgo = 0, now = new Date()) {
  const d = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
}

// Same normalization marfeel.js uses for its per-URL maps.
function normalizeUrl(raw) {
  try { const u = new URL(raw); return u.origin + u.pathname; } catch { return raw; }
}

// Marfeel also receives events from non-production hosts (a local dev site,
// dmagazine.local:9010, showed up with a test signup). They match no article,
// but they would inflate a site-wide total.
export function isProductionUrl(raw) {
  try { return /(^|\.)dmagazine\.com$/.test(new URL(raw).hostname); } catch { return false; }
}

function buildUrlToWpId(contentRows) {
  const map = new Map();
  for (const row of contentRows) {
    if (!row.url) continue;
    const norm = normalizeUrl(row.url);
    map.set(norm, row.wp_id);
    map.set(norm.endsWith('/') ? norm.slice(0, -1) : norm + '/', row.wp_id);
  }
  return map;
}

// capture = { total, byUrl: Map<normalizedUrl, { newsletter_signup, newsletter_signup_inline,
// newsletter_signup_modal }> } — yesterday's complete totals, from marfeel.js's
// fetchNewsletterYesterday. Only called when every goal was fetched, so a
// missing column means zero, not "unknown".
//
// Per-article rows only ever go UP (MAX): a late-arriving event or a re-run
// can add to a day's count, but a partial response can never lower one that
// was already saved (e.g. from a CSV import).
export function recordNewsletterYesterday(db, capture, contentRows, now = new Date()) {
  const date = centralDate(1, now);
  const urlToWpId = buildUrlToWpId(contentRows);

  const upsertSite = db.prepare(`
    INSERT INTO site_daily_metrics (date, newsletter_signups, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(date) DO UPDATE SET newsletter_signups = excluded.newsletter_signups, updated_at = datetime('now')
  `);
  const upsertArticle = db.prepare(`
    INSERT INTO newsletter_signups_daily (wp_id, date, newsletter_signup, newsletter_signup_inline, newsletter_signup_modal)
    VALUES (@wp_id, @date, @newsletter_signup, @newsletter_signup_inline, @newsletter_signup_modal)
    ON CONFLICT(wp_id, date) DO UPDATE SET
      newsletter_signup        = MAX(newsletter_signup, excluded.newsletter_signup),
      newsletter_signup_inline = MAX(newsletter_signup_inline, excluded.newsletter_signup_inline),
      newsletter_signup_modal  = MAX(newsletter_signup_modal, excluded.newsletter_signup_modal)
  `);

  let articles = 0, unmatched = 0;
  db.transaction(() => {
    upsertSite.run(date, capture.total);
    for (const [url, counts] of capture.byUrl) {
      const wpId = urlToWpId.get(url);
      if (!wpId) { unmatched++; continue; }
      upsertArticle.run({
        wp_id: wpId, date,
        newsletter_signup: counts.newsletter_signup || 0,
        newsletter_signup_inline: counts.newsletter_signup_inline || 0,
        newsletter_signup_modal: counts.newsletter_signup_modal || 0,
      });
      articles++;
    }
  })();
  return { date, site_total: capture.total, articles, unmatched };
}
