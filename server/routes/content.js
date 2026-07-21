import { Router } from 'express';
import { getDb, getSettings } from '../db.js';
import { classifySingle } from '../classify/userNeeds.js';
import { getValueBreakdown } from '../utils/trueValue.js';

const router = Router();

// GET /api/content
router.get('/', (req, res) => {
  const db = getDb();
  const {
    type, section, category, tag, need, writer, issue, search,
    dateFrom, dateTo,
    sortBy = 'published_at', order = 'desc',
    page = 1, limit = 50,
  } = req.query;

  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(200, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  const validSorts = {
    true_value: 'a.true_value',
    pageviews: 'a.ga4_pageviews',
    users: 'a.ga4_users',
    loyal_users: 'a.ga4_loyal_users',
    inmarket: 'CAST(a.ga4_inmarket_pageviews AS REAL) / NULLIF(a.ga4_users, 0)',
    engagement: 'a.ga4_avg_engagement_time',
    published_at: 'c.published_at',
    title: 'c.title',
    type: 'c.content_type',
    section: 'c.section',
    need: 'c.user_need',
    subscribe_clicks: 'a.ga4_subscribe_clicks',
    email_signups: 'a.ga4_email_signups',
    newsletter: 'a.mf_newsletter_signups',
    writer: 'c.writer',
  };
  const sortCol = validSorts[sortBy] || 'c.published_at';
  const sortDir = order === 'asc' ? 'ASC' : 'DESC';

  let where = [];
  let params = [];

  if (type) { where.push('c.content_type = ?'); params.push(type); }
  if (section) { where.push('c.section = ?'); params.push(section); }
  if (need) { where.push('c.user_need = ?'); params.push(need); }
  if (writer) { where.push('c.writer = ?'); params.push(writer); }
  if (dateFrom) { where.push('c.published_at >= ?'); params.push(dateFrom); }
  if (dateTo) { where.push('c.published_at <= ?'); params.push(dateTo + 'T23:59:59'); }
  if (category) { where.push("c.categories LIKE ?"); params.push(`%"slug":"${category}"%`); }
  if (tag) { where.push("c.tags LIKE ?"); params.push(`%"slug":"${tag}"%`); }
  if (issue) { where.push("c.url LIKE ?"); params.push(`%/publications/${issue}/%`); }
  if (search) { where.push('(c.title LIKE ? OR c.url LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }

  const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

  const rows = db.prepare(`
    SELECT
      c.wp_id, c.slug, c.url, c.title, c.content_type, c.author, c.writer,
      c.published_at, c.section, c.user_need, c.user_need_secondary,
      c.user_need_confidence, c.user_need_rationale, c.subscription_required,
      a.ga4_pageviews, a.ga4_users, a.ga4_loyal_users,
      a.ga4_inmarket_pageviews, a.ga4_loyal_inmarket_pv,
      a.ga4_avg_engagement_time, a.ga4_sessions,
      a.ga4_subscribe_clicks, a.ga4_email_signups, a.ga4_ad_revenue,
      a.mf_unique_users, a.mf_pageviews, a.mf_loyal_users,
      a.mf_scroll_depth, a.mf_newsletter_signups, a.true_value, a.snapshot_at
    FROM content c
    LEFT JOIN (
      SELECT wp_id, MAX(snapshot_at) as latest FROM analytics_snapshots GROUP BY wp_id
    ) latest_snap ON c.wp_id = latest_snap.wp_id
    LEFT JOIN analytics_snapshots a ON a.wp_id = latest_snap.wp_id AND a.snapshot_at = latest_snap.latest
    ${whereClause}
    ORDER BY ${sortCol} ${sortDir}
    LIMIT ? OFFSET ?
  `).all(...params, limitNum, offset);

  const total = db.prepare(`
    SELECT COUNT(*) as count FROM content c ${whereClause}
  `).get(...params).count;

  res.json({
    data: rows,
    pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) },
  });
});

// GET /api/content/types
router.get('/types', (req, res) => {
  const db = getDb();
  const types = db.prepare(
    'SELECT content_type, COUNT(*) as count FROM content GROUP BY content_type ORDER BY count DESC'
  ).all();
  res.json(types);
});

// GET /api/content/writers
router.get('/writers', (req, res) => {
  const db = getDb();
  const writers = db.prepare(`
    SELECT writer, COUNT(*) as count
    FROM content
    WHERE writer IS NOT NULL AND writer != ''
    GROUP BY writer
    ORDER BY count DESC
    LIMIT 200
  `).all();
  res.json(writers);
});

// GET /api/content/taxonomies
router.get('/taxonomies', (req, res) => {
  const db = getDb();
  const sections = db.prepare(
    "SELECT section, COUNT(*) as count FROM content WHERE section != '' GROUP BY section ORDER BY count DESC LIMIT 100"
  ).all();

  // Parse categories from JSON
  const catRows = db.prepare('SELECT categories FROM content WHERE categories IS NOT NULL').all();
  const catMap = new Map();
  for (const row of catRows) {
    try {
      const cats = JSON.parse(row.categories);
      for (const c of cats) {
        if (c.slug) catMap.set(c.slug, { slug: c.slug, name: c.name, count: (catMap.get(c.slug)?.count || 0) + 1 });
      }
    } catch { /* ignore */ }
  }

  const tagRows = db.prepare('SELECT tags FROM content WHERE tags IS NOT NULL').all();
  const tagMap = new Map();
  for (const row of tagRows) {
    try {
      const tags = JSON.parse(row.tags);
      for (const t of tags) {
        if (t.slug) tagMap.set(t.slug, { slug: t.slug, name: t.name, count: (tagMap.get(t.slug)?.count || 0) + 1 });
      }
    } catch { /* ignore */ }
  }

  res.json({
    sections,
    categories: [...catMap.values()].sort((a, b) => b.count - a.count).slice(0, 100),
    tags: [...tagMap.values()].sort((a, b) => b.count - a.count).slice(0, 200),
  });
});

// GET /api/content/:id
router.get('/:id', (req, res) => {
  const db = getDb();
  const wpId = parseInt(req.params.id);

  const item = db.prepare(`
    SELECT c.*, a.ga4_pageviews, a.ga4_users, a.ga4_loyal_users,
      a.ga4_inmarket_pageviews, a.ga4_loyal_inmarket_pv,
      a.ga4_avg_engagement_time, a.ga4_sessions, a.ga4_subscribe_clicks,
      a.ga4_email_signups, a.ga4_ad_revenue, a.mf_unique_users,
      a.mf_pageviews, a.mf_loyal_users, a.mf_scroll_depth,
      a.mf_recirculation_rate, a.mf_newsletter_signups, a.true_value, a.snapshot_at
    FROM content c
    LEFT JOIN (
      SELECT wp_id, MAX(snapshot_at) as latest FROM analytics_snapshots GROUP BY wp_id
    ) latest_snap ON c.wp_id = latest_snap.wp_id
    LEFT JOIN analytics_snapshots a ON a.wp_id = latest_snap.wp_id AND a.snapshot_at = latest_snap.latest
    WHERE c.wp_id = ?
  `).get(wpId);

  if (!item) return res.status(404).json({ error: 'Not found' });

  const history = db.prepare(`
    SELECT * FROM analytics_snapshots WHERE wp_id = ? ORDER BY snapshot_at ASC
  `).all(wpId);

  // Top sources for this article from the latest snapshot
  const sources = db.prepare(`
    SELECT source, pageviews FROM content_sources
    WHERE wp_id = ?
      AND snapshot_at = (SELECT MAX(snapshot_at) FROM content_sources WHERE wp_id = ?)
    ORDER BY pageviews DESC
  `).all(wpId, wpId);

  const breakdown = getValueBreakdown(item, getSettings());

  res.json({ ...item, history, sources, trueValueBreakdown: breakdown });
});

// POST /api/content/:id/reclassify
router.post('/:id/reclassify', async (req, res) => {
  const wpId = parseInt(req.params.id);
  try {
    const result = await classifySingle(wpId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
