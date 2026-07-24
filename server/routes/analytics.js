import { Router } from 'express';
import { getDb } from '../db.js';
import { fetchUsersForRange, fetchLoyalUsersForRange } from '../sync/ga4.js';

const router = Router();

// Content-strategy metrics: total_content and avg_true_value are inherently
// about articles PUBLISHED in the range (filtered by c.published_at).
// total_newsletter_signups also stays on this per-article approach for now —
// Marfeel's API doesn't yet give us a clean site-wide daily breakdown for it.
//
// `asOf`, when set, pulls each article's most recent snapshot AT OR BEFORE
// that timestamp instead of its latest snapshot overall, which is what makes
// comparing avg_true_value across periods meaningful: GA4 metrics here are a
// rolling trailing-30-day window as of sync time (see sync/ga4.js), so
// comparing "today's snapshot" to "the snapshot from ~30 days ago" for the
// SAME set of articles gives a real trend.
function computeContentSummary(db, dateFrom, dateTo, section, type, asOf = null) {
  const dateWhere = [];
  const dateParams = [];
  if (dateFrom)  { dateWhere.push('c.published_at >= ?'); dateParams.push(dateFrom); }
  if (dateTo)    { dateWhere.push('c.published_at <= ?'); dateParams.push(dateTo + 'T23:59:59'); }
  if (section)   { dateWhere.push('c.section = ?'); dateParams.push(section); }
  if (type)      { dateWhere.push('c.content_type = ?'); dateParams.push(type); }
  const dateFilter = dateWhere.length ? 'WHERE ' + dateWhere.join(' AND ') : '';

  const total = db.prepare(`SELECT COUNT(*) as count FROM content c ${dateFilter}`).get(...dateParams);

  const snapshotCutoff = asOf ? 'WHERE snapshot_at <= ?' : '';
  const snapshotParams = asOf ? [asOf] : [];

  const latestSubquery = `
    SELECT wp_id, MAX(snapshot_at) as latest FROM analytics_snapshots ${snapshotCutoff} GROUP BY wp_id
  `;

  const latest = db.prepare(`
    SELECT
      AVG(CASE WHEN a.true_value > 0 THEN a.true_value END) as avg_true_value,
      SUM(a.ga4_pageviews) as total_pageviews,
      SUM(a.ga4_users) as total_users,
      SUM(a.ga4_loyal_users) as total_loyal_users,
      SUM(a.ga4_subscribe_clicks) as total_subscribe_clicks,
      SUM(a.ga4_ad_revenue) as total_ad_revenue,
      SUM(a.mf_newsletter_signups) as total_newsletter_signups,
      AVG(a.ga4_avg_engagement_time) as avg_engagement_time,
      COUNT(DISTINCT c.wp_id) as matched_count
    FROM content c
    JOIN (${latestSubquery}) lx ON c.wp_id = lx.wp_id
    JOIN analytics_snapshots a ON a.wp_id = lx.wp_id AND a.snapshot_at = lx.latest
    ${dateFilter}
  `).get(...snapshotParams, ...dateParams);

  return {
    total_content: total.count,
    avg_true_value: latest.avg_true_value || 0,
    total_pageviews: latest.total_pageviews || 0,
    total_users: latest.total_users || 0,
    total_loyal_users: latest.total_loyal_users || 0,
    total_subscribe_clicks: latest.total_subscribe_clicks || 0,
    total_ad_revenue: latest.total_ad_revenue || 0,
    total_newsletter_signups: latest.total_newsletter_signups || 0,
    avg_engagement_time: latest.avg_engagement_time || 0,
    matched_count: latest.matched_count || 0,
  };
}

// Site-wide traffic by calendar date — independent of which articles were
// published in the range. This is what makes "Users"/"Loyal Users" correct
// for a date range with no new posts (e.g. a weekend): the site still had
// real readers that day even though nothing new went out. Only valid when
// there's no section/type filter, since site_daily_metrics has no such
// breakdown — those views fall back to the per-article numbers instead.
//
// Users/loyal users are fetched LIVE from GA4 with a single consolidated
// date range rather than summed from the daily table. They're distinct-count
// metrics, not additive event counts like pageviews/clicks — summing per-day
// snapshots across a range over-counts every repeat visitor once per day
// they showed up (a reader active 15 of 30 days would be counted 15 times,
// not once). That's especially severe for loyal users, since "loyal" is by
// definition a repeat visitor. Pageviews/subscribe_clicks/ad_revenue ARE
// genuinely additive, so those still come from the fast pre-aggregated table.
async function computeTrafficSummary(db, dateFrom, dateTo) {
  const where = [];
  const params = [];
  if (dateFrom) { where.push('date >= ?'); params.push(dateFrom); }
  if (dateTo)   { where.push('date <= ?'); params.push(dateTo); }
  const filter = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const row = db.prepare(`
    SELECT
      SUM(pageviews) as total_pageviews,
      SUM(subscribe_clicks) as total_subscribe_clicks,
      SUM(ad_revenue) as total_ad_revenue,
      SUM(newsletter_signups) as total_newsletter_signups,
      AVG(avg_engagement_time) as avg_engagement_time,
      COUNT(*) as day_count
    FROM site_daily_metrics
    ${filter}
  `).get(...params);

  const [total_users, rawLoyalUsers] = await Promise.all([
    fetchUsersForRange(dateFrom, dateTo),
    fetchLoyalUsersForRange(dateFrom, dateTo),
  ]);

  return {
    total_users,
    total_loyal_users: Math.min(rawLoyalUsers, total_users), // cap, same rationale as the per-article sync
    total_pageviews: row.total_pageviews || 0,
    total_subscribe_clicks: row.total_subscribe_clicks || 0,
    total_ad_revenue: row.total_ad_revenue || 0,
    total_newsletter_signups: row.total_newsletter_signups || 0,
    avg_engagement_time: row.avg_engagement_time || 0,
    day_count: row.day_count || 0,
  };
}

function pctChange(curr, prev) {
  if (prev == null || prev === 0) return null;
  return ((curr - prev) / prev) * 100;
}

