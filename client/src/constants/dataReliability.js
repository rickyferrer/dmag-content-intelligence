// Shared "how far back is this actually real" wording for the two metrics
// that are stitched together from a live rolling window + a historical
// backfill with its own hard floor. Centralized so Content, Sections,
// Writers, and Sources all say the same thing instead of drifting — update
// the dates here if either backfill is ever re-run/extended.
//
// Subscribe Clicks: historical_subscribe_clicks is a GA4-sourced backfill
// (server/scripts/backfill-historical-subscribe-clicks.mjs), safe to re-run
// periodically since GA4 supports arbitrary historical ranges — but it's a
// manual script, not on the daily cron, so its floor only moves forward when
// someone re-runs it. June 30, 2025 was the earliest date GA4 had on hand
// the last time it ran.
export const SUBSCRIBE_CLICKS_NOTE =
  'Live clicks from the last ~30 days, plus historical clicks backfilled from GA4 back to June 30, 2025.';

// Newsletter Signups (per-article, NOT the Overview site-wide card): the live
// number is Marfeel's rolling ~30 days (its API can't look back further).
// History before that is saved two ways: a one-time Marfeel CSV export
// covering April 6 – August 2, 2026 (weekly), and, from October 2, 2026, the
// daily sync saves each day as it completes (see sync/newsletterDaily.js). The
// days in between — August 3 to October 1 — are only included once a Marfeel
// export covering them has been imported with
// server/scripts/import-historical-newsletter-signups.mjs; delete that
// sentence from the note below when it has been.
export const NEWSLETTER_NOTE =
  'Live signups from the last ~30 days, plus saved history: a Marfeel export (April 6 – Aug 2, 2026) and, from Oct 2, 2026, each day saved as it completes. Aug 3 – Oct 1 is only included once a Marfeel export covering it has been imported.';
