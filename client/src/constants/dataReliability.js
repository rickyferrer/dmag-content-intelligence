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

// Newsletter Signups (per-article, NOT the Overview site-wide card): a
// one-time Marfeel CSV export backfilled April 6 – July 27, 2026 (Marfeel's
// live API can't look back in time at all, so this window is fixed unless a
// new export is imported), continued from July 27 forward by the live
// rolling ~30-day number.
export const NEWSLETTER_NOTE =
  'Live signups from the last ~30 days, plus historical signups backfilled from a one-time Marfeel export (April 6 – July 27, 2026).';