// GET /api/analytics/summary
router.get('/summary', async (req, res) => {
  const db = getDb();
  const { dateFrom, dateTo, section, type } = req.query;

  const contentCurrent = computeContentSummary(db, dateFrom, dateTo, section, type);
  const useSiteWide = !section && !type;
  const trafficCurrent = useSiteWide ? await computeTrafficSummary(db, dateFrom, dateTo) : null;

  const current = {
    total_content: contentCurrent.total_content,
    avg_true_value: contentCurrent.avg_true_value,
    total_pageviews: useSiteWide ? trafficCurrent.total_pageviews : contentCurrent.total_pageviews,
    total_users: useSiteWide ? trafficCurrent.total_users : contentCurrent.total_users,
    total_loyal_users: useSiteWide ? trafficCurrent.total_loyal_users : contentCurrent.total_loyal_users,
    total_subscribe_clicks: useSiteWide ? trafficCurrent.total_subscribe_clicks : contentCurrent.total_subscribe_clicks,
    total_ad_revenue: useSiteWide ? trafficCurrent.total_ad_revenue : contentCurrent.total_ad_revenue,
    total_newsletter_signups: useSiteWide ? trafficCurrent.total_newsletter_signups : contentCurrent.total_newsletter_signups,
    avg_engagement_time: useSiteWide ? trafficCurrent.avg_engagement_time : contentCurrent.avg_engagement_time,
  };

  // Only compute a comparison when there's an explicit range to derive a
  // duration from — "all time" has no meaningful "N days ago".
  let changes = {};
  if (dateFrom && dateTo) {
    const from = new Date(dateFrom + 'T00:00:00Z');
    const to = new Date(dateTo + 'T00:00:00Z');
    const durationDays = Math.max(1, Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)));

    // Content-side previous period (avg_true_value, newsletter signups):
    // same cohort of articles, snapshot from ~N days ago.
    const asOf = new Date(Date.now() - durationDays * 24 * 60 * 60 * 1000).toISOString();
    const contentPrevious = computeContentSummary(db, dateFrom, dateTo, section, type, asOf);
    const contentCoverage = contentCurrent.total_content > 0
      ? contentPrevious.matched_count / contentCurrent.total_content
      : 0;

    if (contentCoverage >= 0.5) {
      changes.avg_true_value = pctChange(contentCurrent.avg_true_value, contentPrevious.avg_true_value);
    }

    if (useSiteWide) {
      // Traffic-side previous period: a real shifted calendar window.
      const priorTo = new Date(from.getTime() - 24 * 60 * 60 * 1000);
      const priorFrom = new Date(priorTo.getTime() - durationDays * 24 * 60 * 60 * 1000);
      const fmtDate = (d) => d.toISOString().slice(0, 10);
      const trafficPrevious = await computeTrafficSummary(db, fmtDate(priorFrom), fmtDate(priorTo));

      // Users/loyal users are live GA4 queries — always an exact count for
      // whatever range was requested, no historical-depth gating needed.
      changes.total_users = pctChange(current.total_users, trafficPrevious.total_users);
      changes.total_loyal_users = pctChange(current.total_loyal_users, trafficPrevious.total_loyal_users);

      // Pageviews/subscribe_clicks/ad_revenue/newsletter still come from the
      // pre-aggregated daily table, so still need the depth check.
      const expectedDays = durationDays + 1;
      const trafficCoverage = trafficPrevious.day_count / expectedDays;
      if (trafficCoverage >= 0.5) {
        changes.total_subscribe_clicks = pctChange(current.total_subscribe_clicks, trafficPrevious.total_subscribe_clicks);
        changes.total_ad_revenue = pctChange(current.total_ad_revenue, trafficPrevious.total_ad_revenue);
        changes.total_newsletter_signups = pctChange(current.total_newsletter_signups, trafficPrevious.total_newsletter_signups);
      }
    } else if (contentCoverage >= 0.5) {
      // Section/type-scoped view — no site-wide breakdown available, so
      // fall back to the per-article comparison for these too.
      changes.total_users = pctChange(current.total_users, contentPrevious.total_users);
      changes.total_newsletter_signups = pctChange(current.total_newsletter_signups, contentPrevious.total_newsletter_signups);
      changes.total_loyal_users = pctChange(current.total_loyal_users, contentPrevious.total_loyal_users);
      changes.total_subscribe_clicks = pctChange(current.total_subscribe_clicks, contentPrevious.total_subscribe_clicks);
      changes.total_ad_revenue = pctChange(current.total_ad_revenue, contentPrevious.total_ad_revenue);
    }
  }

  res.json({ ...current, changes });
});

// GET /api/analytics/by-need
router.get('/by-need', (req, res) => {
  const db = getDb();
  const { dateFrom, dateTo, section, type } = req.query;

  const dateWhere = ['c.user_need IS NOT NULL'];
  const dateParams = [];
  if (dateFrom)  { dateWhere.push('c.published_at >= ?'); dateParams.push(dateFrom); }
  if (dateTo)    { dateWhere.push('c.published_at <= ?'); dateParams.push(dateTo + 'T23:59:59'); }
  if (section)   { dateWhere.push('c.section = ?'); dateParams.push(section); }
  if (type)      { dateWhere.push('c.content_type = ?'); dateParams.push(type); }
  const where = 'WHERE ' + dateWhere.join(' AND ');

  const rows = db.prepare(`
    SELECT
      c.user_need,
      COUNT(c.wp_id) as article_count,
      AVG(a.true_value) as avg_true_value,
      SUM(a.true_value) as total_true_value,
      AVG(a.ga4_pageviews) as avg_pageviews,
      SUM(a.ga4_pageviews) as total_pageviews,
      AVG(a.ga4_avg_engagement_time) as avg_engagement_time,
      SUM(a.ga4_subscribe_clicks) as total_subscribe_clicks,
      SUM(a.mf_newsletter_signups) as total_newsletter_signups,
      AVG(c.user_need_confidence) as avg_confidence
    FROM content c
    LEFT JOIN (
      SELECT wp_id, MAX(snapshot_at) as latest FROM analytics_snapshots GROUP BY wp_id
    ) lx ON c.wp_id = lx.wp_id
    LEFT JOIN analytics_snapshots a ON a.wp_id = lx.wp_id AND a.snapshot_at = lx.latest
    ${where}
    GROUP BY c.user_need
    ORDER BY total_true_value DESC
  `).all(...dateParams);

  // Find top performing article per need
  const topArticles = db.prepare(`
    SELECT c.user_need, c.wp_id, c.title, c.url, a.true_value
    FROM content c
    JOIN (
      SELECT wp_id, MAX(snapshot_at) as latest FROM analytics_snapshots GROUP BY wp_id
    ) lx ON c.wp_id = lx.wp_id
    JOIN analytics_snapshots a ON a.wp_id = lx.wp_id AND a.snapshot_at = lx.latest
    ${where}
    ORDER BY a.true_value DESC
  `).all(...dateParams);

  const topByNeed = {};
  for (const art of topArticles) {
    if (!topByNeed[art.user_need]) topByNeed[art.user_need] = art;
  }

  const result = rows.map(r => ({
    ...r,
    top_article: topByNeed[r.user_need] || null,
  }));

  res.json(result);
});

