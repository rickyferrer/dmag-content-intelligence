// 30-day Content Value benchmark recalibration check. Runs the same
// diagnostic manually run on 2026-08-28 (which found the Loyal Readers and
// Engagement benchmarks had gone stale — real content was capping those
// dimensions at 100 far more often than intended) as a periodic, automated
// check instead of a one-off manual investigation.
//
// Flags dimensions, does NOT change anything itself — every proposed value
// sits in benchmark_checks until an admin reviews and applies it from
// Settings. Automating the FIX (not just the check) was considered and
// rejected: an unattended run can't tell a real new high-water mark from an
// anomaly (the In-Market bug and the excluded homepage outlier both would
// have skewed an automatic recalibration this session), and every benchmark
// change so far has needed real judgment a human should stay in the loop for.
import { BENCHMARK_META, DEFAULT_BENCHMARKS } from './trueValue.js';
import { setSyncState } from '../db.js';

// A dimension capping more than this share of real content is "too soft" —
// too many articles are hitting a ceiling that should be reserved for
// genuinely exceptional performance (this is the same ~5-7% range that
// flagged Loyal Readers and Engagement on 2026-08-28).
const TOO_SOFT_CAPPING_THRESHOLD = 0.05;

// A dimension where NOTHING reaches it, and the real max sits well below it,
// is "too hard" — the ceiling is effectively unreachable, so 100 never
// happens on that dimension for anyone. Only flagged when the real max is
// under this fraction of the current benchmark, so a merely-strict-but-
// occasionally-achieved benchmark isn't flagged as broken.
const TOO_HARD_MAX_RATIO = 0.7;

// Below this many real (traffic > 0, not excluded) articles, a percentile
// is too noisy to trust — skip the dimension rather than propose a value
// off a handful of data points.
const MIN_SAMPLE_SIZE = 30;

function percentile(sortedArr, p) {
  if (sortedArr.length === 0) return 0;
  return sortedArr[Math.min(sortedArr.length - 1, Math.floor(sortedArr.length * p))];
}

function roundTo(value, step) {
  if (!step) return Math.round(value * 100) / 100;
  return Math.round(value / step) * step;
}

// Pulls the same signals dimensionScores() reads (see utils/trueValue.js),
// scoped to real scored content — matches the manual query run this session:
// traffic > 0, not excluded_from_scoring (so a homepage/section-front page
// can't single-handedly define "excellent").
function loadDistributions(db) {
  const rows = db.prepare(`
    SELECT a.ga4_users, a.ga4_subscribe_clicks, a.mf_newsletter_signups,
      a.ga4_avg_engagement_time, a.ga4_inmarket_pageviews, a.ga4_loyal_users, a.ga4_ad_revenue
    FROM content c
    JOIN (SELECT wp_id, MAX(snapshot_at) as latest FROM analytics_snapshots GROUP BY wp_id) lx ON c.wp_id = lx.wp_id
    JOIN analytics_snapshots a ON a.wp_id = lx.wp_id AND a.snapshot_at = lx.latest
    WHERE a.ga4_users > 0 AND c.excluded_from_scoring = 0
  `).all();

  return {
    subCount:      rows.map(r => r.ga4_subscribe_clicks || 0),
    newsCount:     rows.map(r => r.mf_newsletter_signups || 0),
    loyalCount:    rows.map(r => r.ga4_loyal_users || 0),
    inmarketShare: rows.map(r => r.ga4_users > 0 ? (r.ga4_inmarket_pageviews || 0) / r.ga4_users : 0),
    engSeconds:    rows.map(r => r.ga4_avg_engagement_time || 0),
    adRpm:         rows.map(r => r.ga4_users > 0 ? (r.ga4_ad_revenue || 0) * 1000 / r.ga4_users : 0),
  };
}

// Runs the check, writes one benchmark_checks row per flagged dimension
// (writes nothing for healthy ones), records the check timestamp, and
// returns the list of newly-flagged dimensions.
export function runBenchmarkCheck(db, settings) {
  const distributions = loadDistributions(db);
  const nowIso = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO benchmark_checks
      (checked_at, benchmark_key, direction, current_value, recommended_value, capping_pct, sample_size)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const flagged = [];
  for (const [key, meta] of Object.entries(BENCHMARK_META)) {
    const arr = distributions[key];
    if (!arr || arr.length < MIN_SAMPLE_SIZE) continue;

    const currentValue = parseFloat(settings[meta.settingKey] ?? DEFAULT_BENCHMARKS[key]);
    const sorted = [...arr].sort((a, b) => a - b);
    const p99 = percentile(sorted, 0.99);
    const max = sorted[sorted.length - 1];
    const cappingCount = arr.filter(x => x >= currentValue).length;
    const cappingPct = cappingCount / arr.length;

    let direction = null;
    let recommended = null;
    if (cappingPct > TOO_SOFT_CAPPING_THRESHOLD) {
      direction = 'too_soft';
      // Never propose lower than what's already live — p99 could sit below
      // the current value if the capping is coming from a handful of ties
      // right at the current benchmark rather than genuine outliers above it.
      recommended = roundTo(Math.max(p99, currentValue), meta.round);
    } else if (cappingCount === 0 && max > 0 && max < currentValue * TOO_HARD_MAX_RATIO) {
      direction = 'too_hard';
      recommended = roundTo(max, meta.round);
    }

    if (direction && recommended !== currentValue) {
      insert.run(nowIso, key, direction, currentValue, recommended, cappingPct * 100, arr.length);
      flagged.push({
        benchmark_key: key,
        label: meta.label,
        direction,
        current_value: currentValue,
        recommended_value: recommended,
        capping_pct: cappingPct * 100,
        sample_size: arr.length,
      });
    }
  }

  setSyncState('last_benchmark_check', nowIso);
  return flagged;
}
