// Detects the AI Overview "fingerprint" — impressions holding steady (or
// rising) while click-through rate falls — from per-page daily Search
// Console data (gsc_page_daily). Used as a fallback susceptibility signal
// for articles that never earn enough clicks on any single query to appear
// in gsc_queries, so they'd otherwise fall back to a pure title guess.
//
// The split is intentionally asymmetric: a short "recent" window catches a
// genuine, current shift, while a longer "prior" window gives it a stable
// baseline to compare against instead of day-to-day noise.
const RECENT_WINDOW_DAYS = 30;
const MIN_RECENT_IMPRESSIONS = 20;
const MIN_PRIOR_IMPRESSIONS = 50;
// A CTR drop is only credited as an AI Overview symptom if impressions
// didn't also fall — a real decline in relevance/interest looks the same as
// AI Overview cannibalization in the CTR number alone, but only the latter
// keeps impressions intact.
const IMPRESSIONS_STABILITY_TOLERANCE = 0.85;

export function computeTrendRisk(dailyRows) {
  if (!dailyRows || dailyRows.length === 0) return null;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RECENT_WINDOW_DAYS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const recent = dailyRows.filter(d => d.date >= cutoffStr);
  const prior = dailyRows.filter(d => d.date < cutoffStr);
  if (recent.length === 0 || prior.length === 0) return null;

  const sum = (rows, key) => rows.reduce((s, r) => s + (r[key] || 0), 0);
  const recentImpressions = sum(recent, 'impressions');
  const priorImpressions = sum(prior, 'impressions');
  const recentClicks = sum(recent, 'clicks');
  const priorClicks = sum(prior, 'clicks');

  if (recentImpressions < MIN_RECENT_IMPRESSIONS || priorImpressions < MIN_PRIOR_IMPRESSIONS) return null;

  const recentCtr = recentClicks / recentImpressions;
  const priorCtr = priorClicks / priorImpressions;
  if (priorCtr <= 0) return null;

  const recentImpressionsPerDay = recentImpressions / recent.length;
  const priorImpressionsPerDay = priorImpressions / prior.length;
  const impressionsStableOrRising = recentImpressionsPerDay >= priorImpressionsPerDay * IMPRESSIONS_STABILITY_TOLERANCE;
  if (!impressionsStableOrRising) return null; // looks like declining relevance, not AI Overview cannibalization

  const ctrDropPct = Math.max(0, (priorCtr - recentCtr) / priorCtr) * 100;

  // Same 0-100 susceptibility scale as computeQueryRisk's weighted_risk_pct,
  // so it composes identically in the enrichment pipeline (x need_mult,
  // capped at 100). Floor of 5 matches the title-estimate path's floor —
  // never claim zero susceptibility from a derived signal.
  const weighted_risk_pct = Math.min(90, Math.max(5, ctrDropPct));

  // Capped below the max confidence of real per-query classification —
  // this is a derived proxy, not directly observed searcher intent.
  const confidence = Math.min(0.9, 0.3 + 0.6 * Math.min(1, recentImpressions / 200));

  return {
    weighted_risk_pct,
    confidence,
    ctr_drop_pct: ctrDropPct,
    recent_impressions: recentImpressions,
    prior_impressions: priorImpressions,
    recent_ctr: recentCtr,
    prior_ctr: priorCtr,
  };
}
