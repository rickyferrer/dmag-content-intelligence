// Saves the per-article lifetime GA4 totals (see syncGA4Lifetime in ga4.js)
// into lifetime_metrics, which lifetime_value is scored from.
//
// The counts are held at their high-water mark: GA4 can revise a number
// slightly between runs, thresholding can shave a few users off a re-read, and
// pages that predate the window lose their oldest traffic as it ages past
// GA4's retention. None of that should make an article's lifetime value drop.
// Engagement is a rate (an average over the window), so it just takes the
// latest value — it is the one input allowed to move either way.

export function saveLifetimeMetrics(db, metricsByWpId) {
  const upsert = db.prepare(`
    INSERT INTO lifetime_metrics
      (wp_id, users, pageviews, sessions, loyal_users, inmarket_users, avg_engagement_time, ad_revenue, updated_at)
    VALUES
      (@wp_id, @users, @pageviews, @sessions, @loyal_users, @inmarket_users, @avg_engagement_time, @ad_revenue, datetime('now'))
    ON CONFLICT(wp_id) DO UPDATE SET
      users               = MAX(users, excluded.users),
      pageviews           = MAX(pageviews, excluded.pageviews),
      sessions            = MAX(sessions, excluded.sessions),
      loyal_users         = MAX(loyal_users, excluded.loyal_users),
      inmarket_users      = MAX(inmarket_users, excluded.inmarket_users),
      ad_revenue          = MAX(ad_revenue, excluded.ad_revenue),
      avg_engagement_time = excluded.avg_engagement_time,
      updated_at          = excluded.updated_at
  `);
  db.transaction(() => {
    for (const [wpId, m] of metricsByWpId) upsert.run({ wp_id: wpId, ...m });
  })();
  return metricsByWpId.size;
}
