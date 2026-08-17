// Single source of truth for the Content Value model.
//
// Mixed philosophy:
//   - Subscribe clicks and newsletter signups use RAW COUNTS — an article that
//     drives 5 subscriptions is better than one that drives 2, regardless of
//     how many readers it took. These are output metrics.
//   - Loyal share, in-market (DFW) share, engagement time, and ad RPM use
//     PER-READER RATES — these are quality signals where efficiency matters
//     regardless of scale.
//
// A confidence factor shrinks scores for very low-traffic articles so a single
// signup from 50 readers doesn't dominate over proven high-volume articles.
//
// Loyal and In-Market were originally one blended dimension (their GA4-derived
// intersection, ga4_loyal_inmarket_pv — see sync/ga4.js). Split into two
// independent dimensions so each strategic signal — repeat readership vs.
// local/DFW-market readership — can be weighted and read on its own, rather
// than one article's low score on one silently dragging down the other.

// Benchmarks: the count/rate that earns a score of 100 on each dimension.
const BENCHMARKS = {
  subCount:      5,     // subscribe clicks in 30 days (5 = excellent for one article)
  newsCount:     5,     // newsletter signups in 30 days
  loyalShare:    0.39,  // loyal users ÷ total users             (p90 ≈ 0.39)
  inmarketShare: 0.51,  // DFW-area ("in-market") users ÷ total users (p90 ≈ 0.51)
  engSeconds:    375,   // avg engagement seconds                (p90 ≈ 374)
  adRpm:         140,   // ad revenue per 1,000 readers ($)      (p90 ≈ 139)
};

export function getScoreParams(settings = {}) {
  return {
    wSub:      parseFloat(settings.score_w_subscription ?? 40),
    wLoyal:    parseFloat(settings.score_w_loyal         ?? 15),
    wInmarket: parseFloat(settings.score_w_inmarket      ?? 10),
    wNews:     parseFloat(settings.score_w_newsletter    ?? 15),
    wEng:      parseFloat(settings.score_w_engagement    ?? 15),
    wAd:       parseFloat(settings.score_w_ad_revenue    ?? 5),
    confK:     Math.max(0, parseFloat(settings.score_confidence_k ?? 100)),
  };
}

function signals(snap) {
  return {
    users:      snap.ga4_users               || 0,
    pageviews:  snap.ga4_pageviews           || 0,
    sub:        snap.ga4_subscribe_clicks    || 0,
    newsletter: snap.mf_newsletter_signups   || 0,
    loyalUsers:    snap.ga4_loyal_users      || 0,
    inmarketUsers: snap.ga4_inmarket_pageviews || 0, // DFW-geo active users — see sync/ga4.js Query 2 (field name predates that clarification)
    engagement: snap.ga4_avg_engagement_time || 0,
    ad:         snap.ga4_ad_revenue          || 0,
  };
}

const cap100 = x => Math.max(0, Math.min(100, x));

// Per-dimension 0-100 sub-scores.
// Conversion signals (sub, newsletter) use raw counts — more is better.
// Quality signals (loyal, inmarket, engagement, ad) use per-reader rates —
// efficiency matters, not raw volume.
export function dimensionScores(snap) {
  const s = signals(snap);
  const per1k = s.users > 0 ? 1000 / s.users : 0;
  return {
    subscription: cap100(s.sub        / BENCHMARKS.subCount  * 100),
    newsletter:   cap100(s.newsletter / BENCHMARKS.newsCount * 100),
    loyal:        cap100((s.users > 0 ? s.loyalUsers    / s.users : 0) / BENCHMARKS.loyalShare    * 100),
    inmarket:     cap100((s.users > 0 ? s.inmarketUsers / s.users : 0) / BENCHMARKS.inmarketShare * 100),
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
  const totalW = p.wSub + p.wLoyal + p.wInmarket + p.wNews + p.wEng + p.wAd || 1;
  return (
    d.subscription * p.wSub +
    d.loyal        * p.wLoyal +
    d.inmarket     * p.wInmarket +
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
    weights: { subscription: p.wSub, loyal: p.wLoyal, inmarket: p.wInmarket, newsletter: p.wNews, engagement: p.wEng, ad: p.wAd },
  };
}
