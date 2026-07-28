// One-off backfill: classify existing content into Google's Natural Language
// content-categories taxonomy. NOT run automatically — the daily cron only
// classifies new/edited content going forward (see server/sync/nlp.js), on
// purpose, because classifyText is billed per request beyond a small free
// tier and this repo has thousands of existing articles. Run this manually,
// in controlled chunks, once you've confirmed the cost is acceptable.
//
// Usage:
//   node --env-file=.env server/scripts/backfill-nlp-categories.mjs [--limit N]
//
// Each run processes up to --limit articles (default 200) that don't have a
// category yet, then stops — rerun to continue where it left off.
import { getDb } from '../db.js';
import { classifyCategoriesUnclassified, nlpConfigured } from '../sync/nlp.js';

const limitArg = process.argv.find(a => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 200;

if (!nlpConfigured()) {
  console.error('No Natural Language API credentials configured (NLP_KEY_FILE / NLP_SERVICE_ACCOUNT_JSON / GA4_KEY_FILE / GA4_SERVICE_ACCOUNT_JSON). See DEPLOY.md.');
  process.exit(1);
}

const db = getDb();
const remaining = db.prepare(`
  SELECT COUNT(*) AS n FROM content
  WHERE nlp_classified_at IS NULL
    AND title IS NOT NULL AND title != ''
    AND (content_type = 'micropost' OR (content_text IS NOT NULL AND content_text != ''))
`).get().n;

console.log(`${remaining} articles have no content category yet. Processing up to ${limit} this run (NLP_BATCH_SIZE overrides the per-run batch if set lower).`);
console.log('Each classifyText call is billed beyond Google\'s free tier — stop with Ctrl+C at any point; progress already made is saved.');

// classifyCategoriesUnclassified() processes one internal batch (NLP_BATCH_SIZE,
// default 20) per call — loop it here up to --limit so this script controls
// the total for one run without needing to touch the cron-facing batch size.
let done = 0;
while (done < limit) {
  const { classified, errors } = await classifyCategoriesUnclassified();
  if (classified === 0 && errors === 0) break; // nothing left to do
  done += classified + errors;
  console.log(`Progress: ${done}/${limit} this run`);
}

console.log(`Backfill run complete. Processed ${done} articles this run.`);
