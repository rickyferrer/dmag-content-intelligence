// Import a Marfeel newsletter-signups CSV export into the history tables.
// The live Marfeel API can't look back in time (see server/sync/marfeel.js —
// "last N days" is the only window it understands) — this is the manual
// backfill from a report exported through Marfeel's own dashboard. Safe to
// re-run (upserts).
//
// Usage: node server/scripts/import-historical-newsletter-signups.mjs <path-to-csv> [options]
//   --dry-run            read and match everything, print the summary, write nothing
//   --daily | --weekly   force the grain; otherwise it's detected from the dates
//   --include-last-week  weekly files only: keep the trailing partial week
//
// Columns are read BY NAME from the header row, in any order. Required: url,
// date. Optional: uniqueUsers, newsletter_signup, newsletter_signup_inline,
// newsletter_signup_modal — whichever the export has; a goal that isn't in the
// file is left untouched in the database. Dates may be "YYYY-MM-DD" or
// "YYYY-MM-DD HH:MM". The trailing `,"Total",...` summary row (empty url) is
// skipped.
//
// Two grains, two tables:
//   weekly (one row per url per week)  -> historical_newsletter_signups
//       the original format. The most recent week is dropped by default —
//       exports are pulled mid-week, so that bucket under-counts.
//   daily  (one row per url per day)   -> newsletter_signups_daily
//       the same table the daily sync writes to. Today's rows are dropped (a
//       day isn't complete), and days already inside a stored weekly bucket
//       are skipped so nothing is ever counted twice — the history view adds
//       the two tables together.
// Everything here is only counted once it is older than the live 30-day
// window, so importing recent days is harmless; they just start counting as
// they age out of it.
//
// Streams the file line-by-line in two passes instead of loading it whole —
// a 90k-row / 11MB export plus its fully-parsed row array was enough to hit
// V8's heap limit on a memory-constrained host (observed on Render). Peak
// memory here is one line + the url->wp_id map, regardless of file size.
import fs from 'fs';
import readline from 'readline';
import { getDb } from '../db.js';
import { centralDate } from '../sync/newsletterDaily.js';

const args = process.argv.slice(2);
const csvPath = args.find(a => !a.startsWith('--'));
const includeLastWeek = args.includes('--include-last-week');
const dryRun = args.includes('--dry-run');
const forcedGrain = args.includes('--daily') ? 'daily' : args.includes('--weekly') ? 'weekly' : null;

if (!csvPath) {
  console.error('Usage: node server/scripts/import-historical-newsletter-signups.mjs <path-to-csv> [--dry-run] [--daily|--weekly] [--include-last-week]');
  process.exit(1);
}

const GOAL_COLUMNS = ['newsletter_signup', 'newsletter_signup_inline', 'newsletter_signup_modal'];
const DAY_MS = 24 * 60 * 60 * 1000;
const addDays = (iso, n) => new Date(new Date(iso + 'T00:00:00Z').getTime() + n * DAY_MS).toISOString().slice(0, 10);

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

// Streams the file; calls onRow(fields, col) for each data line where `col`
// maps header name -> index. Resolves with the header names.
function streamRows(filePath, onRow) {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({
      input: fs.createReadStream(filePath, { encoding: 'utf8' }),
      crlfDelay: Infinity,
    });
    let col = null;
    let names = null;
    rl.on('line', line => {
      if (!col) {
        // Strip a leading BOM if present, header line only.
        names = parseCsvLine(line.replace(/^﻿/, '')).map(h => h.trim());
        col = Object.fromEntries(names.map((h, i) => [h, i]));
        return;
      }
      if (!line.trim()) return;
      onRow(parseCsvLine(line), col);
    });
    rl.on('close', () => resolve(names || []));
    rl.on('error', reject);
  });
}

const dayOf = (raw) => (raw || '').trim().slice(0, 10);
const num = (fields, col, name) => (name in col ? (parseInt(fields[col[name]], 10) || 0) : 0);

