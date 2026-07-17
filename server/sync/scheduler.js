import cron from 'node-cron';
import { syncWordPress } from './wordpress.js';
import { syncGA4 } from './ga4.js';
import { syncMarfeel } from './marfeel.js';
import { classifyUnclassified } from '../classify/userNeeds.js';
import { getDb, setSyncState, getSettings } from '../db.js';
import { getScoreParams, valueToScore } from '../utils/trueValue.js';
import { syncGA4Sources } from './ga4.js';
import { syncGSC } from './gsc.js';

let syncRunning = false;
let analyticsRunning = false;
let classifyRunning = false;

// Score all content on a 0-100 scale using the shared strategic-efficiency model
// (see utils/trueValue.js): per-reader conversion/quality rates vs. benchmarks,
// weighted by strategic priority, shrunk by a traffic-confidence factor.
//
// Excluded items (homepage, section fronts) are set to 0 so they never appear as
// top content.
export function scoreContent(db) {
  const p = getScoreParams(getSettings());

  const rows = db.prepare(`
    SELECT
      a.id,
      c.excluded_from_scoring AS excluded,
      a.ga4_users, a.ga4_pageviews, a.ga4_subscribe_clicks, a.mf_newsletter_signups,
      a.ga4_loyal_inmarket_pv, a.ga4_avg_engagement_time, a.ga4_ad_revenue
    FROM analytics_snapshots a
    JOIN (
      SELECT wp_id, MAX(snapshot_at) AS latest
      FROM analytics_snapshots GROUP BY wp_id
    ) lx ON a.wp_id = lx.wp_id AND a.snapshot_at = lx.latest
    JOIN content c ON c.wp_id = a.wp_id
  `).all();

  if (rows.length === 0) return;

  const update = db.prepare('UPDATE analytics_snapshots SET true_value = ? WHERE id = ?');
  let scored = 0;
  db.transaction(() => {
    for (const row of rows) {
      if (row.excluded) { update.run(0, row.id); continue; }
      update.run(valueToScore(row, p), row.id);
      scored++;
    }
  })();

  console.log(`[Scheduler] Scored ${scored} items 0-100 (strategic efficiency model)`);
}

export async function runContentSync() {
  if (syncRunning) {
    console.log('[Scheduler] Content sync already running — skipping');
    return;
  }
  syncRunning = true;
  try {
    const result = await syncWordPress();
    setSyncState('last_wp_sync_status', JSON.stringify({ ...result, at: new Date().toISOString() }));
  } catch (err) {
    console.error('[Scheduler] Content sync error:', err.message);
    setSyncState('last_wp_sync_status', JSON.stringify({ error: err.message, at: new Date().toISOString() }));
  } finally {
    syncRunning = false;
  }
}

// Keep only the most recent `keepCount` snapshots per content item.
// Runs as a SQLite window-function DELETE — efficient with the wp_id index.
export function pruneSnapshots(db, keepCount = 30) {
  const result = db.prepare(`
    DELETE FROM analytics_snapshots
    WHERE id NOT IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY wp_id ORDER BY snapshot_at DESC) AS rn
        FROM analytics_snapshots
      )
      WHERE rn <= ?
    )
  `).run(keepCount);
  if (result.changes > 0) {
    console.log(`[Scheduler] Pruned ${result.changes} old snapshots (kept last ${keepCount} per item)`);
  }
}

