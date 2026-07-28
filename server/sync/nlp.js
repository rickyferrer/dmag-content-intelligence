// Google Cloud Natural Language content-category classification
// (https://docs.cloud.google.com/natural-language/docs/categories) — the
// same ~700-leaf taxonomy Google's own ad products use for contextual
// targeting. Reuses the GA4 service account by default (same GCP project,
// just needs the Natural Language API enabled on it) since standing up a
// second credential for this alone would be unnecessary — set NLP_KEY_FILE
// / NLP_SERVICE_ACCOUNT_JSON to point at a different one instead.
//
// Cost note: classifyText is billed per request beyond a small free tier.
// The batch size here is deliberately small and only processes NEW/changed
// content on the daily cron — backfilling the existing library is a
// separate, manually-run script (server/scripts/backfill-nlp-categories.mjs)
// so that cost is a conscious decision, not something that happens silently
// on first deploy.
import { getDb } from '../db.js';
import { truncate } from '../utils/stripHtml.js';

const KEY_FILE = process.env.NLP_KEY_FILE || process.env.GA4_KEY_FILE || './credentials/ga4-service-account.json';
const BATCH_SIZE = parseInt(process.env.NLP_BATCH_SIZE || '20', 10);
const BATCH_DELAY_MS = 500;
const MIN_CONFIDENCE = 0.5; // Google's own suggested threshold for a usable category match

export function nlpConfigured() {
  return !!(process.env.NLP_SERVICE_ACCOUNT_JSON || process.env.GA4_SERVICE_ACCOUNT_JSON || process.env.NLP_KEY_FILE || process.env.GA4_KEY_FILE);
}

async function nlpToken() {
  const { GoogleAuth } = await import('google-auth-library');
  let authConfig;
  const jsonEnv = process.env.NLP_SERVICE_ACCOUNT_JSON || process.env.GA4_SERVICE_ACCOUNT_JSON;
  if (jsonEnv) {
    const credentials = JSON.parse(Buffer.from(jsonEnv, 'base64').toString('utf8'));
    authConfig = { credentials, scopes: ['https://www.googleapis.com/auth/cloud-language'] };
  } else {
    authConfig = { keyFile: KEY_FILE, scopes: ['https://www.googleapis.com/auth/cloud-language'] };
  }
  const auth = new GoogleAuth(authConfig);
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  return token;
}

// Classifies raw text into Google's content-categories taxonomy. Returns
// [{ category, confidence }] sorted highest-confidence first — [] if the
// text is too short/sparse for the API to return a category at all (common
// for title-only microposts).
export async function classifyContentCategories(text) {
  const content = truncate(text, 4000); // classifyText needs ~20+ words; this is well within its per-request limits
  if (!content || content.trim().split(/\s+/).length < 15) return [];

  const token = await nlpToken();
  const res = await fetch('https://language.googleapis.com/v2/documents:classifyText', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ document: { type: 'PLAIN_TEXT', content } }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Natural Language API error (${res.status}): ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  return (data.categories || [])
    .map(c => ({ category: c.name, confidence: c.confidence }))
    .filter(c => c.confidence >= MIN_CONFIDENCE)
    .sort((a, b) => b.confidence - a.confidence);
}

function storeCategoriesFor(db, wpId, categories) {
  const ts = new Date().toISOString();
  db.transaction(() => {
    db.prepare('DELETE FROM content_categories WHERE wp_id = ?').run(wpId);
    const ins = db.prepare('INSERT INTO content_categories (wp_id, category, confidence, snapshot_at) VALUES (?, ?, ?, ?)');
    for (const c of categories) ins.run(wpId, c.category, c.confidence, ts);
    db.prepare("UPDATE content SET nlp_classified_at = ? WHERE wp_id = ?").run(ts, wpId);
  })();
}

// Classifies (or reclassifies) a single article on demand — mirrors
// classifySingle() in classify/userNeeds.js.
export async function classifyCategoriesSingle(wpId) {
  const db = getDb();
  const article = db.prepare('SELECT wp_id, title, content_text FROM content WHERE wp_id = ?').get(wpId);
  if (!article) throw new Error('Article not found');

  const text = [article.title, article.content_text].filter(Boolean).join('\n\n');
  const categories = await classifyContentCategories(text);
  storeCategoriesFor(db, wpId, categories);
  return { wp_id: wpId, categories };
}

// Batch job for the daily cron — only articles never classified (or edited
// since their last classification), same LIMIT/backoff shape as
// classifyUnclassified() but a much smaller batch given per-request cost.
export async function classifyCategoriesUnclassified() {
  if (!nlpConfigured()) {
    console.log('[NLP] No Natural Language API credentials configured — skipping category classification');
    return { classified: 0, errors: 0 };
  }

  const db = getDb();
  const unclassified = db.prepare(`
    SELECT wp_id, title, content_text
    FROM content
    WHERE (nlp_classified_at IS NULL OR modified_at > nlp_classified_at)
      AND title IS NOT NULL AND title != ''
      AND (content_type = 'micropost' OR (content_text IS NOT NULL AND content_text != ''))
    ORDER BY published_at DESC
    LIMIT ?
  `).all(BATCH_SIZE);

  if (unclassified.length === 0) {
    console.log('[NLP] No unclassified content');
    return { classified: 0, errors: 0 };
  }

  console.log(`[NLP] Classifying ${unclassified.length} articles into content categories`);
  let classified = 0, errors = 0;

  for (const article of unclassified) {
    try {
      const text = [article.title, article.content_text].filter(Boolean).join('\n\n');
      const categories = await classifyContentCategories(text);
      storeCategoriesFor(db, article.wp_id, categories);
      classified++;
    } catch (err) {
      console.error(`[NLP] Error for wp_id ${article.wp_id}:`, err.message);
      errors++;
    }
    await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
  }

  console.log(`[NLP] Done. Classified: ${classified}, Errors: ${errors}`);
  return { classified, errors };
}
