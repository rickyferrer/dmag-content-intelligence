import { Router } from 'express';
import { getDb } from '../db.js';

const router = Router();

// GET /api/analytics/summary
router.get('/summary', (req, res) => {
  const db = getDb();
  const { dateFrom, dateTo, section, type } = req.query;

  const dateWhere = [];
  const dateParams = [];
  if (dateFrom)  { dateWhere.push('c.published_at >= ?'); dateParams.push(dateFrom); }
  if (dateTo)    { dateWhere.push('c.published_at <= ?'); dateParams.push(dateTo + 'T23:59:59'); }
  if (section)   { dateWhere.push('c.section = ?'); dateParams.push(section); }
  if (type)      { dateWhere.push('c.content_type = ?'); dateParams.push(type); }
  const dateFilter = dateWhere.length ? 'WHERE ' + dateWhere.join(' AND ') : '';

  const total = db.prepare(`SELECT COUNT(*) as count FROM content c ${dateFilter}`).get(...dateParams);

  const latest = db.prepare(`
    SELECT
      AVG(CASE WHEN a.true_value > 0 THEN a.true_value END) as avg_true_value,
      SUM(a.ga4_pageviews) as total_pageviews,
      SUM(a.ga4_loyal_inmarket_pv) as total_loyal_inmarket,
      SUM(a.ga4_users) as total_users,
      SUM(a.ga4_subscribe_clicks) as total_subscribe_clicks,
      SUM(a.ga4_ad_revenue) as total_ad_revenue,
      AVG(a.ga4_avg_engagement_time) as avg_engagement_time
    FROM content c
    JOIN (
      SELECT wp_id, MAX(snapshot_at) as latest FROM analytics_snapshots GROUP BY wp_id
    ) lx ON c.wp_id = lx.wp_id
    JOIN analytics_snapshots a ON a.wp_id = lx.wp_id AND a.snapshot_at = lx.latest
    ${dateFilter}
  `).get(...dateParams);

  const loyalInMarketPct = latest.total_users > 0
    ? Math.min(100, (latest.total_loyal_inmarket / latest.total_users) * 100)
    : 0;

  res.json({
    total_content: total.count,
    avg_true_value: latest.avg_true_value || 0,
    total_pageviews: latest.total_pageviews || 0,
    loyal_inmarket_pct: loyalInMarketPct,
    total_subscribe_clicks: latest.total_subscribe_clicks || 0,
    total_ad_revenue: latest.total_ad_revenue || 0,
    avg_engagement_time: latest.avg_engagement_time || 0,
  });
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
      AVG(true_value) as avg_true_value,
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
    const match = row.url.match(/\/publications\/([^/]+)\/(\d{4})\/([^/]+)\//);
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
router.get('/source-performance', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT channel, users, sessions, subscribe_clicks, avg_engagement_time, ad_revenue,
      CASE WHEN users > 0 THEN ROUND(subscribe_clicks * 1000.0 / users, 2) ELSE 0 END AS sub_per_1k,
      CASE WHEN users > 0 THEN ROUND(ad_revenue * 1000.0 / users, 2) ELSE 0 END AS rev_per_1k
    FROM source_performance
    WHERE snapshot_at = (SELECT MAX(snapshot_at) FROM source_performance)
    ORDER BY users DESC
  `).all();
  res.json(rows);
});

// GET /api/analytics/by-traffic-source
// Returns per-source totals across all content, joined to content metadata for date filtering.
router.get('/by-traffic-source', (req, res) => {
  const db = getDb();
  const { dateFrom, dateTo, type } = req.query;

  const where = ["cs.snapshot_at = lx.latest"];
  const params = [];
  if (dateFrom) { where.push('c.published_at >= ?'); params.push(dateFrom); }
  if (dateTo)   { where.push('c.published_at <= ?'); params.push(dateTo + 'T23:59:59'); }
  if (type)     { where.push('c.content_type = ?'); params.push(type); }

  const rows = db.prepare(`
    SELECT
      cs.source,
      SUM(cs.pageviews)               AS total_pageviews,
      COUNT(DISTINCT cs.wp_id)        AS article_count,
      SUM(a.ga4_users)                AS total_users,
      SUM(a.ga4_loyal_users)          AS total_loyal_users,
      SUM(a.ga4_loyal_inmarket_pv)    AS total_inmarket,
      SUM(a.mf_newsletter_signups)    AS total_newsletter_signups
    FROM content_sources cs
    JOIN (
      SELECT wp_id, MAX(snapshot_at) AS latest FROM content_sources GROUP BY wp_id
    ) lx ON cs.wp_id = lx.wp_id
    JOIN content c ON c.wp_id = cs.wp_id
    LEFT JOIN (
      SELECT wp_id, MAX(snapshot_at) AS latest FROM analytics_snapshots GROUP BY wp_id
    ) lxa ON cs.wp_id = lxa.wp_id
    LEFT JOIN analytics_snapshots a ON a.wp_id = lxa.wp_id AND a.snapshot_at = lxa.latest
    WHERE ${where.join(' AND ')}
    GROUP BY cs.source
    ORDER BY total_pageviews DESC
  `).all(...params);

  res.json(rows);
});

export default router;
