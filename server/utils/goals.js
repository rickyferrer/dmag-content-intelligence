// Goal progress/pacing math, shared by routes/goals.js.
//
// A goal picks one metric, one scope, and a date range. Progress is computed
// two different ways depending on the metric, mirroring conventions already
// established elsewhere in this app:
//
// - Metrics that live in site_daily_metrics (pageviews, subscribe_clicks,
//   newsletter_signups, ad_revenue) are genuinely additive by calendar date,
//   so a SITE-scoped goal on one of these sums that table directly — same
//   rationale as analytics.js's computeTrafficSummary(). Scoped goals
//   (section/writer/user_need/content_type) can't use this table (it has no
//   such breakdown), so they fall through to the content-based path below.
// - Everything else (article_count, total_content_value, avg_content_value,
//   and any scoped traffic goal) sums/averages each article's CURRENT
//   analytics_snapshots row for articles published within the goal's date
//   range — the same "filter content by published_at, join latest
//   snapshot" pattern used by /api/analytics/by-section, /by-writer, and
//   /by-need. It's an approximation (a snapshot is a rolling current value,
//   not the metric's true value strictly during the goal window) but it's
//   the same approximation the rest of the app already presents as
//   "performance in a date range," so a goal stays consistent with every
//   other view instead of inventing a stricter, inconsistent definition.
//
// Pacing itself is a simple linear model: expected-so-far = target ×
// (days elapsed ÷ days total). It's a deliberate simplification — not every
// metric truly accrues evenly — but it's transparent, easy to reason about,
// and the same baseline any editor would sanity-check by hand.
//
// `users`/`loyal_users` are a third path, not covered by either case above:
// they're DISTINCT-count metrics, so summing per-day rows (like the
// siteDailyCol metrics) over-counts every repeat visitor once per day they
// showed up — the exact mistake analytics.js's computeTrafficSummary and
// sync/ga4.js's fetchLoyalUsersForRange go out of their way to avoid (see
// their comments — a naive sum of daily loyal_users once read 2.4x the true
// period-unique count). So a SITE-scoped users/loyal_users goal queries GA4
// live with a single consolidated date range (liveRangeFetch below) instead
// of summing a table. A SCOPED goal (section/writer/etc.) has no such live
// per-scope breakdown available, so it falls back to the same per-article
// analytics_snapshots SUM approximation every other scoped goal uses.

import { fetchUsersForRange, fetchLoyalUsersForRange } from '../sync/ga4.js';

export const METRICS = {
  pageviews:            { label: 'Pageviews',            unit: 'count',    cumulative: true,  siteDailyCol: 'pageviews' },
  subscribe_clicks:     { label: 'Subscribe Clicks',     unit: 'count',    cumulative: true,  siteDailyCol: 'subscribe_clicks' },
  newsletter_signups:   { label: 'Newsletter Signups',   unit: 'count',    cumulative: true,  siteDailyCol: 'newsletter_signups' },
  ad_revenue:           { label: 'Ad Revenue (notional)',unit: 'currency', cumulative: true,  siteDailyCol: 'ad_revenue' },
  article_count:        { label: 'Articles Published',   unit: 'count',    cumulative: true,  siteDailyCol: null },
  total_content_value:  { label: 'Total Content Value',  unit: 'count',    cumulative: true,  siteDailyCol: null },
  avg_content_value:    { label: 'Avg Content Value',    unit: 'count',    cumulative: false, siteDailyCol: null },
  users:                { label: 'Total Users',          unit: 'count',    cumulative: true,  siteDailyCol: null, liveRange: true },
  loyal_users:          { label: 'Loyal Users',           unit: 'count',    cumulative: true,  siteDailyCol: null, liveRange: true },
};

export const SCOPES = {
  site:         { label: 'Site-wide', column: null },
  section:      { label: 'Section',      column: 'c.section' },
  writer:       { label: 'Writer',       column: 'c.writer' },
  user_need:    { label: 'User Need',    column: 'c.user_need' },
  content_type: { label: 'Content Type', column: 'c.content_type' },
};

function isoDate(d) { return d.toISOString().slice(0, 10); }
function daysBetween(a, b) {
  return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
}
function today() { return isoDate(new Date()); }

