// One-off import of a historical Marfeel newsletter-signups CSV export into
// historical_newsletter_signups. The live Marfeel API can't look back in
// time at all (see server/sync/marfeel.js's fetchNewsletterSignupsForGoal —
// the `offset` param is silently ignored) — this is a manual backfill from
// a report exported through Marfeel's own dashboard, not an ongoing sync.
// Safe to re-run (upserts on wp_id+week_start).
//
// Usage: node server/scripts/import-historical-newsletter-signups.mjs <path-to-csv> [--include-last-week]
//
// Expected CSV columns: url,date,uniqueUsers,newsletter_signup,newsletter_signup_inline
// One row per (url, week). The trailing `,"Total",...` summary row is
// skipped automatically (empty url field). The most recent week is dropped
// by default — Marfeel's export is pulled mid-week, so that bucket is a
// partial count, not a real weekly total. Pass --include-last-week to keep
// it anyway.
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '..', '..', 'content.db');

const args = process.argv.slice(2);
const csvPath = args.find(a => !a.startsWith('--'));
const includeLastWeek = args.includes('--include-last-week');

if (!csvPath) {
  console.error('Usage: node server/scripts/import-historical-newsletter-signups.mjs <path-to-csv> [--include-last-week]');
  process.exit(1);
}

// Minimal quoted-CSV line parser for this export's "field","field" shape,
// including "" as an escaped quote inside a field. Not a general CSV parser
// (e.g. no bare-newline-inside-quotes support) — sufficient for this file.
function parseCsvLine(line) {
  const fields = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { fields.push(cur); cur = ''; }
      else cur += c;
    }
  }
  fields.push(cur);
  return fields;
}

// Same normalization as marfeel.js / scheduler.js's GSC matching, so a URL
// matches regardless of trailing slash.
function normalizeUrl(raw) {
  try {
    const u = new URL(raw);
    return u.origin + u.pathname;
  } catch {
    return raw;
  }
}

const raw = fs.readFileSync(csvPath, 'utf8').replace(/^﻿/, ''); // strip BOM
const lines = raw.split(/\r?\n/).filter(l => l.trim().length > 0);
const header = parseCsvLine(lines[0]);
console.log(`Header: ${header.join(', ')}`);

const rows = [];
const weeksSeen = new Set();
for (let i = 1; i < lines.length; i++) {
  const [url, dateRaw, usersRaw, signupRaw, signupInlineRaw] = parseCsvLine(lines[i]);
  if (!url) continue; // skips the trailing ,"Total",... row (empty url field)
  const week_start = (dateRaw || '').slice(0, 10);
  if (!week_start) continue;
  rows.push({
    url,
    week_start,
    unique_users: parseInt(usersRaw, 10) || 0,
    newsletter_signup: parseInt(signupRaw, 10) || 0,
    newsletter_signup_inline: parseInt(signupInlineRaw, 10) || 0,
  });
  weeksSeen.add(week_start);
}

const weeks = [...weeksSeen].sort();
const lastWeek = weeks[weeks.length - 1];
const excludedWeek = (!includeLastWeek && weeks.length > 1) ? lastWeek : null;
if (excludedWeek) {
  const rowCount = rows.filter(r => r.week_start === excludedWeek).length;
  console.log(`Excluding most recent week ${excludedWeek} (${rowCount} rows) — export cutoff falls mid-week, so this bucket under-counts. Pass --include-last-week to keep it.`);
}

const filtered = rows.filter(r => r.week_start !== excludedWeek);
console.log(`Parsed ${rows.length} rows across ${weeks.length} weeks; importing ${filtered.length} rows.`);

const db = new Database(DB_PATH);
const content = db.prepare('SELECT wp_id, url FROM content WHERE url IS NOT NULL').all();
const urlToWpId = new Map();
for (const c of content) {
  const norm = normalizeUrl(c.url);
  urlToWpId.set(norm, c.wp_id);
  urlToWpId.set(norm.endsWith('/') ? norm.slice(0, -1) : norm + '/', c.wp_id);
}

const upsert = db.prepare(`
  INSERT INTO historical_newsletter_signups
    (wp_id, week_start, newsletter_signup, newsletter_signup_inline, unique_users, imported_at)
  VALUES (?, ?, ?, ?, ?, datetime('now'))
  ON CONFLICT(wp_id, week_start) DO UPDATE SET
    newsletter_signup = excluded.newsletter_signup,
    newsletter_signup_inline = excluded.newsletter_signup_inline,
    unique_users = excluded.unique_users,
    imported_at = excluded.imported_at
`);

let matched = 0, unmatched = 0;
const tx = db.transaction(() => {
  for (const r of filtered) {
    const wpId = urlToWpId.get(normalizeUrl(r.url));
    if (!wpId) { unmatched++; continue; }
    matched++;
    upsert.run(wpId, r.week_start, r.newsletter_signup, r.newsletter_signup_inline, r.unique_users);
  }
});
tx();

const totalSignups = filtered.reduce((s, r) => s + r.newsletter_signup + r.newsletter_signup_inline, 0);
console.log(`Matched ${matched} rows to known content (${unmatched} unmatched — non-article pages, or content not yet in our sync).`);
console.log(`Imported ${matched} historical_newsletter_signups rows. Total signups across the whole export (matched + unmatched): ${totalSignups}.`);
