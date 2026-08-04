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
//
// Streams the file line-by-line in two passes instead of loading it whole —
// a 90k-row / 11MB export plus its fully-parsed row array was enough to hit
// V8's heap limit on a memory-constrained host (observed on Render). Peak
// memory here is one line + the url->wp_id map, regardless of file size.
import fs from 'fs';
import readline from 'readline';
import { getDb } from '../db.js';

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

function streamLines(filePath, onLine) {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: fs.createReadStream(filePath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });
    let first = true;
    let header = null;
    rl.on('line', line => {
      if (first) {
        // Strip a leading BOM if present, header line only.
        header = parseCsvLine(line.replace(/^﻿/, ''));
        first = false;
        return;
      }
      onLine(line, header);
    });
    rl.on('close', () => resolve(header));
    rl.on('error', reject);
  });
}

async function main() {
  // Pass 1: cheap — just collect the distinct week_start values so we know
  // which one is the trailing partial week, without holding any row data.
  const weeksSeen = new Set();
  const header = await streamLines(csvPath, (line) => {
    const [url, dateRaw] = parseCsvLine(line);
    if (!url) return; // the trailing ,"Total",... row
    const week_start = (dateRaw || '').slice(0, 10);
    if (week_start) weeksSeen.add(week_start);
  });
  console.log(`Header: ${header.join(', ')}`);

  const weeks = [...weeksSeen].sort();
  const lastWeek = weeks[weeks.length - 1];
  const excludedWeek = (!includeLastWeek && weeks.length > 1) ? lastWeek : null;
  if (excludedWeek) {
    console.log(`Excluding most recent week ${excludedWeek} — export cutoff falls mid-week, so this bucket under-counts. Pass --include-last-week to keep it.`);
  }
  console.log(`Found ${weeks.length} weeks (${weeks[0]}..${lastWeek}).`);

  const db = getDb();
  const content = db.prepare('SELECT wp_id, url FROM content WHERE url IS NOT NULL').all();
  const urlToWpId = new Map();
  for (const c of content) {
    const norm = normalizeUrl(c.url);
    urlToWpId.set(norm, c.wp_id);
    urlToWpId.set(norm.endsWith('/') ? norm.slice(0, -1) : norm + '/', c.wp_id);
  }
  console.log(`Loaded ${content.length} content URLs for matching.`);

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

  // Batch into small transactions (not one giant one) — keeps memory flat
  // while still being far faster than autocommit-per-row.
  const BATCH_SIZE = 500;
  let batch = [];
  const flush = db.transaction((rows) => {
    for (const r of rows) upsert.run(r.wpId, r.week_start, r.newsletter_signup, r.newsletter_signup_inline, r.unique_users);
  });

  let parsed = 0, imported = 0, matched = 0, unmatched = 0, skippedWeek = 0;

  // Pass 2: stream again, parse + filter + batch-upsert per line. Never
  // holds more than BATCH_SIZE rows or one raw line in memory.
  await streamLines(csvPath, (line) => {
    const [url, dateRaw, usersRaw, signupRaw, signupInlineRaw] = parseCsvLine(line);
    if (!url) return;
    const week_start = (dateRaw || '').slice(0, 10);
    if (!week_start) return;
    parsed++;
    if (week_start === excludedWeek) { skippedWeek++; return; }

    const wpId = urlToWpId.get(normalizeUrl(url));
    if (!wpId) { unmatched++; return; }
    matched++;

    batch.push({
      wpId,
      week_start,
      unique_users: parseInt(usersRaw, 10) || 0,
      newsletter_signup: parseInt(signupRaw, 10) || 0,
      newsletter_signup_inline: parseInt(signupInlineRaw, 10) || 0,
    });
    if (batch.length >= BATCH_SIZE) {
      flush(batch);
      imported += batch.length;
      batch = [];
    }
  });
  if (batch.length > 0) {
    flush(batch);
    imported += batch.length;
  }

  console.log(`Parsed ${parsed} rows (${skippedWeek} in the excluded week).`);
  console.log(`Matched ${matched} rows to known content (${unmatched} unmatched — non-article pages, or content not yet in our sync).`);
  console.log(`Imported ${imported} historical_newsletter_signups rows.`);
}

main().catch(err => {
  console.error('Import failed:', err);
  process.exit(1);
});