// Content-based aggregate expression per metric — what to SELECT once the
// content/analytics_snapshots join and WHERE clause are in place.
function contentAggExpr(metric) {
  switch (metric) {
    case 'article_count':       return 'COUNT(c.wp_id)';
    case 'total_content_value': return 'SUM(a.true_value)';
    case 'avg_content_value':   return 'AVG(CASE WHEN a.true_value > 0 THEN a.true_value END)';
    case 'pageviews':           return 'SUM(a.ga4_pageviews)';
    case 'subscribe_clicks':    return 'SUM(a.ga4_subscribe_clicks)';
    case 'newsletter_signups':  return 'SUM(a.mf_newsletter_signups)';
    case 'ad_revenue':          return 'SUM(a.ga4_ad_revenue)';
    case 'users':                return 'SUM(a.ga4_users)';
    case 'loyal_users':          return 'SUM(a.ga4_loyal_users)';
    default: throw new Error(`Unknown metric: ${metric}`);
  }
}

// Live GA4 range query for a site-scoped users/loyal_users goal — a true
// period-unique count, not a sum of daily snapshots. loyal_users is capped
// against total_users in the same range for the same reason sync/ga4.js's
// callers already do: GA4's loyal-audience segment can occasionally report
// more than the plain active-user count for a narrow/noisy range.
async function fetchLiveRangeValue(metric, startDate, endDate) {
  if (metric === 'users') return fetchUsersForRange(startDate, endDate);
  const [users, loyal] = await Promise.all([
    fetchUsersForRange(startDate, endDate),
    fetchLoyalUsersForRange(startDate, endDate),
  ]);
  return Math.min(loyal, users);
}

function fetchContentValue(db, goal, endDate) {
  const where = ['c.published_at >= ?', 'c.published_at <= ?'];
  const params = [goal.start_date, endDate + 'T23:59:59'];
  const scope = SCOPES[goal.scope_type];
  if (scope.column) {
    where.push(`${scope.column} = ?`);
    params.push(goal.scope_value);
  }
  const row = db.prepare(`
    SELECT ${contentAggExpr(goal.metric)} AS v
    FROM content c
    LEFT JOIN (
      SELECT wp_id, MAX(snapshot_at) AS latest FROM analytics_snapshots GROUP BY wp_id
    ) lx ON c.wp_id = lx.wp_id
    LEFT JOIN analytics_snapshots a ON a.wp_id = lx.wp_id AND a.snapshot_at = lx.latest
    WHERE ${where.join(' AND ')}
  `).get(...params);
  return row.v || 0;
}

async function fetchCurrentValue(db, goal, endDate) {
  const metric = METRICS[goal.metric];
  if (goal.scope_type === 'site' && metric.liveRange) {
    return fetchLiveRangeValue(goal.metric, goal.start_date, endDate);
  }
  if (goal.scope_type === 'site' && metric.siteDailyCol) {
    const row = db.prepare(`
      SELECT SUM(${metric.siteDailyCol}) AS v FROM site_daily_metrics WHERE date >= ? AND date <= ?
    `).get(goal.start_date, endDate);
    return row.v || 0;
  }
  return fetchContentValue(db, goal, endDate);
}

// { current, target, pct_of_target, expected, status, days_elapsed,
//   days_total, days_remaining, projected_final }
export async function computeGoalProgress(db, goal) {
  const now = today();
  const metric = METRICS[goal.metric];
  const daysTotal = Math.max(1, daysBetween(goal.start_date, goal.end_date) + 1);
  const effectiveEnd = goal.end_date < now ? goal.end_date : now;
  const rawElapsed = goal.start_date > effectiveEnd ? 0 : daysBetween(goal.start_date, effectiveEnd) + 1;
  const daysElapsed = Math.min(Math.max(rawElapsed, 0), daysTotal);

  const current = daysElapsed > 0 ? await fetchCurrentValue(db, goal, effectiveEnd) : 0;
  const expectedFraction = daysTotal > 0 ? daysElapsed / daysTotal : 0;
  const expected = metric.cumulative ? goal.target * expectedFraction : goal.target;
  const pctOfTarget = goal.target ? (current / goal.target) * 100 : 0;

  let status;
  if (daysElapsed <= 0) {
    status = 'not_started';
  } else if (now > goal.end_date) {
    status = current >= goal.target ? 'met' : 'missed';
  } else if (!metric.cumulative) {
    status = current >= goal.target ? 'on_track' : 'behind';
  } else {
    const ratio = expected > 0 ? current / expected : (current > 0 ? 2 : 1);
    status = ratio >= 1.02 ? 'ahead' : ratio <= 0.98 ? 'behind' : 'on_track';
  }

  const projectedFinal = metric.cumulative && daysElapsed > 0
    ? current * (daysTotal / daysElapsed)
    : current;

  return {
    current,
    target: goal.target,
    pct_of_target: pctOfTarget,
    expected,
    status,
    days_elapsed: daysElapsed,
    days_total: daysTotal,
    days_remaining: Math.max(daysTotal - daysElapsed, 0),
    projected_final: projectedFinal,
  };
}

