/**
 * Company Brain editorial brief: a fixed, parameterized, read-only report.
 * This is NOT an unrestricted SQL tool and must only be called behind
 * the existing /api/insights requireAuth + per-user conversation checks.
 */
const VALID_PUBS = new Set(['d-magazine', 'd-ceo', 'd-home', 'd-weddings']);
const VALID_NEEDS = new Set([
  'update_me', 'educate_me', 'give_perspective', 'divert_me',
  'inspire_me', 'help_me', 'connect_me', 'keep_me_engaged',
]);
const SORTS = {
  content_value: 'a.true_value',
  pageviews: 'a.ga4_pageviews',
  subscribe_clicks: 'a.ga4_subscribe_clicks',
  newsletter_signups: 'a.mf_newsletter_signups',
  engagement: 'a.ga4_avg_engagement_time',
};
const isDate = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
  && !Number.isNaN(Date.parse(v)) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v;
const plain = v => typeof v === 'string' ? v.trim() : '';

export function editorialBrief(db, args = {}, now = new Date()) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Expected a brief filter object.');
  const today = now.toISOString().slice(0, 10);
  const defaultFrom = new Date(now.getTime() - 89 * 86400000).toISOString().slice(0, 10);
  const dateFrom = args.dateFrom ?? defaultFrom;
  const dateTo = args.dateTo ?? today;
  if (!isDate(dateFrom) || !isDate(dateTo) || dateFrom > dateTo) {
    throw new Error('Use valid dateFrom/dateTo in YYYY-MM-DD order.');
  }
  if (Date.parse(dateTo) - Date.parse(dateFrom) > 366 * 86400000) {
    throw new Error('Publication-date window cannot exceed 366 days.');
  }
  const section = plain(args.section);
  const writer = plain(args.writer);
  const publication = plain(args.publication);
  const userNeed = plain(args.userNeed);
  const sortBy = args.sortBy ?? 'content_value';
  if (section.length > 120 || writer.length > 120) throw new Error('Filter is too long.');
  if (publication && !VALID_PUBS.has(publication)) throw new Error('Unknown publication.');
  if (userNeed && !VALID_NEEDS.has(userNeed)) throw new Error('Unknown user need.');
  if (!Object.hasOwn(SORTS, sortBy)) throw new Error('Unknown sort metric.');

  const where = ['c.published_at >= ?', 'c.published_at < ?'];
  // Exclusive next-day boundary supports ISO timestamps and inclusive dateTo.
  const nextDay = new Date(Date.parse(dateTo + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
  const params = [dateFrom, nextDay];
  if (section) { where.push('c.section = ?'); params.push(section); }
  if (writer) { where.push('c.writer = ?'); params.push(writer); }
  if (userNeed) { where.push('c.user_need = ?'); params.push(userNeed); }
  if (publication) {
    // An editor-assigned issue takes precedence over the URL-derived publication.
    where.push("(CASE WHEN c.publication_override IS NOT NULL AND c.publication_override != '' THEN c.publication_override LIKE ? ELSE c.url LIKE ? END)");
    params.push(publication + '/%', '%/publications/' + publication + '/%');
  }

  const joins = `FROM content c
    LEFT JOIN (
      SELECT s.* FROM analytics_snapshots s
      JOIN (SELECT wp_id, MAX(snapshot_at) AS latest FROM analytics_snapshots GROUP BY wp_id) lx
        ON s.wp_id = lx.wp_id AND s.snapshot_at = lx.latest
      WHERE s.id = (SELECT MAX(s2.id) FROM analytics_snapshots s2
                    WHERE s2.wp_id = s.wp_id AND s2.snapshot_at = s.snapshot_at)
    ) a ON c.wp_id = a.wp_id
    WHERE ${where.join(' AND ')}`;

  const summary = db.prepare(`SELECT COUNT(*) AS article_count,
    SUM(CASE WHEN a.wp_id IS NOT NULL THEN 1 ELSE 0 END) AS articles_with_snapshots,
    MAX(a.snapshot_at) AS newest_snapshot,
    ROUND(AVG(CASE WHEN a.true_value > 0 THEN a.true_value END), 2) AS avg_nonzero_rolling_value,
    SUM(CASE WHEN a.true_value > 0 THEN 1 ELSE 0 END) AS scored_articles
    ${joins}`).get(...params);

  const rows = db.prepare(`SELECT c.wp_id, c.title, c.url, c.writer, c.section,
    c.published_at, c.user_need, a.snapshot_at,
    a.true_value AS rolling_content_value,
    a.lifetime_value AS lifetime_content_value,
    a.ga4_pageviews AS rolling_pageviews,
    a.ga4_users AS rolling_article_users,
    a.ga4_loyal_users AS rolling_loyal_users,
    a.ga4_avg_engagement_time AS rolling_avg_engagement_seconds,
    a.ga4_subscribe_clicks AS rolling_subscribe_clicks,
    a.mf_newsletter_signups AS rolling_newsletter_signups
    ${joins}
    ORDER BY (${SORTS[sortBy]} IS NULL) ASC, ${SORTS[sortBy]} DESC, c.wp_id ASC
    LIMIT 8`).all(...params);

  return {
    kind: 'editorial_performance_brief',
    filters: { dateFrom, dateTo, section: section || null, writer: writer || null,
      publication: publication || null, userNeed: userNeed || null, sortBy },
    articleCount: summary.article_count,
    articlesWithSnapshots: summary.articles_with_snapshots || 0,
    newestSnapshot: summary.newest_snapshot,
    averageNonzeroRollingContentValue: summary.avg_nonzero_rolling_value,
    scoredArticles: summary.scored_articles || 0,
    topArticles: rows,
    metricNotes: [
      'Publication dates select the article cohort; performance is from each article\'s latest rolling approximately 30-day snapshot, NOT traffic accrued during the publication-date window.',
      'Rolling Content Value is a modeled 0–100 score per article, not actual revenue or lifetime value.',
      'Subscribe clicks and newsletter signups in this brief are rolling snapshot fields, not whole-life totals; use the dashboard Content view for lifetime/backfilled attribution.',
      'Article-level unique users are not deduplicated across articles or days; never sum them into site-wide unique users.',
      'No causal inference about subscriptions, traffic or editorial outcomes is established by this report.',
      'The most recent snapshot timestamp is supplied; data may be stale. Confirm freshness before external use.',
    ],
  };
}

export const EDITORIAL_BRIEF_TOOL = {
  name: 'editorial_brief',
  description: 'A fixed, read-only editorial performance report for articles PUBLISHED in a chosen date window (defaults to past 90 days). Filters by section, writer, publication or user need and ranks the top 8 articles by rolling metrics. Values in the returned brief are latest approximately 30-day snapshot metrics, NOT traffic earned during the publication date window; cite that distinction. Use for editorial performance briefs and top-performing story questions.',
  input_schema: { type: 'object', properties: {
    dateFrom: { type: 'string', description: 'Publication date YYYY-MM-DD, inclusive.' },
    dateTo: { type: 'string', description: 'Publication date YYYY-MM-DD, inclusive.' },
    section: { type: 'string', description: 'Exact section name, for example Food & Drink.' },
    writer: { type: 'string', description: 'Exact writer name.' },
    publication: { type: 'string', enum: [...VALID_PUBS] },
    userNeed: { type: 'string', enum: [...VALID_NEEDS] },
    sortBy: { type: 'string', enum: Object.keys(SORTS), description: 'Ranking by the latest rolling snapshot.' },
  } },
};
