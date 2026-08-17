// One-off backfill: classify existing content into the editorial Voice
// taxonomy (see server/classify/voice.js). NOT run automatically — the
// daily cron only classifies new/edited content going forward, on purpose,
// because each classification is a billed Claude call and this repo has
// thousands of existing articles. Run this manually, in controlled chunks,
// once you've confirmed the cost is acceptable.
//
// Usage:
//   node --env-file=.env server/scripts/backfill-voices.mjs [--limit N]
//
// Each run processes up to --limit articles (default 200) that don't have a
// voice yet, then stops — rerun to continue where it left off.
import { getDb } from '../db.js';
import { classifyVoicesUnclassified } from '../classify/voice.js';

const limitArg = process.argv.find(a => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 200;

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('No ANTHROPIC_API_KEY configured.');
  process.exit(1);
}

const db = getDb();
const remaining = db.prepare(`
  SELECT COUNT(*) AS n FROM content
  WHERE voice_classified_at IS NULL
    AND title IS NOT NULL AND title != ''
    AND (content_type = 'micropost' OR (content_text IS NOT NULL AND content_text != ''))
`).get().n;

console.log(`${remaining} articles have no voice tags yet. Processing up to ${limit} this run.`);
console.log('Each classification is a billed Claude call — stop with Ctrl+C at any point; progress already made is saved.');

// classifyVoicesUnclassified() processes one internal batch (50 articles)
// per call — loop it here up to --limit so this script controls the total
// for one run without needing to touch the cron-facing batch size.
let done = 0;
while (done < limit) {
  const { classified, errors } = await classifyVoicesUnclassified();
  if (classified === 0 && errors === 0) break; // nothing left to do
  done += classified + errors;
  console.log(`Progress: ${done}/${limit} this run`);
}

console.log(`Backfill run complete. Processed ${done} articles this run.`);
