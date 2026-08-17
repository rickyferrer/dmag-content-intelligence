// Editorial "Voice" classification — requested by the VP of Audience
// Development to capture the tone/register of a piece, independent of its
// User Need (what it does for the reader) or topic (what it's about). Uses
// Claude the same way classify/userNeeds.js does, but returns a SET of
// applicable voices per article rather than a single primary/secondary,
// since these traits genuinely co-occur (a FrontBurner post can be both
// Snarky and Insider at once). Storage mirrors sync/nlp.js's
// content_categories table for the same reason: one row per (article,
// voice), not columns on content itself.
import Anthropic from '@anthropic-ai/sdk';
import { getDb } from '../db.js';
import { truncate } from '../utils/stripHtml.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// key -> { label, description, examples } — the label/description feed the
// classification prompt; the frontend imports VOICE_META (mirrors
// NEED_META's shape) for display.
export const VOICE_TAXONOMY = {
  curious:       { label: 'Curious',       description: "Explores something readers didn't know.", examples: 'Hidden Dallas; why a neighborhood is changing; the history behind a local landmark' },
  intelligent:   { label: 'Intelligent',   description: 'Requires thought.', examples: 'Business analysis; politics; long-form features; healthcare investigations' },
  witty:         { label: 'Witty',         description: 'Clever writing.', examples: 'Restaurant reviews; city observations; pop culture' },
  quirky:        { label: 'Quirky',        description: 'Unexpected.', examples: 'Oddball Dallas personalities; weird local traditions; offbeat history; "Only in Dallas"' },
  opinionated:   { label: 'Opinionated',   description: 'Makes a clear argument.', examples: 'Editorials; reviews; recommendations; "Forget the Alamo."' },
  sophisticated: { label: 'Sophisticated', description: 'Elevated. Very D Home.', examples: 'Architecture; interior design; luxury travel; fine dining' },
  approachable:  { label: 'Approachable',  description: 'Easy to understand.', examples: 'Service journalism; best-of lists; how-to articles' },
  authentic:     { label: 'Authentic',     description: 'Feels deeply local rather than SEO-driven.', examples: 'Neighborhood voices; local business owners; Dallas history' },
  fearless:      { label: 'Fearless',      description: 'Not afraid to criticize.', examples: 'Investigations; political coverage; beloved institutions performing poorly' },
  celebratory:   { label: 'Celebratory',   description: 'Recognizes excellence.', examples: 'Best Doctors; Dallas 500; Top Realtors; weddings' },
  insider:       { label: 'Insider',       description: 'Makes the reader feel "in the know." Very D Magazine.', examples: 'Restaurant openings; development rumors; business moves; society news' },
  aspirational:  { label: 'Aspirational',  description: 'Makes readers imagine a better lifestyle. Very D Home and D CEO.', examples: 'Luxury living; professional success stories' },
  practical:     { label: 'Practical',     description: 'Leaves readers able to do something.', examples: 'Guides; recommendations; buying advice' },
  snarky:        { label: 'Snarky',        description: 'Sharp, irreverent commentary that uses sarcasm, wit, or playful criticism to make a point — distinct from Witty, which is clever and amusing but has no target.', examples: 'FrontBurner commentary; restaurant/entertainment criticism; calling out something ridiculous or overhyped' },
};

const VALID_VOICES = Object.keys(VOICE_TAXONOMY);

const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 1000;
// Deliberately small per-cron-run limit — same "don't silently backfill an
// existing 7000+ article library" reasoning as sync/nlp.js. New/edited
// content gets classified automatically; the existing backlog is a
// conscious, manually-run decision (see server/scripts/backfill-voices.mjs).
const CRON_LIMIT = 50;

function buildPrompt(article) {
  const taxonomyLines = VALID_VOICES
    .map(key => `* ${key}: ${VOICE_TAXONOMY[key].description} (e.g. ${VOICE_TAXONOMY[key].examples})`)
    .join('\n');

  return `You are an editorial analyst for a city magazine, classifying the VOICE of an article — its tone and register, independent of its topic or what need it serves the reader.

Identify every voice from this taxonomy that clearly applies (usually 1-4; don't force a fit):

${taxonomyLines}

Respond ONLY with valid JSON in this exact format:
{"voices":[{"voice":"<voice_id>","confidence":<0.0-1.0>}, ...],"rationale":"<one sentence explaining the mix>"}

Article title: ${article.title}
Article content: ${truncate(article.content_text, 1500)}
Section: ${article.section || 'unknown'}`;
}