// Day-by-day { date, actual (cumulative), expected (cumulative) } series for
// the detail-panel chart. Only meaningful for cumulative metrics — a rate
// (avg_content_value) doesn't accumulate, so callers should skip charting it.
export async function computeGoalTrend(db, goal) {
  const metric = METRICS[goal.metric];
  if (!metric.cumulative) return [];

  const now = today();
  const effectiveEnd = goal.end_date < now ? goal.end_date : now;
  if (goal.start_date > effectiveEnd) return [];

  const daysTotal = Math.max(1, daysBetween(goal.start_date, goal.end_date) + 1);

  // A live-range metric (site-scoped users/loyal_users) can't be summed from
  // daily increments — each point needs its own GA4 range query from
  // start_date to that point. One call per day in the range would be slow
  // and needlessly hammer the API, so this walks a handful of evenly-spaced
  // checkpoints (at most 10) instead of every single day.
  if (goal.scope_type === 'site' && metric.liveRange) {
    const totalElapsedDays = daysBetween(goal.start_date, effectiveEnd) + 1;
    const numPoints = Math.min(totalElapsedDays, 10);
    const series = [];
    for (let i = 1; i <= numPoints; i++) {
      const dayIndex = Math.round((i / numPoints) * totalElapsedDays);
      const checkpoint = new Date(goal.start_date + 'T00:00:00Z');
      checkpoint.setUTCDate(checkpoint.getUTCDate() + dayIndex - 1);
      const cpDate = isoDate(checkpoint);
      const actual = await fetchLiveRangeValue(goal.metric, goal.start_date, cpDate);
      series.push({ date: cpDate, actual, expected: goal.target * (dayIndex / daysTotal) });
    }
    return series;
  }

  // Build a date -> daily increment map, then walk the range accumulating it.
  const increments = {};
  if (goal.scope_type === 'site' && metric.siteDailyCol) {
    const rows = db.prepare(`
      SELECT date, ${metric.siteDailyCol} AS v FROM site_daily_metrics
      WHERE date >= ? AND date <= ? ORDER BY date
    `).all(goal.start_date, effectiveEnd);
    for (const r of rows) increments[r.date] = r.v || 0;
  } else {
    // Per-article value column for each metric (as opposed to
    // contentAggExpr's already-aggregated SUM/AVG/COUNT) — summed per day
    // in JS below to build the cumulative series.
    const PER_ARTICLE_COL = {
      article_count:       '1',
      total_content_value: 'a.true_value',
      pageviews:            'a.ga4_pageviews',
      subscribe_clicks:     'a.ga4_subscribe_clicks',
      newsletter_signups:   'a.mf_newsletter_signups',
      ad_revenue:           'a.ga4_ad_revenue',
      users:                'a.ga4_users',
      loyal_users:          'a.ga4_loyal_users',
    };
    const where = ['c.published_at >= ?', 'c.published_at <= ?'];
    const params = [goal.start_date, effectiveEnd + 'T23:59:59'];
    const scope = SCOPES[goal.scope_type];
    if (scope.column) { where.push(`${scope.column} = ?`); params.push(goal.scope_value); }
    const rows = db.prepare(`
      SELECT DATE(c.published_at) AS d, ${PER_ARTICLE_COL[goal.metric]} AS v
      FROM content c
      LEFT JOIN (
        SELECT wp_id, MAX(snapshot_at) AS latest FROM analytics_snapshots GROUP BY wp_id
      ) lx ON c.wp_id = lx.wp_id
      LEFT JOIN analytics_snapshots a ON a.wp_id = lx.wp_id AND a.snapshot_at = lx.latest
      WHERE ${where.join(' AND ')}
    `).all(...params);
    for (const r of rows) increments[r.d] = (increments[r.d] || 0) + (r.v || 0);
  }

  const series = [];
  let cumulative = 0;
  let cursor = new Date(goal.start_date + 'T00:00:00Z');
  const end = new Date(effectiveEnd + 'T00:00:00Z');
  let dayIndex = 0;
  while (cursor <= end) {
    const d = isoDate(cursor);
    cumulative += increments[d] || 0;
    dayIndex++;
    series.push({
      date: d,
      actual: cumulative,
      expected: goal.target * (dayIndex / daysTotal),
    });
    cursor = new Date(cursor.getTime() + 86400000);
  }
  return series;
}