async function main() {
  // Pass 1: cheap — collect the distinct dates, to detect the grain and (for
  // weekly files) find the trailing partial week, without holding row data.
  const datesSeen = new Set();
  const header = await streamRows(csvPath, (f, col) => {
    if (!('url' in col) || !('date' in col)) return;
    if (!f[col.url]) return; // the trailing ,"Total",... row
    const d = dayOf(f[col.date]);
    if (d) datesSeen.add(d);
  });
  console.log(`Header: ${header.join(', ')}`);
  if (!header.includes('url') || !header.includes('date')) {
    console.error('Expected "url" and "date" columns in the header row.');
    process.exit(1);
  }
  const presentGoals = GOAL_COLUMNS.filter(g => header.includes(g));
  const hasUsers = header.includes('uniqueUsers');
  if (!presentGoals.length) {
    console.error(`No signup columns found (looked for ${GOAL_COLUMNS.join(', ')}).`);
    process.exit(1);
  }

  const dates = [...datesSeen].sort();
  if (!dates.length) { console.error('No data rows found.'); process.exit(1); }

  // Weekly if every date is a Monday and no two dates are closer than a week.
  let grain = forcedGrain;
  if (!grain) {
    const isMonday = (d) => new Date(d + 'T00:00:00Z').getUTCDay() === 1;
    const minGap = dates.length > 1 ? Math.min(...dates.slice(1).map((d, i) => (new Date(d) - new Date(dates[i])) / DAY_MS)) : 0;
    grain = dates.every(isMonday) && (dates.length === 1 || minGap >= 7) ? 'weekly' : 'daily';
  }
  console.log(`Found ${dates.length} distinct dates (${dates[0]}..${dates[dates.length - 1]}) — importing as ${grain.toUpperCase()}${forcedGrain ? ' (forced)' : ''}.`);
  console.log(`Signup columns in file: ${presentGoals.join(', ')}${dryRun ? '   [DRY RUN — nothing will be written]' : ''}`);

  const db = getDb();
  const content = db.prepare('SELECT wp_id, url FROM content WHERE url IS NOT NULL').all();
  const urlToWpId = new Map();
  for (const c of content) {
    const norm = normalizeUrl(c.url);
    urlToWpId.set(norm, c.wp_id);
    urlToWpId.set(norm.endsWith('/') ? norm.slice(0, -1) : norm + '/', c.wp_id);
  }
  console.log(`Loaded ${content.length} content URLs for matching.`);

  // Which period rows to leave out, and why.
  let excludedWeek = null;     // weekly: the trailing partial week
  let todayCutoff = null;      // daily: today (and later) is not a finished day
  let coveredThrough = null;   // daily: last day already inside a stored weekly bucket
  if (grain === 'weekly') {
    excludedWeek = (!includeLastWeek && dates.length > 1) ? dates[dates.length - 1] : null;
    if (excludedWeek) console.log(`Excluding most recent week ${excludedWeek} — export cutoff falls mid-week, so this bucket under-counts. Pass --include-last-week to keep it.`);
  } else {
    todayCutoff = centralDate(0);
    const lastWeek = db.prepare('SELECT MAX(week_start) AS w FROM historical_newsletter_signups').get().w;
    if (lastWeek) {
      coveredThrough = addDays(lastWeek, 6);
      console.log(`Weekly history already covers through ${coveredThrough} — daily rows on or before that are skipped so nothing is counted twice.`);
    }
  }

  // Build the upsert for exactly the columns this file has, so a re-import of
  // an older-format file never zeroes a goal it doesn't mention.
  const table = grain === 'weekly' ? 'historical_newsletter_signups' : 'newsletter_signups_daily';
  const periodCol = grain === 'weekly' ? 'week_start' : 'date';
  const valueCols = [...presentGoals, ...(grain === 'weekly' && hasUsers ? ['unique_users'] : [])];
  const upsert = db.prepare(`
    INSERT INTO ${table} (wp_id, ${periodCol}, ${valueCols.join(', ')}${grain === 'weekly' ? ', imported_at' : ''})
    VALUES (@wp_id, @period, ${valueCols.map(c => '@' + c).join(', ')}${grain === 'weekly' ? ", datetime('now')" : ''})
    ON CONFLICT(wp_id, ${periodCol}) DO UPDATE SET
      ${valueCols.map(c => `${c} = excluded.${c}`).join(',\n      ')}${grain === 'weekly' ? ',\n      imported_at = excluded.imported_at' : ''}
  `);

  // Batch into small transactions (not one giant one) — keeps memory flat
  // while still being far faster than autocommit-per-row.
  const BATCH_SIZE = 500;
  let batch = [];
  const flush = db.transaction((rows) => { for (const r of rows) upsert.run(r); });

  const tally = { parsed: 0, matched: 0, unmatched: 0, skippedPeriod: 0, skippedCovered: 0, written: 0 };
  const matchedSignups = Object.fromEntries(presentGoals.map(g => [g, 0]));
  let unmatchedSignups = 0;
  const unmatchedUrls = new Map();
  let minDay = null, maxDay = null;

  // Pass 2: stream again, parse + filter + batch-upsert per line. Never
  // holds more than BATCH_SIZE rows or one raw line in memory.
  await streamRows(csvPath, (f, col) => {
    const url = f[col.url];
    if (!url) return;
    const period = dayOf(f[col.date]);
    if (!period) return;
    tally.parsed++;
    if (grain === 'weekly' && period === excludedWeek) { tally.skippedPeriod++; return; }
    if (grain === 'daily' && period >= todayCutoff) { tally.skippedPeriod++; return; }
    if (grain === 'daily' && coveredThrough && period <= coveredThrough) { tally.skippedCovered++; return; }

    const values = Object.fromEntries(presentGoals.map(g => [g, num(f, col, g)]));
    const wpId = urlToWpId.get(normalizeUrl(url));
    if (!wpId) {
      tally.unmatched++;
      const n = presentGoals.reduce((s, g) => s + values[g], 0);
      unmatchedSignups += n;
      if (n) unmatchedUrls.set(url, (unmatchedUrls.get(url) || 0) + n);
      return;
    }
    tally.matched++;
    for (const g of presentGoals) matchedSignups[g] += values[g];
    if (!minDay || period < minDay) minDay = period;
    if (!maxDay || period > maxDay) maxDay = period;

    const row = { wp_id: wpId, period, ...values };
    if (grain === 'weekly' && hasUsers) row.unique_users = num(f, col, 'uniqueUsers');
    batch.push(row);
    if (batch.length >= BATCH_SIZE) {
      if (!dryRun) flush(batch);
      tally.written += batch.length;
      batch = [];
    }
  });
  if (batch.length > 0) {
    if (!dryRun) flush(batch);
    tally.written += batch.length;
  }

  const skipped = [];
  if (tally.skippedPeriod) skipped.push(`${tally.skippedPeriod} in the excluded ${grain === 'weekly' ? 'week' : 'current day'}`);
  if (tally.skippedCovered) skipped.push(`${tally.skippedCovered} already covered by stored weekly history`);
  console.log(`\nParsed ${tally.parsed} rows${skipped.length ? ` (skipped: ${skipped.join('; ')})` : ''}.`);
  console.log(`Matched ${tally.matched} rows to known content (${tally.unmatched} unmatched — non-article pages, other hosts, or content not yet in our sync).`);
  console.log(`Signups in matched rows: ${presentGoals.map(g => `${g}=${matchedSignups[g]}`).join(', ')}  (total ${presentGoals.reduce((s, g) => s + matchedSignups[g], 0)})${minDay ? `  over ${minDay}..${maxDay}` : ''}`);
  if (unmatchedSignups) {
    console.log(`Signups in UNMATCHED rows (not imported): ${unmatchedSignups}`);
    for (const [u, n] of [...unmatchedUrls].sort((a, b) => b[1] - a[1]).slice(0, 5)) console.log(`   ${n}  ${u}`);
  }
  console.log(`${dryRun ? 'Would write' : 'Wrote'} ${tally.written} ${table} rows.`);
}

main().catch(err => {
  console.error('Import failed:', err);
  process.exit(1);
});