async function classifyVoiceBatch(articles) {
  const results = [];

  for (const article of articles) {
    try {
      const message = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 400,
        messages: [{ role: 'user', content: buildPrompt(article) }],
      });

      const text = message.content[0]?.text || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON in response');

      const parsed = JSON.parse(jsonMatch[0]);
      const voices = (Array.isArray(parsed.voices) ? parsed.voices : [])
        .filter(v => VALID_VOICES.includes(v.voice))
        .map(v => ({ voice: v.voice, confidence: Math.min(1, Math.max(0, parseFloat(v.confidence) || 0)) }));

      results.push({
        wp_id: article.wp_id,
        voices,
        rationale: String(parsed.rationale || '').slice(0, 500),
        classified_at: new Date().toISOString(),
        error: null,
      });
    } catch (err) {
      console.error(`[Voice] Error for wp_id ${article.wp_id}:`, err.message);
      results.push({ wp_id: article.wp_id, voices: [], rationale: null, classified_at: null, error: err.message });
    }
  }

  return results;
}

function storeVoicesFor(db, wpId, voices, classifiedAt) {
  db.transaction(() => {
    db.prepare('DELETE FROM content_voices WHERE wp_id = ?').run(wpId);
    const ins = db.prepare('INSERT INTO content_voices (wp_id, voice, confidence, snapshot_at) VALUES (?, ?, ?, ?)');
    for (const v of voices) ins.run(wpId, v.voice, v.confidence, classifiedAt);
    db.prepare('UPDATE content SET voice_classified_at = ? WHERE wp_id = ?').run(classifiedAt, wpId);
  })();
}

export async function classifyVoicesUnclassified() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('[Voice] No ANTHROPIC_API_KEY — skipping voice classification');
    return { classified: 0, errors: 0 };
  }

  const db = getDb();

  const unclassified = db.prepare(`
    SELECT wp_id, title, content_text, section
    FROM content
    WHERE (voice_classified_at IS NULL OR modified_at > voice_classified_at)
      AND title IS NOT NULL AND title != ''
      AND (content_type = 'micropost' OR (content_text IS NOT NULL AND content_text != ''))
    ORDER BY published_at DESC
    LIMIT ?
  `).all(CRON_LIMIT);

  if (unclassified.length === 0) {
    console.log('[Voice] No unclassified articles');
    return { classified: 0, errors: 0 };
  }

  console.log(`[Voice] Classifying ${unclassified.length} articles in batches of ${BATCH_SIZE}`);

  let classified = 0;
  let errors = 0;

  for (let i = 0; i < unclassified.length; i += BATCH_SIZE) {
    const batch = unclassified.slice(i, i + BATCH_SIZE);
    const results = await classifyVoiceBatch(batch);

    for (const r of results) {
      if (!r.error) {
        storeVoicesFor(db, r.wp_id, r.voices, r.classified_at);
        classified++;
      } else {
        errors++;
      }
    }

    const progress = Math.min(i + BATCH_SIZE, unclassified.length);
    console.log(`[Voice] Progress: ${progress}/${unclassified.length}`);

    if (i + BATCH_SIZE < unclassified.length) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  console.log(`[Voice] Done. Classified: ${classified}, Errors: ${errors}`);
  return { classified, errors };
}

// Classifies (or reclassifies) a single article on demand — mirrors
// classifySingle() in classify/userNeeds.js / classifyCategoriesSingle() in
// sync/nlp.js.
export async function classifyVoiceSingle(wpId) {
  const db = getDb();
  const article = db.prepare(
    'SELECT wp_id, title, content_text, section FROM content WHERE wp_id = ?'
  ).get(wpId);

  if (!article) throw new Error(`Article ${wpId} not found`);

  const [result] = await classifyVoiceBatch([article]);
  if (result.error) throw new Error(result.error);

  storeVoicesFor(db, wpId, result.voices, result.classified_at);

  return { wp_id: wpId, voices: result.voices, rationale: result.rationale };
}
