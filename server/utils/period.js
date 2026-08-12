// Period-over-period comparison helpers shared across analytics.js and
// content.js so every tab's "vs. previous period" comparison uses the same
// definition of "previous period" and the same %-change math.

export function pctChange(curr, prev) {
  if (prev == null || prev === 0) return null;
  return ((curr - prev) / prev) * 100;
}

// The immediately-preceding window of the same length — "Last 30 Days" vs.
// "the 30 days before that". Returns null when there's no concrete range to
// shift back from ("All time" has no meaningful previous period).
export function previousPeriodRange(dateFrom, dateTo) {
  if (!dateFrom || !dateTo) return null;
  const from = new Date(dateFrom + 'T00:00:00Z');
  const to = new Date(dateTo + 'T00:00:00Z');
  const durationDays = Math.max(1, Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)));
  const fmtDate = (d) => d.toISOString().slice(0, 10);
  const priorTo = new Date(from.getTime() - 24 * 60 * 60 * 1000);
  const priorFrom = new Date(priorTo.getTime() - durationDays * 24 * 60 * 60 * 1000);
  return { from: fmtDate(priorFrom), to: fmtDate(priorTo) };
}
