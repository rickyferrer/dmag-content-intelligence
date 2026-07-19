import { Router } from 'express';
import { getDb } from '../db.js';

const router = Router();

// Computes the summary aggregate for a fixed set of content (filtered by
// published_at/section/type) as of a given point in time.
//
// `asOf`, when set, pulls each article's most recent snapshot AT OR BEFORE
// that timestamp instead of its latest snapshot overall. This is what makes
// period-over-period comparison meaningful: GA4 metrics here are already a
// rolling trailing-30-day window as of sync time (see sync/ga4.js), so
// comparing "today's snapshot" to "the snapshot from ~30 days ago" for the
// SAME set of articles gives a real trend — whereas comparing two DIFFERENT
// article cohorts (e.g. this month's posts vs last month's posts), which is
// what filtering published_at differently for current vs previous would do,
// doesn't measure change over time at all.
function computeSummary(db, dateFrom, dateTo, section, type, asOf = null) {
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

function pctChange(curr, prev) {
  if (prev == null || prev === 0) return null;
  return ((curr - prev) / prev) * 100;
}

// GET /api/analytics/summary
router.get('/summary', (req, res) => {
  const db = getDb();
  const { dateFrom, dateTo, section, type } = req.query;

  const current = computeSummary(db, dateFrom, dateTo, section, type);

  // Only compute a comparison when there's an explicit range to derive a
  // duration from — "all time" has no meaningful "N days ago".
  let changes = {};
  if (dateFrom && dateTo) {
    const from = new Date(dateFrom + 'T00:00:00Z');
    const to = new Date(dateTo + 'T00:00:00Z');
    const durationDays = Math.max(1, Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)));
    const asOf = new Date(Date.now() - durationDays * 24 * 60 * 60 * 1000).toISOString();

    const previous = computeSummary(db, dateFrom, dateTo, section, type, asOf);

    // Guard against showing a wild percentage when we simply don't have
    // enough retained history yet to cover this comparison — e.g. asking
    // for a 30-day-ago snapshot when daily retention only started a few
    // days ago. Require most of the current cohort to have a real prior
    // snapshot before trusting the comparison at all.
    const coverage = current.total_content > 0 ? previous.matched_count / current.total_content : 0;

    if (coverage >= 0.5) {
      changes = {
        avg_true_value: pctChange(current.avg_true_value, previous.avg_true_value),
        total_users: pctChange(current.total_users, previous.total_users),
        total_loyal_users: pctChange(current.total_loyal_users, previous.total_loyal_users),
        total_subscribe_clicks: pctChange(current.total_subscribe_clicks, previous.total_subscribe_clicks),
        total_ad_revenue: pctChange(current.total_ad_revenue, previous.total_ad_revenue),
        total_newsletter_signups: pctChange(current.total_newsletter_signups, previous.total_newsletter_signups),
      };
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
// Crosses user need + title specificity with organic search dependency to
// estimate AI Overview / AI Mode risk — and surfaces owned-platform strength
// (newsletter conversion) as the strategic counter-signal.
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
    const search_pct = s.total_pv > 0 ? (s.search_pv / s.total_pv) * 100 : 0;
    const { generic_factor, proper_noun_count, is_listicle, has_local, entities } = computeGenericFactor(art.title);
    const need_mult = NEED_RISK_MULTIPLIER[art.user_need] ?? 1;

    // Prefer real GSC query classification when we have it — it directly
    // measures what people searched, not a title-text guess.
    const queryRisk = computeQueryRisk(gscByWpId[art.wp_id], entities);
    const risk_source = queryRisk ? 'gsc' : 'estimated';
    const adjusted_risk_pct = queryRisk
      ? Math.min(100, queryRisk.generic_click_share * need_mult)
      : Math.min(100, search_pct * need_mult * generic_factor);

    return {
      ...art, search_pct, adjusted_risk_pct, risk_source,
      search_pv: s.search_pv, total_source_pv: s.total_pv,
      proper_noun_count, is_listicle, has_local,
      top_queries: queryRisk?.top_queries || null,
    };
  });

  // Aggregate by user need
  const needMap = {};
  for (const art of enriched) {
    const n = art.user_need;
    if (!needMap[n]) needMap[n] = {
      user_need: n, article_count: 0, high_risk_count: 0, total_true_value: 0,
      total_users: 0, total_newsletter_signups: 0,
      _search_sum: 0, _adj_sum: 0, _arts: [],
    };
    needMap[n].article_count++;
    needMap[n].total_true_value += art.true_value || 0;
    needMap[n].total_users += art.ga4_users || 0;
    needMap[n].total_newsletter_signups += art.mf_newsletter_signups || 0;
    needMap[n]._search_sum += art.search_pct;
    needMap[n]._adj_sum += art.adjusted_risk_pct;
    if (art.adjusted_risk_pct > 50) needMap[n].high_risk_count++;
    needMap[n]._arts.push(art);
  }

  const byNeed = Object.values(needMap).map(({ _search_sum, _adj_sum, _arts, ...n }) => {
    const avg_search_pct = n.article_count > 0 ? _search_sum / n.article_count : 0;
    const avg_adjusted_risk_pct = n.article_count > 0 ? _adj_sum / n.article_count : 0;
    const value_at_risk = n.total_true_value * (avg_adjusted_risk_pct / 100);
    const newsletter_per_1k = n.total_users > 0 ? (n.total_newsletter_signups / n.total_users) * 1000 : 0;
    const top_vulnerable = _arts
      .filter(a => a.adjusted_risk_pct > 30 && a.true_value > 0)
      .sort((a, b) => b.true_value * (b.adjusted_risk_pct / 100) - a.true_value * (a.adjusted_risk_pct / 100))
      .slice(0, 3)
      .map(({ _arts, ...a }) => a);
    return { ...n, avg_search_pct, avg_adjusted_risk_pct, value_at_risk, newsletter_per_1k, top_vulnerable };
  }).sort((a, b) => b.value_at_risk - a.value_at_risk);

  // Strategic strengths — needs ranked by owned-platform conversion (newsletter
  // signups per 1k users), the counter-signal to search dependency.
  const strategicStrengths = [...byNeed]
    .filter(n => n.total_users > 0)
    .sort((a, b) => b.newsletter_per_1k - a.newsletter_per_1k)
    .slice(0, 5);

  // Top 25 most vulnerable articles overall, by adjusted risk
  const top_vulnerable = enriched
    .filter(a => a.adjusted_risk_pct > 40 && (a.true_value || 0) > 0 && a.total_source_pv > 100)
    .sort((a, b) => (b.true_value * b.adjusted_risk_pct) - (a.true_value * a.adjusted_risk_pct))
    .slice(0, 25);

  const gsc_coverage = {
    articles_with_real_data: enriched.filter(a => a.risk_source === 'gsc').length,
    articles_total: enriched.length,
  };

  res.json({ by_need: byNeed, top_vulnerable, strategic_strengths: strategicStrengths, gsc_coverage });
});

export default router;
