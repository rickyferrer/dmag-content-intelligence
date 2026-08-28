import cron from 'node-cron';
import { syncWordPress } from './wordpress.js';
import { syncGA4 } from './ga4.js';
import { syncMarfeel } from './marfeel.js';
import { classifyUnclassified } from '../classify/userNeeds.js';
import { classifyVoicesUnclassified } from '../classify/voice.js';
import { classifyCategoriesUnclassified } from './nlp.js';
import { getDb, setSyncState, getSettings } from '../db.js';
import { getScoreParams, valueToScore, shapeForLifetime } from '../utils/trueValue.js';
import { runBenchmarkCheck } from '../utils/benchmarkCheck.js';
import { syncGA4Sources, syncGA4DailyTotals } from './ga4.js';
import { syncGSC, syncGSCTrend } from './gsc.js';

let syncRunning = false;
let analyticsRunning = false;
let classifyRunning = false;
let categoryClassifyRunning = false;
let voiceClassifyRunning = false;

// Score all content on a 0-100 scale using the shared strategic-efficiency model
// (see utils/trueValue.js): per-reader conversion/quality rates vs. benchmarks,
// weighted by strategic priority, shrunk by a traffic-confidence factor.
//
// Computes TWO scores per article:
//   - true_value: rolling ~30-day performance only. Feeds every grouped
//     rollup (Sections, Writers, User Needs, Publications, Overview,
//     Insights, AI Vulnerability) — kept intentionally "current period" per
//     the VP of Audience Development's call to keep those views rolling.
//   - lifetime_value: same model, but Subscribe Clicks/Newsletter factor in
//     the full historical-backfill + rolling total (see shapeForLifetime()).
//     Only ever shown for individual articles (Content tab, article detail).
//
// Excluded items (homepage, section fronts) are set to 0 on both so they
// never appear as top content.
export function scoreContent(db) {
  const p = getScoreParams(getSettings());

  const rows = db.prepare(`
    SELECT
      a.id,
      c.excluded_from_scoring AS excluded,
      a.ga4_users, a.ga4_pageviews, a.ga4_subscribe_clicks, a.mf_newsletter_signups,
      a.ga4_loyal_users, a.ga4_inmarket_pageviews, a.ga4_avg_engagement_time, a.ga4_ad_revenue,
      (COALESCE(hs.hist_subscribe_clicks, 0) + COALESCE(a.ga4_subscribe_clicks, 0)) AS subscribe_clicks_total,
      (COALESCE(h.hist_newsletter_signups, 0) + COALESCE(a.mf_newsletter_signups, 0)) AS newsletter_signups_total
    FROM analytics_snapshots a
    JOIN (
      SELECT wp_id, MAX(snapshot_at) AS latest
      FROM analytics_snapshots GROUP BY wp_id
    ) lx ON a.wp_id = lx.wp_id AND a.snapshot_at = lx.latest
    JOIN content c ON c.wp_id = a.wp_id
    LEFT JOIN (
      SELECT wp_id, SUM(newsletter_signup + newsletter_signup_inline) AS hist_newsletter_signups
      FROM historical_newsletter_signups
      WHERE week_start < date('now', '-30 days')
      GROUP BY wp_id
    ) h ON h.wp_id = c.wp_id
    LEFT JOIN (
      SELECT wp_id, SUM(subscribe_clicks) AS hist_subscribe_clicks
      FROM historical_subscribe_clicks
      WHERE date < date('now', '-30 days')
      GROUP BY wp_id
    ) hs ON hs.wp_id = c.wp_id
  `).all();

  if (rows.length === 0) return;

  const update = db.prepare('UPDATE analytics_snapshots SET true_value = ?, lifetime_value = ? WHERE id = ?');
  let scored = 0;
  db.transaction(() => {
    for (const row of rows) {
      if (row.excluded) { update.run(0, 0, row.id); continue; }
      const lifetimeSnap = shapeForLifetime(row, {
        subscribeClicksTotal: row.subscribe_clicks_total,
        newsletterSignupsTotal: row.newsletter_signups_total,
      });
      update.run(valueToScore(row, p), valueToScore(lifetimeSnap, p), row.id);
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

// Collapse to at most one snapshot per article per calendar day (the latest
// that day), then drop anything older than `keepDays`. Analytics sync runs
// hourly, so capping by row count alone (the old approach) only retained
// ~30 hours of history — nowhere near enough for a 30-day trend chart. This
// keeps roughly the same row volume but spreads it across real calendar days.
export function pruneSnapshots(db, keepDays = 30) {
  const dedupe = db.prepare(`
    DELETE FROM analytics_snapshots
    WHERE id NOT IN (
      SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (
          PARTITION BY wp_id, DATE(snapshot_at) ORDER BY snapshot_at DESC
        ) AS rn
        FROM analytics_snapshots
      )
      WHERE rn = 1
    )
  `).run();

  const old = db.prepare(`
    DELETE FROM analytics_snapshots WHERE snapshot_at < datetime('now', '-' || ? || ' days')
  `).run(keepDays);

  const total = dedupe.changes + old.changes;
  if (total > 0) {
    console.log(`[Scheduler] Pruned ${total} snapshots (deduped to 1/day, kept last ${keepDays} days)`);
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

    let siteWideNewsletterSignupsToday = null;
    try {
      const mfResult = await syncMarfeel();
      marfeelMetrics = mfResult.metrics || mfResult; // backward-compat if shape changes
      marfeelSources = mfResult.sourcesByUrl || new Map();
      siteWideNewsletterSignupsToday = mfResult.siteWideNewsletterSignupsToday;
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

    // ── GA4 site-wide daily totals — independent of article publish dates ────
    // Powers Overview's traffic cards so a date-range filter reflects actual
    // site traffic for that window, not just articles published in it.
    try {
      const dailyRows = await syncGA4DailyTotals();
      if (dailyRows.length > 0) {
        const upsertDaily = db.prepare(`
          INSERT INTO site_daily_metrics
            (date, users, loyal_users, pageviews, sessions, subscribe_clicks, ad_revenue, avg_engagement_time, updated_at)
          VALUES (@date, @users, @loyal_users, @pageviews, @sessions, @subscribe_clicks, @ad_revenue, @avg_engagement_time, datetime('now'))
          ON CONFLICT(date) DO UPDATE SET
            users = excluded.users,
            loyal_users = excluded.loyal_users,
            pageviews = excluded.pageviews,
            sessions = excluded.sessions,
            subscribe_clicks = excluded.subscribe_clicks,
            ad_revenue = excluded.ad_revenue,
            avg_engagement_time = excluded.avg_engagement_time,
            updated_at = datetime('now')
        `);
        db.transaction(() => {
          for (const r of dailyRows) upsertDaily.run(r);
        })();
        console.log(`[Scheduler] Site daily metrics: ${dailyRows.length} days upserted`);
      }
    } catch (err) {
      console.error('[Scheduler] Site daily metrics error:', err.message);
    }

    // ── Marfeel site-wide newsletter signups — today only ─────────────────────
    // Unlike GA4, Marfeel's API has no absolute date range (confirmed: an
    // `offset` param is silently ignored), so there's no way to backfill past
    // days here — this can only ever capture "today," accumulating one day at
    // a time from here forward. Uses UPDATE-only semantics (via the ON CONFLICT
    // clause below only touching this one column) so it never clobbers the
    // GA4-sourced fields on today's row, regardless of which sync ran first.
    if (siteWideNewsletterSignupsToday != null) {
      const today = new Date().toISOString().slice(0, 10);
      db.prepare(`
        INSERT INTO site_daily_metrics (date, newsletter_signups, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(date) DO UPDATE SET
          newsletter_signups = excluded.newsletter_signups,
          updated_at = datetime('now')
      `).run(today, siteWideNewsletterSignupsToday);
      console.log(`[Scheduler] Site-wide newsletter signups for ${today}: ${siteWideNewsletterSignupsToday}`);
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

    // ── Search Console — per-page daily trend (no query dimension) ───────────
    // Fills the CTR-decline fallback signal for articles that never earn
    // enough per-query clicks to appear in gsc_queries. Independent try/catch
    // so a trend-sync failure doesn't block the per-query sync above.
    try {
      const trendByUrl = await syncGSCTrend();
      if (trendByUrl.size > 0) {
        const urlToWpId = new Map();
        for (const row of content) {
          if (!row.url) continue;
          const norm = (() => { try { const u = new URL(row.url); return u.origin + u.pathname; } catch { return row.url; } })();
          urlToWpId.set(norm, row.wp_id);
          urlToWpId.set(norm.endsWith('/') ? norm.slice(0, -1) : norm + '/', row.wp_id);
        }

        const upsertTrend = db.prepare(`
          INSERT INTO gsc_page_daily (wp_id, date, clicks, impressions, ctr, position)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(wp_id, date) DO UPDATE SET
            clicks = excluded.clicks, impressions = excluded.impressions,
            ctr = excluded.ctr, position = excluded.position
        `);
        let trendUpserted = 0, trendMatched = 0;
        db.transaction(() => {
          for (const [url, days] of trendByUrl) {
            const wpId = urlToWpId.get(url);
            if (!wpId) continue;
            trendMatched++;
            for (const d of days) {
              upsertTrend.run(wpId, d.date, d.clicks, d.impressions, d.ctr, d.position);
              trendUpserted++;
            }
          }
        })();
        // Each sync re-fetches the full 90-day window, so any stored day
        // older than that has aged out of GSC's own lookback — drop it.
        db.prepare(`DELETE FROM gsc_page_daily WHERE date < date('now', '-95 days')`).run();
        console.log(`[Scheduler] GSC trend: ${trendUpserted} day rows written for ${trendMatched} articles`);
      }
      setSyncState('last_gsc_trend_sync', snapshotAt);
    } catch (err) {
      console.error('[Scheduler] GSC trend sync error:', err.message);
      setSyncState('last_gsc_trend_sync_error', err.message);
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

// Only classifies NEW/edited content (a small batch — see sync/nlp.js).
// Backfilling the existing library is a separate, manually-run script since
// classifyText has real per-request cost at this repo's content volume.
export async function runCategoryClassification() {
  if (categoryClassifyRunning) {
    console.log('[Scheduler] Category classification already running — skipping');
    return;
  }
  categoryClassifyRunning = true;
  try {
    await classifyCategoriesUnclassified();
  } catch (err) {
    console.error('[Scheduler] Category classification error:', err.message);
  } finally {
    categoryClassifyRunning = false;
  }
}

// Only classifies NEW/edited content (a small batch — see classify/voice.js).
// Backfilling the existing library is a separate, manually-run script since
// each classification is a billed Claude call at this repo's content volume.
export async function runVoiceClassification() {
  if (voiceClassifyRunning) {
    console.log('[Scheduler] Voice classification already running — skipping');
    return;
  }
  voiceClassifyRunning = true;
  try {
    await classifyVoicesUnclassified();
  } catch (err) {
    console.error('[Scheduler] Voice classification error:', err.message);
  } finally {
    voiceClassifyRunning = false;
  }
}

const BENCHMARK_CHECK_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;

// Runs the Content Value benchmark recalibration check (utils/benchmarkCheck.js)
// only if 30+ days have passed since the last one (or it's never run) — a
// true rolling 30-day cadence, piggybacked on the existing daily cron rather
// than its own cron schedule, since node-cron is calendar-based and has no
// native "every N days" expression. `force` bypasses the gate for the manual
// "Run Check Now" trigger (see routes/settings.js).
export function runBenchmarkCheckIfDue(force = false) {
  const db = getDb();
  if (!force) {
    const last = db.prepare("SELECT value FROM sync_state WHERE key = 'last_benchmark_check'").get();
    if (last?.value && Date.now() - new Date(last.value).getTime() < BENCHMARK_CHECK_INTERVAL_MS) {
      return null; // not due yet
    }
  }
  const flagged = runBenchmarkCheck(db, getSettings());
  console.log(`[Scheduler] Benchmark check complete — ${flagged.length} dimension(s) flagged for review`);
  return flagged;
}

export function initScheduler() {
  // Full sync once a day at 6:00am Central — content, then analytics
  // (GA4/Marfeel/GSC), then classification, run sequentially in that order
  // so each stage has fresh data from the one before it.
  cron.schedule('0 6 * * *', async () => {
    console.log('[Scheduler] Triggering daily full sync (content → analytics → classification)');
    await runContentSync();
    await runAnalyticsSync();
    await runClassification();
    await runCategoryClassification();
    await runVoiceClassification();
    try {
      runBenchmarkCheckIfDue();
    } catch (err) {
      console.error('[Scheduler] Benchmark check error:', err.message);
    }
  }, { timezone: 'America/Chicago' });

  console.log('[Scheduler] Cron jobs initialized — daily full sync at 6:00am Central');
}

export function getSyncStatus() {
  const db = getDb();
  const state = db.prepare('SELECT key, value, updated_at FROM sync_state').all();
  return Object.fromEntries(state.map(r => [r.key, { value: r.value, updated_at: r.updated_at }]));
}
