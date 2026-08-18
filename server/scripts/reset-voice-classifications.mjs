// One-off: clears voice_classified_at for every already-classified article so
// backfill-voices.mjs (or the daily cron) picks them up again and reclassifies
// them under the fixed prompt (see classify/voice.js — the old prompt's
// "usually 1-4" wording was anchoring the model to ~4 tags regardless of fit).
//
// Deliberately does NOT delete the existing content_voices rows up front —
// each article's old tags stay visible (slightly over-padded, but not wrong
// in a confusing "suddenly empty" way) until its own reclassification runs
// and replaces them, which storeVoicesFor() already does per-article.
//
// This does NOT reclassify anything by itself — it only resets the "already
// done" marker. Run backfill-voices.mjs afterward (in chunks, same
// cost-conscious convention as every other backfill script here) to actually
// redo the classification:
//   node --env-file=.env server/scripts/reset-voice-classifications.mjs
//   node --env-file=.env server/scripts/backfill-voices.mjs --limit=200
import { getDb } from '../db.js';

const db = getDb();

const { n } = db.prepare("SELECT COUNT(*) AS n FROM content WHERE voice_classified_at IS NOT NULL").get();

if (n === 0) {
  console.log('No previously classified articles found — nothing to reset.');
  process.exit(0);
}

console.log(`Resetting voice_classified_at for ${n} already-classified articles...`);
db.prepare("UPDATE content SET voice_classified_at = NULL WHERE voice_classified_at IS NOT NULL").run();
console.log(`Done. Run backfill-voices.mjs to reclassify them under the fixed prompt.`);
