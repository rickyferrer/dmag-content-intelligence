// Fill a gap in per-article newsletter-signup history straight from Marfeel's
// report API — no CSV export needed. The live realtime endpoint only sees a
// rolling 30 days, but the report endpoint takes an absolute date range (see
// fetchNewsletterSignupsRange in sync/marfeel.js), so days that aged out
// before the daily capture started (newsletterDaily.js) can be recovered.
// Safe to re-run (upserts on wp_id+date).
//
// Usage: node server/scripts/backfill-newsletter-from-marfeel.mjs [--start YYYY-MM-DD] [--end YYYY-MM-DD] [--dry-run]
//   defaults: --start DATA_START (utils/dataStart.js) --end 2026-10-01 — i.e.
//   everything before the daily capture began on Oct 2, with the weeks already
//   saved from the Marfeel CSV export (Apr 6 - Aug 2) skipped automatically.
//   Needs MARFEEL_EMAIL / MARFEEL_PASSWORD in the environment.
//
// Like the CSV importer, days already inside a stored weekly bucket are
// skipped (nothing is counted twice) and today is never written. Rows only
// count once older than the live 30-day window, so this is harmless to run
// for recent days — they start counting as they age out of it.
import { getDb } from '../db.js';
import { fetchNewsletterSignupsRange } from '../sync/marfeel.js';
import { centralDate } from '../sync/newsletterDaily.js';
import { DATA_START } from '../utils/dataStart.js';

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};
const start = argValue('--start', DATA_START);
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

// A day is already covered if it falls inside ANY stored weekly bucket (a week
// starts on its Monday and runs seven days). Checked per week, not against the
// newest week, so days before the oldest stored week can still be filled in.
const weekStarts = db.prepare('SELECT DISTINCT week_start FROM historical_newsletter_signups').all().map(r => r.week_start);
const coveredDays = new Set();
for (const w of weekStarts) for (let i = 0; i < 7; i++) coveredDays.add(addDays(w, i));
if (weekStarts.length) console.log(`Weekly history already covers ${coveredDays.size} days (${weekStarts.length} weeks) — those days are skipped.`);
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
  if (r.date >= today || coveredDays.has(r.date)) { skipped++; continue; }
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
