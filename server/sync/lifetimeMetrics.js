// Saves the per-article lifetime GA4 totals (see syncGA4Lifetime in ga4.js)
// into lifetime_metrics, which lifetime_value is scored from.
//
// The counts are held at their high-water mark: GA4 can revise a number
// slightly between runs and thresholding can shave a few users off a re-read,
// and none of that should make an article's lifetime value drop. Engagement is
// a rate (an average over the window), so it just takes the latest value — it
// is the one input allowed to move either way.
//
// The high-water mark only applies among counts measured from the same start
// date. Each row records its `since` (DATA_START at the time); when the start
// date changes, the first run replaces the row outright instead of keeping a
// count that was taken over a different window.
import { DATA_START } from '../utils/dataStart.js';

export function saveLifetimeMetrics(db, metricsByWpId, since = DATA_START) {
  // `IS` rather than `=` so rows from before `since` existed (NULL) are replaced.
  const hold = (col) => `${col} = CASE WHEN lifetime_metrics.since IS excluded.since THEN MAX(lifetime_metrics.${col}, excluded.${col}) ELSE excluded.${col} END`;
  const upsert = db.prepare(`
    INSERT INTO lifetime_metrics
      (wp_id, users, pageviews, sessions, loyal_users, inmarket_users, avg_engagement_time, ad_revenue, updated_at, since)
    VALUES
      (@wp_id, @users, @pageviews, @sessions, @loyal_users, @inmarket_users, @avg_engagement_time, @ad_revenue, datetime('now'), @since)
    ON CONFLICT(wp_id) DO UPDATE SET
      ${['users', 'pageviews', 'sessions', 'loyal_users', 'inmarket_users', 'ad_revenue'].map(hold).join(',\n      ')},
      avg_engagement_time = excluded.avg_engagement_time,
      updated_at          = excluded.updated_at,
      since               = excluded.since
  `);
  db.transaction(() => {
    for (const [wpId, m] of metricsByWpId) upsert.run({ wp_id: wpId, ...m, since });
  })();
  return metricsByWpId.size;
}
