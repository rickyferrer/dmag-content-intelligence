// Single source of truth for the True Value model.
//
// Mixed philosophy:
//   - Subscribe clicks and newsletter signups use RAW COUNTS — an article that
//     drives 5 subscriptions is better than one that drives 2, regardless of
//     how many readers it took. These are output metrics.
//   - Loyal in-market share, engagement time, and ad RPM use PER-READER RATES —
//     these are quality signals where efficiency matters regardless of scale.
//
// A confidence factor shrinks scores for very low-traffic articles so a single
// signup from 50 readers doesn't dominate over proven high-volume articles.

// Benchmarks: the count/rate that earns a score of 100 on each dimension.
const BENCHMARKS = {
  subCount:   5,     // subscribe clicks in 30 days (5 = excellent for one article)
  newsCount:  5,     // newsletter signups in 30 days
  loyalShare: 0.19,  // loyal in-market share of pageviews   (p90 ≈ 0.19)
  engSeconds: 375,   // avg engagement seconds               (p90 ≈ 374)
  adRpm:      140,   // ad revenue per 1,000 readers ($)     (p90 ≈ 139)
};

export function getScoreParams(settings = {}) {
  return {
    wSub:   parseFloat(settings.score_w_subscription ?? 40),
    wLoyal: parseFloat(settings.score_w_loyal        ?? 25),
    wNews:  parseFloat(settings.score_w_newsletter   ?? 15),
    wEng:   parseFloat(settings.score_w_engagement   ?? 15),
    wAd:    parseFloat(settings.score_w_ad_revenue   ?? 5),
    confK:  Math.max(0, parseFloat(settings.score_confidence_k ?? 100)),
  };
}

function signals(snap) {
  return {
    users:      snap.ga4_users               || 0,
    pageviews:  snap.ga4_pageviews           || 0,
    sub:        snap.ga4_subscribe_clicks    || 0,
    newsletter: snap.mf_newsletter_signups   || 0,
    loyal:      snap.ga4_loyal_inmarket_pv   || 0,
    engagement: snap.ga4_avg_engagement_time || 0,
    ad:         snap.ga4_ad_revenue          || 0,
  };
}

const cap100 = x => Math.max(0, Math.min(100, x));

// Per-dimension 0-100 sub-scores.
// Conversion signals (sub, newsletter) use raw counts — more is better.
// Quality signals (loyal, engagement, ad) use per-reader rates — efficiency matters.
export function dimensionScores(snap) {
  const s = signals(snap);
  const per1k = s.users > 0 ? 1000 / s.users : 0;
  const loyalDenom = s.pageviews > 0 ? s.pageviews : s.users;
  return {
    subscription: cap100(s.sub        / BENCHMARKS.subCount  * 100),
    newsletter:   cap100(s.newsletter / BENCHMARKS.newsCount * 100),
    loyal:        cap100((loyalDenom > 0 ? s.loyal / loyalDenom : 0) / BENCHMARKS.loyalShare * 100),
    engagement:   cap100(s.engagement / BENCHMARKS.engSeconds * 100),
    ad:           cap100((s.ad * per1k) / BENCHMARKS.adRpm * 100),
  };
}

// Low-traffic articles can't reliably demonstrate conversion, so we shrink their
// score toward 0 until they accumulate enough readers: users / (users + K).
export function confidence(snap, K) {
  const u = snap.ga4_users || 0;
  if (K <= 0) return u > 0 ? 1 : 0;
  return u / (u + K);
}

function compositeScore(d, p) {
  const totalW = p.wSub + p.wLoyal + p.wNews + p.wEng + p.wAd || 1;
  return (
    d.subscription * p.wSub +
    d.loyal        * p.wLoyal +
    d.newsletter   * p.wNews +
    d.engagement   * p.wEng +
    d.ad           * p.wAd
  ) / totalW;
}

export function valueToScore(snap, p) {
  return Math.round(compositeScore(dimensionScores(snap), p) * confidence(snap, p.confK));
}

// Full breakdown for the detail panel — reconciles exactly with the table score.
export function getValueBreakdown(snap, settings) {
  const p = getScoreParams(settings);
  const d = dimensionScores(snap);
  const conf = confidence(snap, p.confK);
  const composite = compositeScore(d, p);
  return {
    score: Math.round(composite * conf),
    composite: Math.round(composite),
    confidence: conf,
    dimensions: d,
    weights: { subscription: p.wSub, loyal: p.wLoyal, newsletter: p.wNews, engagement: p.wEng, ad: p.wAd },
  };
}