export async function runAnalyticsSync() {
  if (analyticsRunning) {
    console.log('[Scheduler] Analytics sync already running — skipping');
    return;
  }
  analyticsRunning = true;
  const db = getDb();

  try {
    const snapshotAt = new Date().toISOString();

    // Fetch GA4 and Marfeel in sequence (Marfeel rate limits require sequential execution anyway)
    let ga4Metrics = new Map();
    let marfeelMetrics = new Map();
    let marfeelSources = new Map(); // url → [{source, pageviews}]

    try {
      ga4Metrics = await syncGA4();
      setSyncState('last_ga4_sync', snapshotAt);
    } catch (err) {
      console.error('[Scheduler] GA4 sync error:', err.message);
      setSyncState('last_ga4_sync_error', err.message);
    }

    try {
      const mfResult = await syncMarfeel();
      marfeelMetrics = mfResult.metrics || mfResult; // backward-compat if shape changes
      marfeelSources = mfResult.sourcesByUrl || new Map();
      setSyncState('last_marfeel_sync', snapshotAt);
    } catch (err) {
      console.error('[Scheduler] Marfeel sync error:', err.message);
    }

    // Guard: if BOTH sources returned nothing (auth failure, network outage),
    // do NOT write a batch of zero snapshots — that would overwrite the last
    // good data and make the whole dashboard read zero. Skip this run instead.
    if (ga4Metrics.size === 0 && marfeelMetrics.size === 0) {
      console.warn('[Scheduler] GA4 and Marfeel both returned no data — skipping snapshot write to preserve existing data.');
      setSyncState('last_analytics_sync_skipped', snapshotAt);
      return;
    }

    // Get all content with URLs for matching
    const content = db.prepare('SELECT wp_id, url FROM content').all();

    // ── Diagnostic: log sample URL formats to diagnose Marfeel matching ──────
    if (marfeelMetrics.size > 0) {
      const mfKeys = [...marfeelMetrics.keys()].slice(0, 5);
      const contentUrls = content.slice(0, 5).map(r => r.url);
      console.log('[Scheduler] Sample Marfeel URLs:', mfKeys);
      console.log('[Scheduler] Sample content URLs:', contentUrls);

      // Check how many content URLs have a direct match
      let matchCount = 0;
      let trailingSlashCount = 0;
      let wwwCount = 0;
      for (const row of content) {
        if (!row.url) continue;
        if (marfeelMetrics.has(row.url)) { matchCount++; continue; }
        const withSlash = row.url.endsWith('/') ? row.url : row.url + '/';
        const withoutSlash = row.url.endsWith('/') ? row.url.slice(0, -1) : row.url;
        if (marfeelMetrics.has(withSlash) || marfeelMetrics.has(withoutSlash)) { trailingSlashCount++; continue; }
        const noWww = row.url.replace('://www.', '://');
        const withWww = row.url.replace('://', '://www.');
        if (marfeelMetrics.has(noWww) || marfeelMetrics.has(withWww)) { wwwCount++; }
      }
      console.log(`[Scheduler] Marfeel URL match diagnostic: exact=${matchCount}, trailing-slash-fix=${trailingSlashCount}, www-fix=${wwwCount} (of ${content.length} content items)`);
    }
    // ─────────────────────────────────────────────────────────────────────────

    const insertSnapshot = db.prepare(`
      INSERT INTO analytics_snapshots (
        wp_id, snapshot_at,
        ga4_pageviews, ga4_users, ga4_loyal_users, ga4_inmarket_pageviews,
        ga4_loyal_inmarket_pv, ga4_avg_engagement_time, ga4_sessions,
        ga4_subscribe_clicks, ga4_email_signups, ga4_ad_revenue,
        mf_unique_users, mf_pageviews, mf_loyal_users,
        mf_scroll_depth, mf_recirculation_rate, mf_newsletter_signups, true_value
      ) VALUES (
        @wp_id, @snapshot_at,
        @ga4_pageviews, @ga4_users, @ga4_loyal_users, @ga4_inmarket_pageviews,
        @ga4_loyal_inmarket_pv, @ga4_avg_engagement_time, @ga4_sessions,
        @ga4_subscribe_clicks, @ga4_email_signups, @ga4_ad_revenue,
        @mf_unique_users, @mf_pageviews, @mf_loyal_users,
        @mf_scroll_depth, @mf_recirculation_rate, @mf_newsletter_signups, @true_value
      )
    `);

    let inserted = 0;

    db.transaction(() => {
      for (const row of content) {
        const ga4 = ga4Metrics.get(row.wp_id) || {};

        // Match Marfeel by URL — try several normalisation variants
        let mf = {};
        if (row.url) {
          const url = row.url;
          const urlNoSlash = url.endsWith('/') ? url.slice(0, -1) : url;
          const urlWithSlash = url.endsWith('/') ? url : url + '/';
          const urlNoWww = url.replace('://www.', '://');
          const urlNoWwwNoSlash = urlNoWww.endsWith('/') ? urlNoWww.slice(0, -1) : urlNoWww;
          const urlNoWwwWithSlash = urlNoWww.endsWith('/') ? urlNoWww : urlNoWww + '/';

          mf = marfeelMetrics.get(url)
            || marfeelMetrics.get(urlNoSlash)
            || marfeelMetrics.get(urlWithSlash)
            || marfeelMetrics.get(urlNoWww)
            || marfeelMetrics.get(urlNoWwwNoSlash)
            || marfeelMetrics.get(urlNoWwwWithSlash)
            || {};

          // Try pathname match as last resort
          if (!Object.keys(mf).length) {
            try {
              const pathname = new URL(url).pathname;
              mf = marfeelMetrics.get(pathname)
                || marfeelMetrics.get(pathname.replace(/\/$/, ''))
                || marfeelMetrics.get(pathname.endsWith('/') ? pathname : pathname + '/')
                || {};
            } catch { /* ignore */ }
          }
        }

        const snapshot = {
          wp_id: row.wp_id,
          snapshot_at: snapshotAt,
          ga4_pageviews: ga4.ga4_pageviews || 0,
          ga4_users: ga4.ga4_users || 0,
          ga4_loyal_users: ga4.ga4_loyal_users || 0,
          ga4_inmarket_pageviews: ga4.ga4_inmarket_pageviews || 0,
          ga4_loyal_inmarket_pv: ga4.ga4_loyal_inmarket_pv || 0,
          ga4_avg_engagement_time: ga4.ga4_avg_engagement_time || 0,
          ga4_sessions: ga4.ga4_sessions || 0,
          ga4_subscribe_clicks: ga4.ga4_subscribe_clicks || 0,
          ga4_email_signups: ga4.ga4_email_signups || 0,
          ga4_ad_revenue: ga4.ga4_ad_revenue || 0,
          mf_unique_users: mf.mf_unique_users || 0,
          mf_pageviews: mf.mf_pageviews || 0,
          mf_loyal_users: mf.mf_loyal_users || 0,
          mf_scroll_depth: mf.mf_scroll_depth || 0,
          mf_recirculation_rate: mf.mf_recirculation_rate || 0,
          mf_newsletter_signups: mf.mf_newsletter_signups || 0,
          true_value: 0,
        };

        insertSnapshot.run(snapshot);
        inserted++;
      }
    })();

    console.log(`[Scheduler] Analytics snapshot complete: ${inserted} rows`);

    // ── Write acquisition source data ─────────────────────────────────────────
    if (marfeelSources.size > 0) {
      const insertSource = db.prepare(`
        INSERT INTO content_sources (wp_id, snapshot_at, source, pageviews)
        VALUES (?, ?, ?, ?)
      `);
      // Build a URL → wp_id lookup from the content we already have
      const urlToWpId = new Map();
      for (const row of content) {
        if (!row.url) continue;
        const norm = (() => { try { const u = new URL(row.url); return u.origin + u.pathname; } catch { return row.url; } })();
        urlToWpId.set(norm, row.wp_id);
        urlToWpId.set(norm.endsWith('/') ? norm.slice(0,-1) : norm+'/', row.wp_id);
      }
      let sourcesInserted = 0;
      db.transaction(() => {
        for (const [url, sources] of marfeelSources) {
          const wpId = urlToWpId.get(url);
          if (!wpId) continue;
          for (const { source, pageviews } of sources) {
            insertSource.run(wpId, snapshotAt, source, pageviews);
            sourcesInserted++;
          }
        }
      })();
      // Prune: keep only the 30 most recent snapshot_at values in content_sources
      db.prepare(`
        DELETE FROM content_sources
        WHERE snapshot_at NOT IN (
          SELECT DISTINCT snapshot_at FROM content_sources
          ORDER BY snapshot_at DESC LIMIT 30
        )
      `).run();
      console.log(`[Scheduler] Source data: ${sourcesInserted} rows written`);
    }

    // ── GA4 source performance (channel-level conversion rates) ──────────────
    try {
      const channelRows = await syncGA4Sources();
      if (channelRows.length > 0) {
        const ins = db.prepare(`
          INSERT INTO source_performance
            (snapshot_at, channel, users, sessions, subscribe_clicks, avg_engagement_time, ad_revenue)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        db.transaction(() => {
          for (const r of channelRows) {
            ins.run(snapshotAt, r.channel, r.users, r.sessions,
                    r.subscribe_clicks, r.avg_engagement_time, r.ad_revenue);
          }
        })();
        // Keep only the 30 most recent snapshots
        db.prepare(`
          DELETE FROM source_performance
          WHERE snapshot_at NOT IN (
            SELECT DISTINCT snapshot_at FROM source_performance
            ORDER BY snapshot_at DESC LIMIT 30
          )
        `).run();
        console.log(`[Scheduler] Source performance: ${channelRows.length} channels saved`);
      }
    } catch (err) {
      console.error('[Scheduler] Source performance error:', err.message);
    }

    // ── Search Console — real per-page, per-query search performance ─────────
    // Powers the AI vulnerability model's query classification (real queries,
    // not just a title-text heuristic). Non-fatal if not yet granted access.
    try {
      const gscByUrl = await syncGSC();
      if (gscByUrl.size > 0) {
        const urlToWpId = new Map();
        for (const row of content) {
          if (!row.url) continue;
          const norm = (() => { try { const u = new URL(row.url); return u.origin + u.pathname; } catch { return row.url; } })();
          urlToWpId.set(norm, row.wp_id);
          urlToWpId.set(norm.endsWith('/') ? norm.slice(0, -1) : norm + '/', row.wp_id);
        }

        const insertGsc = db.prepare(`
          INSERT INTO gsc_queries (wp_id, snapshot_at, query, clicks, impressions, ctr, position)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        let gscInserted = 0, gscMatched = 0;
        db.transaction(() => {
          for (const [url, queries] of gscByUrl) {
            const wpId = urlToWpId.get(url);
            if (!wpId) continue;
            gscMatched++;
            for (const q of queries) {
              insertGsc.run(wpId, snapshotAt, q.query, q.clicks, q.impressions, q.ctr, q.position);
              gscInserted++;
            }
          }
        })();
        // Keep only the 5 most recent snapshots (each covers a 90-day window, so
        // this is plenty of history without letting the table grow unbounded).
        db.prepare(`
          DELETE FROM gsc_queries
          WHERE snapshot_at NOT IN (
            SELECT DISTINCT snapshot_at FROM gsc_queries
            ORDER BY snapshot_at DESC LIMIT 5
          )
        `).run();
        console.log(`[Scheduler] GSC: ${gscInserted} query rows written for ${gscMatched} articles`);
      }
      setSyncState('last_gsc_sync', snapshotAt);
    } catch (err) {
      console.error('[Scheduler] GSC sync error:', err.message);
      setSyncState('last_gsc_sync_error', err.message);
    }

    // ── Score all content on 1-100 scale ──────────────────────────────────────
    scoreContent(db);

    // ── Retention: keep last 30 snapshots per content item ────────────────────
    pruneSnapshots(db, 30);

    setSyncState('last_analytics_sync', snapshotAt);

  } catch (err) {
    console.error('[Scheduler] Analytics sync error:', err.message);
  } finally {
    analyticsRunning = false;
  }
}

export async function runClassification() {
  if (classifyRunning) {
    console.log('[Scheduler] Classification already running — skipping');
    return;
  }
  classifyRunning = true;
  try {
    await classifyUnclassified();
  } catch (err) {
    console.error('[Scheduler] Classification error:', err.message);
  } finally {
    classifyRunning = false;
  }
}

export function initScheduler() {
  // Content sync once a day at 2:05am — articles don't change minute-to-minute
  cron.schedule('5 2 * * *', () => {
    console.log('[Scheduler] Triggering daily content sync');
    runContentSync();
  });

  // Analytics sync every hour at :20
  cron.schedule('20 * * * *', () => {
    console.log('[Scheduler] Triggering analytics sync');
    runAnalyticsSync();
  });

  // Classification every hour at :40
  cron.schedule('40 * * * *', () => {
    console.log('[Scheduler] Triggering classification');
    runClassification();
  });

  console.log('[Scheduler] Cron jobs initialized');
}

export function getSyncStatus() {
  const db = getDb();
  const state = db.prepare('SELECT key, value, updated_at FROM sync_state').all();
  return Object.fromEntries(state.map(r => [r.key, { value: r.value, updated_at: r.updated_at }]));
}