// GET /api/analytics/scatter
router.get('/scatter', (req, res) => {
  const db = getDb();
  const { dateFrom, dateTo, section, type } = req.query;

  const where = ['c.user_need IS NOT NULL'];
  const params = [];
  if (dateFrom) { where.push('c.published_at >= ?'); params.push(dateFrom); }
  if (dateTo)   { where.push('c.published_at <= ?'); params.push(dateTo + 'T23:59:59'); }
  if (section)  { where.push('c.section = ?');       params.push(section); }
  if (type)     { where.push('c.content_type = ?');  params.push(type); }

  const rows = db.prepare(`
    SELECT
      c.user_need,
      COUNT(c.wp_id) as article_count,
      AVG(a.true_value) as avg_true_value,
      SUM(a.ga4_pageviews) as total_pageviews,
      AVG(a.ga4_avg_engagement_time) as avg_engagement
    FROM content c
    LEFT JOIN (
      SELECT wp_id, MAX(snapshot_at) as latest FROM analytics_snapshots GROUP BY wp_id
    ) lx ON c.wp_id = lx.wp_id
    LEFT JOIN analytics_snapshots a ON a.wp_id = lx.wp_id AND a.snapshot_at = lx.latest
    WHERE ${where.join(' AND ')}
    GROUP BY c.user_need
  `).all(...params);

  res.json(rows);
});

// GET /api/analytics/trend
router.get('/trend', (req, res) => {
  const db = getDb();
  const { days = 30 } = req.query;

  const rows = db.prepare(`
    SELECT
      DATE(snapshot_at) as date,
      AVG(CASE WHEN true_value > 0 THEN true_value END) as avg_true_value,
      SUM(ga4_pageviews) as total_pageviews,
      SUM(ga4_subscribe_clicks) as total_subscribe_clicks,
      COUNT(DISTINCT wp_id) as content_count
    FROM analytics_snapshots
    WHERE snapshot_at >= datetime('now', '-' || ? || ' days')
    GROUP BY DATE(snapshot_at)
    ORDER BY date ASC
  `).all(parseInt(days));

  res.json(rows);
});

// GET /api/analytics/by-section
router.get('/by-section', (req, res) => {
  const db = getDb();
  const { dateFrom, dateTo, type } = req.query;

  const where = ["c.section IS NOT NULL AND c.section != ''"];
  const params = [];
  if (dateFrom) { where.push('c.published_at >= ?'); params.push(dateFrom); }
  if (dateTo)   { where.push('c.published_at <= ?'); params.push(dateTo + 'T23:59:59'); }
  if (type)     { where.push('c.content_type = ?'); params.push(type); }

  const rows = db.prepare(`
    SELECT
      c.section,
      COUNT(c.wp_id)              AS article_count,
      SUM(a.true_value)           AS avg_true_value,
      SUM(a.ga4_users)            AS total_users,
      SUM(a.ga4_loyal_users)      AS total_loyal_users,
      SUM(a.ga4_pageviews)        AS total_pageviews,
      SUM(a.ga4_subscribe_clicks) AS total_subscribe_clicks,
      AVG(a.ga4_avg_engagement_time) AS avg_engagement_time,
      SUM(a.mf_newsletter_signups)   AS total_newsletter_signups
    FROM content c
    LEFT JOIN (
      SELECT wp_id, MAX(snapshot_at) AS latest FROM analytics_snapshots GROUP BY wp_id
    ) lx ON c.wp_id = lx.wp_id
    LEFT JOIN analytics_snapshots a ON a.wp_id = lx.wp_id AND a.snapshot_at = lx.latest
    WHERE ${where.join(' AND ')}
    GROUP BY c.section
    ORDER BY avg_true_value DESC
  `).all(...params);

  // Prior year query — same date range shifted back 1 year
  const pyWhere = ["c.section IS NOT NULL AND c.section != ''"];
  const pyParams = [];
  if (dateFrom) { pyWhere.push('c.published_at >= date(?, \'-1 year\')'); pyParams.push(dateFrom); }
  else          { pyWhere.push("c.published_at >= date('now', '-2 years')"); }
  if (dateTo)   { pyWhere.push('c.published_at <= date(?, \'-1 year\', \'+1 day\')'); pyParams.push(dateTo); }
  else          { pyWhere.push("c.published_at <= date('now', '-1 year')"); }
  if (type)     { pyWhere.push('c.content_type = ?'); pyParams.push(type); }

  const pyRows = db.prepare(`
    SELECT
      c.section,
      COUNT(c.wp_id)    AS py_article_count,
      SUM(a.true_value) AS py_total_true_value,
      SUM(a.ga4_pageviews) AS py_total_pageviews
    FROM content c
    LEFT JOIN (
      SELECT wp_id, MAX(snapshot_at) AS latest FROM analytics_snapshots GROUP BY wp_id
    ) lx ON c.wp_id = lx.wp_id
    LEFT JOIN analytics_snapshots a ON a.wp_id = lx.wp_id AND a.snapshot_at = lx.latest
    WHERE ${pyWhere.join(' AND ')}
    GROUP BY c.section
  `).all(...pyParams);

  const pyMap = Object.fromEntries(pyRows.map(r => [r.section, r]));

  // Top article per section
  const topRows = db.prepare(`
    SELECT c.section, c.wp_id, c.title, c.url, a.true_value
    FROM content c
    JOIN (
      SELECT wp_id, MAX(snapshot_at) AS latest FROM analytics_snapshots GROUP BY wp_id
    ) lx ON c.wp_id = lx.wp_id
    JOIN analytics_snapshots a ON a.wp_id = lx.wp_id AND a.snapshot_at = lx.latest
    WHERE ${where.join(' AND ')}
    ORDER BY a.true_value DESC
  `).all(...params);

  const topBySection = {};
  for (const art of topRows) {
    if (!topBySection[art.section]) topBySection[art.section] = art;
  }

  res.json(rows.map(r => ({
    ...r,
    top_article: topBySection[r.section] || null,
    py: pyMap[r.section] || null,
  })));
});

