// The first day this dashboard treats as real. Everything "lifetime" starts
// here: the GA4 lifetime pass (sync/ga4.js), the subscribe-click history, the
// newsletter-signup history and its backfill, and the notes shown in the UI.
// Earlier traffic exists in GA4 but is deliberately ignored, so every lifetime
// input covers the same stretch and an older issue isn't scored on a different
// window than a newer one. Marfeel (newsletter signups) has no usable history
// before 2026 anyway. Changing this takes effect on the next lifetime refresh
// (lifetime_metrics records which start date its counts were taken from).
export const DATA_START = '2026-01-01';
