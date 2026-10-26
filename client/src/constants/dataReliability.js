// Shared "how far back is this actually real" wording for the two metrics
// that are stitched together from a live rolling window + a historical
// backfill with its own hard floor. Centralized so Content, Sections,
// Writers, and Sources all say the same thing instead of drifting — update
// the dates here if either backfill is ever re-run/extended.
//
// Subscribe Clicks: the history is GA4-sourced and kept current by the daily
// analytics sync (sync/subscribeClicksDaily.js). Every "history" figure here
// starts at Jan 1, 2026 — the dashboard's true start date (see
// server/utils/dataStart.js) — even where GA4 holds earlier days.
export const SUBSCRIBE_CLICKS_NOTE =
  'Live clicks from the last ~30 days, plus historical clicks from GA4 back to Jan 1, 2026.';

// Newsletter Signups (per-article, NOT the Overview site-wide card): the live
// number is Marfeel's rolling ~30 days. History before that, from Jan 1, 2026,
// is saved three ways: Marfeel's report API for the stretches nothing else
// covers (Jan 1 – Apr 5 and Aug 3 – Oct 1, via
// server/scripts/backfill-newsletter-from-marfeel.mjs), a one-time Marfeel CSV
// export covering April 6 – August 2, 2026 (weekly), and, from October 2, 2026,
// each day saved as the daily sync completes it (see sync/newsletterDaily.js).
export const NEWSLETTER_NOTE =
  'Live signups from the last ~30 days, plus saved history back to Jan 1, 2026 (Marfeel report API and export, then each day saved as it completes from Oct 2, 2026).';