// GET /api/analytics/by-issue
// Groups /publications/{pub}/{year}/{month}/* content into issues
router.get('/by-issue', (req, res) => {
  const db = getDb();
  const { publication, year } = req.query;

  const rows = db.prepare(`
    SELECT c.wp_id, c.url, c.title, c.published_at,
      a.true_value, a.ga4_users, a.ga4_pageviews, a.ga4_subscribe_clicks,
      a.mf_newsletter_signups, a.ga4_loyal_users, a.ga4_avg_engagement_time
    FROM content c
    LEFT JOIN (
      SELECT wp_id, MAX(snapshot_at) AS latest FROM analytics_snapshots GROUP BY wp_id
    ) lx ON c.wp_id = lx.wp_id
    LEFT JOIN analytics_snapshots a ON a.wp_id = lx.wp_id AND a.snapshot_at = lx.latest
    WHERE c.url LIKE '%/publications/%'
      AND c.published_at >= date('now', '-2 years')
  `).all();

  const MONTH_ORDER = { january:1, february:2, march:3, april:4, may:5, june:6, july:7, august:8, september:9, october:10, november:11, december:12 };
  const issueMap = {};

  for (const row of rows) {
    // Requires a slug segment after the month (…/month/some-article-slug/),
    // which excludes the issue's own bare landing page (…/month/ with nothing
    // after it — e.g. a page literally titled "May") from being counted as
    // an article or winning "top article" by traffic alone.
    const match = row.url.match(/\/publications\/([^/]+)\/(\d{4})\/([^/]+)\/([^/]+)\//);
    if (!match) continue;
    const [, pub, yr, mo] = match;

    if (publication && pub !== publication) continue;
    if (year && yr !== year) continue;

    const key = `${pub}|${yr}|${mo}`;
    if (!issueMap[key]) {
      issueMap[key] = {
        publication: pub, year: yr, month: mo,
        article_count: 0, total_true_value: 0, total_users: 0,
        total_pageviews: 0, total_subscribe_clicks: 0, total_newsletter_signups: 0,
        total_loyal_users: 0, _eng_sum: 0, _eng_count: 0,
        top_article: null,
      };
    }
    const issue = issueMap[key];
    issue.article_count++;
    issue.total_true_value += row.true_value || 0;
    issue.total_users += row.ga4_users || 0;
    issue.total_pageviews += row.ga4_pageviews || 0;
    issue.total_subscribe_clicks += row.ga4_subscribe_clicks || 0;
    issue.total_newsletter_signups += row.mf_newsletter_signups || 0;
    issue.total_loyal_users += row.ga4_loyal_users || 0;
    if (row.ga4_avg_engagement_time) {
      issue._eng_sum += row.ga4_avg_engagement_time;
      issue._eng_count++;
    }
    if (!issue.top_article || (row.true_value || 0) > (issue.top_article.true_value || 0)) {
      issue.top_article = { wp_id: row.wp_id, title: row.title, url: row.url, true_value: row.true_value };
    }
  }

  const result = Object.values(issueMap).map(({ _eng_sum, _eng_count, ...issue }) => ({
    ...issue,
    avg_engagement_time: _eng_count > 0 ? _eng_sum / _eng_count : 0,
  }));

  result.sort((a, b) => {
    if (b.year !== a.year) return Number(b.year) - Number(a.year);
    return (MONTH_ORDER[b.month.toLowerCase()] || 0) - (MONTH_ORDER[a.month.toLowerCase()] || 0);
  });

  res.json(result);
});

// GET /api/analytics/source-performance
// GA4 channel-level conversion rates — direct measurement, no attribution.
//
// Raw rate (clicks * 1000 / users) is unstable at low volume: a channel with
// 1 click from 9 users reports a 111/1k rate that looks like a top performer
// but is really just noise. `opportunity_per_1k` is the lower bound of a 95%
// Wilson score interval on the click rate — it shrinks toward 0 as sample
// size shrinks, so small-sample channels stop dominating rankings without
// hiding them outright. `low_confidence` flags channels below a minimum
// sample size so the UI can badge/warn on them regardless of which column
// is sorted.
const MIN_USERS_FOR_CONFIDENCE = 50;
const WILSON_Z = 1.96; // 95% CI

function wilsonInterval(successes, n) {
  if (n <= 0) return { lower: 0, upper: 0 };
  const p = successes / n;
  const z2 = WILSON_Z * WILSON_Z;
  const denom = 1 + z2 / n;
  const center = p + z2 / (2 * n);
  const margin = WILSON_Z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return {
    lower: Math.max(0, (center - margin) / denom),
    upper: Math.min(1, (center + margin) / denom),
  };
}

// Shapes a raw {users, subscribe_clicks, ad_revenue} row into the derived
// rate/confidence fields shared by /source-performance and /channels.
function shapeGA4Row(r) {
  const users = r.users || 0;
  const clicks = r.subscribe_clicks || 0;
  const ci = wilsonInterval(clicks, users);
  return {
    ...r,
    sub_per_1k: users > 0 ? Math.round((clicks * 1000 / users) * 100) / 100 : 0,
    rev_per_1k: users > 0 ? Math.round(((r.ad_revenue || 0) * 1000 / users) * 100) / 100 : 0,
    opportunity_per_1k: Math.round(ci.lower * 1000 * 100) / 100,
    sub_ci_upper_per_1k: Math.round(ci.upper * 1000 * 100) / 100,
    low_confidence: users < MIN_USERS_FOR_CONFIDENCE,
  };
}

router.get('/source-performance', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT channel, users, sessions, subscribe_clicks, avg_engagement_time, ad_revenue
    FROM source_performance
    WHERE snapshot_at = (SELECT MAX(snapshot_at) FROM source_performance)
  `).all();

  const result = rows.map(shapeGA4Row);
  result.sort((a, b) => b.opportunity_per_1k - a.opportunity_per_1k);
  res.json(result);
});

// Shared by /by-traffic-source and /channels: per-Marfeel-source volume
// totals (pageviews, users, loyal/in-market, newsletter signups), scoped to
// articles published in [dateFrom, dateTo] and optionally filtered by type.
//
// content_sources has one row per (article, source) — a real per-source
// pageview split. analytics_snapshots has only one row per article — GA4
// and Marfeel don't report users/loyal-users/in-market/newsletter broken
// down by referrer at all. A naive join of the two (one article row against
// its N source rows) duplicates that article's FULL user count onto every
// one of its sources — an article with 200 users split across 5 sources
// would contribute 200 users to EACH source, 1,000 total, which is how a
// channel ends up reporting more users than pageviews. Instead we allocate
// each article's user-derived metrics across its sources proportionally by
// that source's share of the article's pageviews — an estimate (GA4/Marfeel
// don't tell us the true per-source split), but one that conserves the
// article's real total instead of multiplying it, and can never let a
// channel's estimated users exceed the traffic that produced them.
function fetchSourceRows(db, { dateFrom, dateTo, type }) {
  const where = ["cs.snapshot_at = lx.latest"];
  const params = [];
  if (dateFrom) { where.push('c.published_at >= ?'); params.push(dateFrom); }
  if (dateTo)   { where.push('c.published_at <= ?'); params.push(dateTo + 'T23:59:59'); }
  if (type)     { where.push('c.content_type = ?'); params.push(type); }

  const rows = db.prepare(`
    WITH article_totals AS (
      SELECT cs.wp_id, SUM(cs.pageviews) AS article_pageviews
      FROM content_sources cs
      JOIN (
        SELECT wp_id, MAX(snapshot_at) AS latest FROM content_sources GROUP BY wp_id
      ) lx ON cs.wp_id = lx.wp_id AND cs.snapshot_at = lx.latest
      GROUP BY cs.wp_id
    )
    SELECT
      cs.source,
      SUM(cs.pageviews)               AS total_pageviews,
      COUNT(DISTINCT cs.wp_id)        AS article_count,
      SUM(CASE WHEN at.article_pageviews > 0 THEN a.ga4_users * cs.pageviews * 1.0 / at.article_pageviews ELSE 0 END)             AS total_users,
      SUM(CASE WHEN at.article_pageviews > 0 THEN a.ga4_loyal_users * cs.pageviews * 1.0 / at.article_pageviews ELSE 0 END)       AS total_loyal_users,
      SUM(CASE WHEN at.article_pageviews > 0 THEN a.ga4_loyal_inmarket_pv * cs.pageviews * 1.0 / at.article_pageviews ELSE 0 END) AS total_inmarket,
      SUM(CASE WHEN at.article_pageviews > 0 THEN a.mf_newsletter_signups * cs.pageviews * 1.0 / at.article_pageviews ELSE 0 END) AS total_newsletter_signups
    FROM content_sources cs
    JOIN (
      SELECT wp_id, MAX(snapshot_at) AS latest FROM content_sources GROUP BY wp_id
    ) lx ON cs.wp_id = lx.wp_id
    JOIN content c ON c.wp_id = cs.wp_id
    JOIN article_totals at ON at.wp_id = cs.wp_id
    LEFT JOIN (
      SELECT wp_id, MAX(snapshot_at) AS latest FROM analytics_snapshots GROUP BY wp_id
    ) lxa ON cs.wp_id = lxa.wp_id
    LEFT JOIN analytics_snapshots a ON a.wp_id = lxa.wp_id AND a.snapshot_at = lxa.latest
    WHERE ${where.join(' AND ')}
    GROUP BY cs.source
    ORDER BY total_pageviews DESC
  `).all(...params);

  // Round the now-fractional allocated metrics back to whole numbers for display.
  return rows.map(r => ({
    ...r,
    total_users: Math.round(r.total_users || 0),
    total_loyal_users: Math.round(r.total_loyal_users || 0),
    total_inmarket: Math.round(r.total_inmarket || 0),
    total_newsletter_signups: Math.round(r.total_newsletter_signups || 0),
  }));
}

// GET /api/analytics/by-traffic-source
// Returns per-source totals across all content, joined to content metadata for date filtering.
router.get('/by-traffic-source', (req, res) => {
  const db = getDb();
  const { dateFrom, dateTo, type } = req.query;
  res.json(fetchSourceRows(db, { dateFrom, dateTo, type }));
});

// Custom channel taxonomy — buckets raw Marfeel `source` values (article-level,
// date-scoped via published_at) into the groups shown in the Sources tab.
const CUSTOM_CHANNELS = {
  search: {
    label: 'Search Engines',
    color: '#2474bb',
    sources: new Set(['Google', 'Bing', 'DuckDuckGo', 'Yahoo!', 'Ecosia', 'Google News',
                      'Yandex', 'Brave', 'Baidu']),
  },
  discover: {
    label: 'Google Discover',
    color: '#e67e22',
    sources: new Set(['Google Discover']),
  },
  dark_social: {
    label: 'Dark Social',
    color: '#8e44ad',
    sources: new Set(['dark social']),
  },
  direct: {
    label: 'Direct / Bookmark',
    color: '#27ae60',
    sources: new Set(['direct', 'bookmark']),
  },
  social: {
    label: 'Social Media',
    color: '#e74c3c',
    sources: new Set(['Facebook', 'Reddit', 'Twitter', 'Instagram', 'LinkedIn',
                      'Bluesky', 'Threads', 'Pinterest', 'Nextdoor', 'nextdoor.com',
                      'later-linkinbio', 'linkin.bio', 'ig', 'com.reddit.frontpage',
                      'old.reddit.com', 'linktr.ee']),
  },
  email: {
    label: 'Email',
    color: '#f39c12',
    sources: new Set(['hs_email', 'newsletter', 'omnisend', 'Gmail', 'WEBCTA',
                      'pushengage', 'hub.marfeel.com']),
  },
  ai: {
    label: 'AI Referral',
    color: '#1abc9c',
    sources: new Set(['ChatGPT', 'Claude', 'Perplexity', 'perplexity.ai']),
  },
  referral: {
    label: 'Referral',
    color: '#95a5a6',
    sources: new Set(), // catch-all for everything else
  },
};

function customChannelFor(source) {
  for (const [key, ch] of Object.entries(CUSTOM_CHANNELS)) {
    if (key === 'referral') continue;
    if (ch.sources.has(source)) return key;
  }
  return 'referral';
}

// GA4's `sessionDefaultChannelGrouping` is a DIFFERENT taxonomy than the
// Marfeel-source buckets above, built by a different vendor with different
// detection logic, over a fixed trailing-30-day window (GA4's API doesn't
// support the arbitrary date ranges this page filters by). We only attach
// GA4 conversion metrics to a custom channel where the mapping is a
// reasonable single-channel match — everywhere else we say so explicitly
// instead of guessing a split. See notes below for the two known conflations.
const GA4_TO_CUSTOM_CHANNEL = {
  'Organic Search': 'search',
  'Organic Social': 'social',
  'Email': 'email',
  'AI Assistant': 'ai',
  'Referral': 'referral',
};

const GA4_UNAVAILABLE_NOTES = {
  discover: 'GA4 groups Google Discover into "Organic Search" and can\'t isolate it — conversion metrics are included in the Search Engines row instead of shown here.',
  direct: 'GA4\'s "Direct" channel can\'t distinguish true direct/bookmark traffic from dark social — conversion metrics aren\'t split between the two, so neither is shown here.',
  dark_social: 'GA4\'s "Direct" channel can\'t distinguish dark social from true direct/bookmark traffic — conversion metrics aren\'t split between the two, so neither is shown here.',
};

// GET /api/analytics/channels
// The unified Sources view: custom (Marfeel-source-derived, date-scoped)
// volume metrics merged with GA4 (channel-level, trailing-30-day) conversion
// metrics, joined through an explicit, honest mapping between the two
// taxonomies rather than a blended/approximated single metric set.
router.get('/channels', (req, res) => {
  const db = getDb();
  const { dateFrom, dateTo, type } = req.query;

  const sourceRows = fetchSourceRows(db, { dateFrom, dateTo, type });

  const buckets = {};
  for (const key of Object.keys(CUSTOM_CHANNELS)) {
    buckets[key] = {
      key,
      label: CUSTOM_CHANNELS[key].label,
      color: CUSTOM_CHANNELS[key].color,
      pageviews: 0, users: 0, loyal_users: 0, inmarket_pv: 0, newsletter_signups: 0,
      article_count: 0,
      sources: [],
    };
  }

  for (const row of sourceRows) {
    const key = customChannelFor(row.source);
    const b = buckets[key];
    b.pageviews          += row.total_pageviews || 0;
    b.users              += row.total_users || 0;
    b.loyal_users        += row.total_loyal_users || 0;
    b.inmarket_pv        += row.total_inmarket || 0;
    b.newsletter_signups += row.total_newsletter_signups || 0;
    b.article_count      += row.article_count || 0;
    b.sources.push({
      source: row.source,
      pageviews: row.total_pageviews || 0,
      article_count: row.article_count || 0,
      users: row.total_users || 0,
      loyal_users: row.total_loyal_users || 0,
      inmarket_pv: row.total_inmarket || 0,
      newsletter_signups: row.total_newsletter_signups || 0,
    });
  }

  const channels = Object.values(buckets)
    .filter(b => b.pageviews > 0)
    .map(b => ({
      ...b,
      loyal_pct:    b.users > 0 ? (b.loyal_users / b.users) * 100 : 0,
      inmarket_pct: b.users > 0 ? (b.inmarket_pv / b.users) * 100 : 0,
      news_per_1k:  b.users > 0 ? (b.newsletter_signups / b.users) * 1000 : 0,
      sources: b.sources.sort((a, b2) => b2.pageviews - a.pageviews),
    }));

  const maxLoyal = Math.max(...channels.map(c => c.loyal_pct), 0.01);
  const maxInmkt = Math.max(...channels.map(c => c.inmarket_pct), 0.01);
  const maxNews  = Math.max(...channels.map(c => c.news_per_1k), 0.01);
  for (const c of channels) {
    c.score = Math.round(
      (c.loyal_pct    / maxLoyal) * 35 +
      (c.inmarket_pct / maxInmkt) * 30 +
      (c.news_per_1k  / maxNews)  * 35
    );
  }

  // ── Merge in GA4 conversion metrics via the explicit mapping ──────────────
  const ga4Snapshot = db.prepare(`
    SELECT MAX(snapshot_at) AS snapshot_at FROM source_performance
  `).get();
  const ga4Rows = db.prepare(`
    SELECT channel, users, sessions, subscribe_clicks, avg_engagement_time, ad_revenue
    FROM source_performance
    WHERE snapshot_at = (SELECT MAX(snapshot_at) FROM source_performance)
  `).all();

  const unmapped = { channels: [], users: 0, sessions: 0, subscribe_clicks: 0, ad_revenue: 0 };
  const byCustomKey = {};
  for (const row of ga4Rows) {
    const customKey = GA4_TO_CUSTOM_CHANNEL[row.channel];
    if (!customKey) {
      unmapped.channels.push(row.channel);
      unmapped.users            += row.users || 0;
      unmapped.sessions         += row.sessions || 0;
      unmapped.subscribe_clicks += row.subscribe_clicks || 0;
      unmapped.ad_revenue       += row.ad_revenue || 0;
      continue;
    }
    // Each custom key maps from at most one GA4 channel today, but sum
    // defensively in case GA4 ever splits a channel we treat as 1:1.
    if (!byCustomKey[customKey]) byCustomKey[customKey] = { users: 0, sessions: 0, subscribe_clicks: 0, ad_revenue: 0 };
    byCustomKey[customKey].users            += row.users || 0;
    byCustomKey[customKey].sessions         += row.sessions || 0;
    byCustomKey[customKey].subscribe_clicks += row.subscribe_clicks || 0;
    byCustomKey[customKey].ad_revenue       += row.ad_revenue || 0;
  }

  for (const c of channels) {
    const raw = byCustomKey[c.key];
    if (raw) {
      c.ga4 = { status: 'approximate', note: 'GA4 and Marfeel classify traffic differently and GA4 always reflects a trailing 30 days, regardless of the date filter above — treat as directional.', ...shapeGA4Row(raw) };
    } else {
      c.ga4 = { status: 'unavailable', note: GA4_UNAVAILABLE_NOTES[c.key] || 'GA4 has no channel that reliably maps to this group.' };
    }
  }

  channels.sort((a, b) => b.pageviews - a.pageviews);

  res.json({
    dateFrom: dateFrom || null,
    dateTo: dateTo || null,
    type: type || null,
    ga4_snapshot_at: ga4Snapshot?.snapshot_at || null,
    channels,
    unmapped_ga4: unmapped,
    volume_metrics_note: 'Users, Loyal %, In-Market %, and Newsletter Signups are estimated per channel by splitting each article\'s total figures proportionally by pageview share across its traffic sources — GA4 and Marfeel report these per article, not broken down by individual source.',
  });
});

// ── AI vulnerability heuristics ─────────────────────────────────────────────
// Not all search traffic is equally at risk from AI Overviews / AI Mode.
// Generic, easily-summarized queries (explainers, how-tos, "best of" lists)
// get absorbed into an AI answer box. Queries anchored to a proper noun
// (a person, a specific business, a hyperlocal place) or driven by original
// reporting and voice are much harder for an AI summary to substitute for.
// These heuristics estimate that distinction from title text and user need,
// since we don't have real search-query data (Search Console) to work from.

const NEED_RISK_MULTIPLIER = {
  educate_me: 1.3,       // explainers/how-tos — AI's strongest use case
  update_me: 1.15,       // news recaps — facts are summarizable
  help_me: 1.2,          // task/recommendation content — close to AI's sweet spot
  keep_me_engaged: 0.85,
  divert_me: 0.75,       // entertainment/experience-based
  give_perspective: 0.6, // opinion/analysis — relies on voice
  inspire_me: 0.6,       // narrative/profile-driven — human-centric
  connect_me: 0.55,      // community/relationship content
};

const LOCAL_MARKERS = [
  'dallas', 'fort worth', 'plano', 'irving', 'arlington', 'frisco', 'mckinney',
  'garland', 'denton', 'richardson', 'lewisville', 'carrollton', 'allen',
  'mesquite', 'grand prairie', 'dfw', 'north texas', 'uptown', 'oak lawn',
  'oak cliff', 'deep ellum', 'bishop arts', 'preston hollow', 'lakewood',
  'highland park', 'university park',
];

const TITLE_STOPWORDS = new Set([
  'A', 'An', 'And', 'As', 'At', 'But', 'By', 'For', 'From', 'In', 'Into', 'Is',
  'Of', 'On', 'Or', 'Over', 'So', 'The', 'To', 'With', 'Why', 'What', 'How',
  'When', 'Where', 'Who', 'Best', 'Top', 'New', 'Most', 'Meet', 'Are', 'Was',
  'Were', 'Be', 'Been', 'Being', 'This', 'That', 'These', 'Those', 'It', 'Its',
  'You', 'Your', 'We', 'Our', 'My', 'His', 'Her', 'Their', 'Not', 'No', 'Yes',
  'Amid', 'After', 'Before', 'During', 'About', 'Than', 'Then', 'Now', 'Here',
  'There', 'Just', 'Only', 'More', 'Less', 'All', 'Every', 'Each', 'Some',
  'Any', 'Get', 'Gets', 'Getting', 'Makes', 'Made', 'Make', 'Says', 'Said',
]);

function stripHtml(str) {
  return (str || '').replace(/<[^>]+>/g, '').replace(/&#\d+;/g, ' ').replace(/&[a-z]+;/gi, ' ');
}

// Estimate how "generic" a title is: proper-noun anchored / hyperlocal titles
// get a lower (more durable) factor, generic listicle/how-to titles get higher.
// Also returns the extracted entity tokens, reused to classify real GSC queries.
function computeGenericFactor(rawTitle) {
  const title = stripHtml(rawTitle).trim();
  if (!title) return { generic_factor: 1, proper_noun_count: 0, is_listicle: false, has_local: false, entities: [] };

  const words = title.split(/\s+/);
  let entityCount = 0;
  const entities = [];
  let i = 1; // skip first word — always capitalized regardless of being a proper noun
  while (i < words.length) {
    const w = words[i].replace(/[^\w'-]/g, '');
    if (/^[A-Z]/.test(w) && w.length > 1 && !TITLE_STOPWORDS.has(w)) {
      entityCount++;
      const entityWords = [w];
      let j = i + 1;
      while (j < words.length) {
        const w2 = words[j].replace(/[^\w'-]/g, '');
        if (/^[A-Z]/.test(w2) && w2.length > 1 && !TITLE_STOPWORDS.has(w2)) { entityWords.push(w2); j++; }
        else break;
      }
      if (entityWords.length >= 2) entities.push(entityWords.join(' ').toLowerCase());
      else if (entityWords[0].length > 3) entities.push(entityWords[0].toLowerCase());
      i = j;
    } else {
      i++;
    }
  }

  const lower = title.toLowerCase();
  const is_listicle = /^(the\s+)?(top\s+\d+|(\d+\s+)?(best|worst)\b|how to|guide to|everything you need to know|what is|why (you|we|is))/i.test(title);
  const has_local = LOCAL_MARKERS.some(m => lower.includes(m));

  let generic_factor = 1;
  if (entityCount >= 2) generic_factor *= 0.55;
  else if (entityCount === 1) generic_factor *= 0.8;
  if (is_listicle) generic_factor *= 1.25;
  if (has_local) generic_factor *= 0.9;
  generic_factor = Math.max(0.3, Math.min(1.4, generic_factor));

  return { generic_factor, proper_noun_count: entityCount, is_listicle, has_local, entities };
}

// Classify a real GSC search query as "branded/durable" (mentions the article's
// specific subject or a local place — hard for AI to intercept generically) or
// "generic" (an informational query an AI answer box can absorb).
function classifyQuery(query, entities) {
  const q = (query || '').toLowerCase();
  if (q.includes('dmagazine') || q.includes('d magazine')) return 'branded';
  if (LOCAL_MARKERS.some(m => q.includes(m))) return 'branded';
  if (entities.some(e => q.includes(e))) return 'branded';
  return 'generic';
}

// Given an article's GSC query rows, compute the share of clicks that came
// from generic (AI-vulnerable) queries rather than branded/specific ones.
function computeQueryRisk(queries, entities) {
  if (!queries || queries.length === 0) return null;
  let genericClicks = 0, totalClicks = 0;
  for (const q of queries) {
    totalClicks += q.clicks;
    if (classifyQuery(q.query, entities) === 'generic') genericClicks += q.clicks;
  }
  if (totalClicks === 0) return null;
  return {
    generic_click_share: (genericClicks / totalClicks) * 100,
    query_count: queries.length,
    total_clicks: totalClicks,
    top_queries: [...queries].sort((a, b) => b.clicks - a.clicks).slice(0, 5)
      .map(q => ({ query: q.query, clicks: q.clicks, type: classifyQuery(q.query, entities) })),
  };
}

// GET /api/analytics/vulnerability
// Three genuinely different questions, kept as three separate numbers rather
// than blended into one "risk" score:
//   1. AI susceptibility — how easily an answer engine can summarize this
//      content, from either real GSC query language (when we have it) or a
//      title/need-type heuristic (when we don't). A property of the CONTENT.
//   2. Search exposure — how much of the article's actual traffic (per
//      Marfeel's source breakdown) depends on organic search at all. A
//      property of its TRAFFIC MIX. An article can be 100% summarizable and
//      still have nothing to lose if none of its readers arrive via search.
//   3. Confidence — how much to trust the susceptibility estimate: real GSC
//      data with a decent click sample earns high confidence; a handful of
//      GSC clicks or a title-only guess (no query data at all) earns low
//      confidence.
// impact_priority = true_value × susceptibility × exposure × confidence is
// the single ranking key — it can only be high when all three multiply up,
// so a highly summarizable article with negligible search exposure (or a
// low-confidence guess) correctly ranks low instead of looking like a
// contradiction ("100% risk, 0% search share").
router.get('/vulnerability', (req, res) => {
  const db = getDb();

  const SEARCH_SOURCES = new Set([
    'Google', 'Bing', 'DuckDuckGo', 'Yahoo!', 'Ecosia',
    'Google News', 'Google Discover', 'Yandex', 'Brave', 'Baidu',
  ]);

  // Per-article source pageviews from latest Marfeel snapshot
  const sourceRows = db.prepare(`
    SELECT cs.wp_id, cs.source, SUM(cs.pageviews) AS pv
    FROM content_sources cs
    JOIN (
      SELECT wp_id, MAX(snapshot_at) AS latest FROM content_sources GROUP BY wp_id
    ) lx ON cs.wp_id = lx.wp_id AND cs.snapshot_at = lx.latest
    GROUP BY cs.wp_id, cs.source
  `).all();

  const srcMap = {};
  for (const row of sourceRows) {
    if (!srcMap[row.wp_id]) srcMap[row.wp_id] = { search_pv: 0, total_pv: 0 };
    srcMap[row.wp_id].total_pv += row.pv;
    if (SEARCH_SOURCES.has(row.source)) srcMap[row.wp_id].search_pv += row.pv;
  }

  const articles = db.prepare(`
    SELECT c.wp_id, c.title, c.url, c.user_need, c.section, c.published_at,
      a.true_value, a.ga4_users, a.ga4_pageviews, a.mf_newsletter_signups
    FROM content c
    LEFT JOIN (
      SELECT wp_id, MAX(snapshot_at) AS latest FROM analytics_snapshots GROUP BY wp_id
    ) lx ON c.wp_id = lx.wp_id
    LEFT JOIN analytics_snapshots a ON a.wp_id = lx.wp_id AND a.snapshot_at = lx.latest
    WHERE c.user_need IS NOT NULL
  `).all();

  // Real search queries from the latest GSC snapshot, grouped by article.
  const gscRows = db.prepare(`
    SELECT wp_id, query, clicks, impressions, ctr, position
    FROM gsc_queries
    WHERE snapshot_at = (SELECT MAX(snapshot_at) FROM gsc_queries)
  `).all();
  const gscByWpId = {};
  for (const row of gscRows) {
    if (!gscByWpId[row.wp_id]) gscByWpId[row.wp_id] = [];
    gscByWpId[row.wp_id].push(row);
  }

  const enriched = articles.map(art => {
    const s = srcMap[art.wp_id] || { search_pv: 0, total_pv: 0 };
    const search_exposure_pct = s.total_pv > 0 ? (s.search_pv / s.total_pv) * 100 : 0;
    const { generic_factor, proper_noun_count, is_listicle, has_local, entities } = computeGenericFactor(art.title);
    const need_mult = NEED_RISK_MULTIPLIER[art.user_need] ?? 1;

    // Prefer real GSC query classification when we have it — it directly
    // measures what people searched, not a title-text guess.
    const queryRisk = computeQueryRisk(gscByWpId[art.wp_id], entities);
    const risk_source = queryRisk ? 'gsc' : 'estimated';

    // AI susceptibility: how summarizable the CONTENT is, independent of how
    // much traffic currently depends on search. GSC path is grounded in what
    // people actually searched; the title-based fallback is clamped well
    // short of 0/100 since it's inferring from title text alone.
    const susceptibility_pct = queryRisk
      ? Math.min(100, queryRisk.generic_click_share * need_mult)
      : Math.min(95, Math.max(5, need_mult * generic_factor * 55));

    // Confidence in that susceptibility estimate: real query data with a
    // decent click sample earns high confidence; a handful of GSC clicks or
    // a pure title guess (no observed query behavior at all) earns low
    // confidence — same small-sample caution as the Sources tab's Wilson
    // interval work, just expressed as a simple multiplier here.
    const confidence = queryRisk
      ? Math.min(1, 0.5 + 0.5 * Math.min(1, queryRisk.total_clicks / 10))
      : 0.4;

    // The single ranking key: only high when the content is genuinely
    // summarizable AND actually depends on search traffic AND we trust the
    // estimate — a 100%-susceptible article with 0% search exposure
    // correctly lands near zero instead of looking like a contradiction.
    const impact_priority = (art.true_value || 0)
      * (susceptibility_pct / 100) * (search_exposure_pct / 100) * confidence;

    return {
      ...art, search_exposure_pct, susceptibility_pct, confidence, impact_priority, risk_source,
      search_pv: s.search_pv, total_source_pv: s.total_pv,
      proper_noun_count, is_listicle, has_local, need_mult,
      generic_factor: risk_source === 'estimated' ? generic_factor : null,
      generic_click_share: queryRisk?.generic_click_share ?? null,
      gsc_click_count: queryRisk?.total_clicks ?? null,
      top_queries: queryRisk?.top_queries || null,
    };
  });

  // Aggregate by user need
  const needMap = {};
  for (const art of enriched) {
    const n = art.user_need;
    if (!needMap[n]) needMap[n] = {
      user_need: n, article_count: 0, high_susceptibility_count: 0, total_true_value: 0,
      total_users: 0, total_newsletter_signups: 0,
      _exposure_sum: 0, _susc_sum: 0, _impact_sum: 0, _arts: [],
    };
    needMap[n].article_count++;
    needMap[n].total_true_value += art.true_value || 0;
    needMap[n].total_users += art.ga4_users || 0;
    needMap[n].total_newsletter_signups += art.mf_newsletter_signups || 0;
    needMap[n]._exposure_sum += art.search_exposure_pct;
    needMap[n]._susc_sum += art.susceptibility_pct;
    needMap[n]._impact_sum += art.impact_priority;
    if (art.susceptibility_pct > 50) needMap[n].high_susceptibility_count++;
    needMap[n]._arts.push(art);
  }

  const byNeed = Object.values(needMap).map(({ _exposure_sum, _susc_sum, _impact_sum, _arts, ...n }) => {
    const avg_search_exposure_pct = n.article_count > 0 ? _exposure_sum / n.article_count : 0;
    const avg_susceptibility_pct = n.article_count > 0 ? _susc_sum / n.article_count : 0;
    const total_impact_priority = _impact_sum;
    const newsletter_per_1k = n.total_users > 0 ? (n.total_newsletter_signups / n.total_users) * 1000 : 0;
    const top_impact = _arts
      .filter(a => a.true_value > 0)
      .sort((a, b) => b.impact_priority - a.impact_priority)
      .slice(0, 3)
      .map(({ _arts, ...a }) => a);
    return { ...n, avg_search_exposure_pct, avg_susceptibility_pct, total_impact_priority, newsletter_per_1k, top_impact };
  }).sort((a, b) => b.total_impact_priority - a.total_impact_priority);

  // Strategic strengths — needs ranked by owned-platform conversion (newsletter
  // signups per 1k users), the counter-signal to search dependency.
  const strategicStrengths = [...byNeed]
    .filter(n => n.total_users > 0)
    .sort((a, b) => b.newsletter_per_1k - a.newsletter_per_1k)
    .slice(0, 5);

  // Top 25 articles by impact priority — the content with the most real,
  // multiplicative reason to worry (valuable, summarizable, search-dependent,
  // and estimated with reasonable confidence), not just the highest single
  // factor in isolation.
  const top_vulnerable = enriched
    .filter(a => (a.true_value || 0) > 0 && a.total_source_pv > 100)
    .sort((a, b) => b.impact_priority - a.impact_priority)
    .slice(0, 25);

  const gsc_coverage = {
    articles_with_real_data: enriched.filter(a => a.risk_source === 'gsc').length,
    articles_total: enriched.length,
  };

  res.json({ by_need: byNeed, top_vulnerable, strategic_strengths: strategicStrengths, gsc_coverage });
});

export default router;
