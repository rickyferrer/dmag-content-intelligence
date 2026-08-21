// Single source of truth for the Content Value model.
//
// Mixed philosophy:
//   - Subscribe clicks, newsletter signups, and loyal readers use RAW COUNTS
//     — an article that draws 150 loyal readers is better than one that
//     draws 50, regardless of how big its total audience was. These are
//     output/reach metrics: absolute scale is the point, not deflating a
//     big-reach piece just because its loyal readers are a smaller SHARE of
//     a much bigger crowd.
//   - In-market (DFW) share, engagement time, and ad RPM use PER-READER
//     RATES — these are quality signals where efficiency matters regardless
//     of scale.
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
  loyalCount:    125,   // loyal (repeat) readers in 30 days     (p90 ≈ 123)
  inmarketShare: 0.51,  // DFW-area ("in-market") users ÷ total users (p90 ≈ 0.51)
  engSeconds:    375,   // avg engagement seconds                (p90 ≈ 374)
  // Ad revenue per 1,000 readers ($) — NOTIONAL, not real revenue: ad
  // impressions × a flat assumed CPM (see sync/ga4.js's AD_CPM), per the
  // executive team's call to isolate traffic's ad-supported value from
  // real-world CPM noise. Recalibrated for that switch (p90 ≈ 71, roughly
  // half the old real-revenue-based benchmark of 140) — if AD_CPM ever
  // changes, this benchmark scales linearly with it and should be
  // recalibrated too, or every article's Ad Revenue dimension score will
  // silently shift.
  adRpm:         71,
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
// Reach signals (sub, newsletter, loyal) use raw counts — more is better,
// regardless of total audience size.
// Quality signals (inmarket, engagement, ad) use per-reader rates —
// efficiency matters, not raw volume.
export function dimensionScores(snap) {
  const s = signals(snap);
  const per1k = s.users > 0 ? 1000 / s.users : 0;
  return {
    subscription: cap100(s.sub        / BENCHMARKS.subCount   * 100),
    newsletter:   cap100(s.newsletter / BENCHMARKS.newsCount  * 100),
    loyal:        cap100(s.loyalUsers / BENCHMARKS.loyalCount * 100),
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

// "Lifetime Content Value" — same model, but Subscribe Clicks and Newsletter
// are fed their combined historical-backfill + rolling totals instead of
// just the trailing ~30 days, so an older article's full track record counts
// instead of only what it's done recently. This is the ONLY thing that
// differs: Users/Loyal/In-Market/Engagement/Ad-Revenue have no historical
// per-day archive at the article level, so GA4 only ever gives us a rolling
// 30-day snapshot for those regardless — there's no "lifetime" version of
// them to compute.
//
// Deliberately a SEPARATE score from true_value/dimensionScores() above,
// not a replacement — true_value stays rolling-only and keeps feeding every
// grouped view (Sections, Writers, User Needs, Publications, Overview,
// Insights, AI Vulnerability), which the VP of Audience Development wants
// to keep reflecting current performance. This lifetime version is only for
// judging individual articles (the Content tab and article detail panel),
// where "how has this piece actually resonated with readers" is the point —
// see server/routes/content.js.
//
// `totals` is { subscribeClicksTotal, newsletterSignupsTotal } — the same
// historical+live merge already computed for display everywhere else in the
// app (search this codebase for the "non-overlap merge" pattern).
export function shapeForLifetime(snap, totals) {
  return {
    ...snap,
    ga4_subscribe_clicks:  totals.subscribeClicksTotal  ?? snap.ga4_subscribe_clicks,
    mf_newsletter_signups: totals.newsletterSignupsTotal ?? snap.mf_newsletter_signups,
  };
}
