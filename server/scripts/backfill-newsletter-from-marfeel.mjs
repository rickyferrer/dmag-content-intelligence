// Fill a gap in per-article newsletter-signup history straight from Marfeel's
// report API — no CSV export needed. The live realtime endpoint only sees a
// rolling 30 days, but the report endpoint takes an absolute date range (see
// fetchNewsletterSignupsRange in sync/marfeel.js), so days that aged out
// before the daily capture started (newsletterDaily.js) can be recovered.
// Safe to re-run (upserts on wp_id+date).
//
// Usage: node server/scripts/backfill-newsletter-from-marfeel.mjs [--start YYYY-MM-DD] [--end YYYY-MM-DD] [--dry-run]
//   defaults: --start 2026-08-03 --end 2026-10-01 (the stretch between the
//   Marfeel CSV export, which stopped Aug 2, and the daily capture, which
//   began Oct 2). Needs MARFEEL_EMAIL / MARFEEL_PASSWORD in the environment.
//
// Like the CSV importer, days already inside a stored weekly bucket are
// skipped (nothing is counted twice) and today is never written. Rows only
// count once older than the live 30-day window, so this is harmless to run
// for recent days — they start counting as they age out of it.
import { getDb } from '../db.js';
import { fetchNewsletterSignupsRange } from '../sync/marfeel.js';
import { centralDate } from '../sync/newsletterDaily.js';

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};
const start = argValue('--start', '2026-08-03');
const end = argValue('--end', '2026-10-01');
const dryRun = args.includes('--dry-run');

if (![start, end].every(d => /^\d{4}-\d{2}-\d{2}$/.test(d)) || start > end) {
  console.error('Usage: node server/scripts/backfill-newsletter-from-marfeel.mjs [--start YYYY-MM-DD] [--end YYYY-MM-DD] [--dry-run]');
  process.exit(1);
}

const DAY_MS = 24 * 60 * 60 * 1000;
const addDays = (iso, n) => new Date(new Date(iso + 'T00:00:00Z').getTime() + n * DAY_MS).toISOString().slice(0, 10);

console.log(`Fetching newsletter signups per page per day, ${start}..${end}${dryRun ? '   [DRY RUN — nothing will be written]' : ''}`);
const rows = await fetchNewsletterSignupsRange(start, end);
console.log(`Marfeel returned ${rows.length} page-days with signups.`);

const db = getDb();
const urlToWpId = new Map();
for (const c of db.prepare('SELECT wp_id, url FROM content WHERE url IS NOT NULL').all()) {
  let norm = c.url;
  try { const u = new URL(c.url); norm = u.origin + u.pathname; } catch { /* keep raw */ }
  urlToWpId.set(norm, c.wp_id);
  urlToWpId.set(norm.endsWith('/') ? norm.slice(0, -1) : norm + '/', c.wp_id);
}

const lastWeek = db.prepare('SELECT MAX(week_start) AS w FROM historical_newsletter_signups').get().w;
const coveredThrough = lastWeek ? addDays(lastWeek, 6) : null;
if (coveredThrough) console.log(`Weekly history already covers through ${coveredThrough} — days on or before that are skipped.`);
const today = centralDate(0);

const upsert = db.prepare(`
  INSERT INTO newsletter_signups_daily (wp_id, date, newsletter_signup, newsletter_signup_inline, newsletter_signup_modal)
  VALUES (@wp_id, @date, @newsletter_signup, @newsletter_signup_inline, @newsletter_signup_modal)
  ON CONFLICT(wp_id, date) DO UPDATE SET
    newsletter_signup        = excluded.newsletter_signup,
    newsletter_signup_inline = excluded.newsletter_signup_inline,
    newsletter_signup_modal  = excluded.newsletter_signup_modal
`);

let matched = 0, unmatched = 0, skipped = 0, signups = 0, unmatchedSignups = 0;
const unmatchedUrls = new Map();
const toWrite = [];
for (const r of rows) {
  const n = r.newsletter_signup + r.newsletter_signup_inline + r.newsletter_signup_modal;
  if (r.date >= today || (coveredThrough && r.date <= coveredThrough)) { skipped++; continue; }
  const wpId = urlToWpId.get(r.url);
  if (!wpId) {
    unmatched++;
    unmatchedSignups += n;
    unmatchedUrls.set(r.url, (unmatchedUrls.get(r.url) || 0) + n);
    continue;
  }
  matched++;
  signups += n;
  toWrite.push({ wp_id: wpId, date: r.date, newsletter_signup: r.newsletter_signup, newsletter_signup_inline: r.newsletter_signup_inline, newsletter_signup_modal: r.newsletter_signup_modal });
}

if (!dryRun) db.transaction(() => { for (const row of toWrite) upsert.run(row); })();

console.log(`Matched ${matched} page-days to known content (${unmatched} unmatched — non-article pages or content not in our sync; ${skipped} skipped as already covered or not a finished day).`);
console.log(`Signups in matched rows: ${signups}`);
if (unmatchedSignups) {
  console.log(`Signups in UNMATCHED rows (not imported): ${unmatchedSignups}`);
  for (const [u, n] of [...unmatchedUrls].sort((a, b) => b[1] - a[1]).slice(0, 5)) console.log(`   ${n}  ${u}`);
}
console.log(`${dryRun ? 'Would write' : 'Wrote'} ${toWrite.length} newsletter_signups_daily rows.`);
console.log('Next: click Recalculate All Scores in Settings so Lifetime Value picks them up.');
