import Anthropic from '@anthropic-ai/sdk';
import { getDb } from '../db.js';
import { truncate } from '../utils/stripHtml.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const VALID_NEEDS = [
  'update_me', 'educate_me', 'give_perspective', 'divert_me',
  'inspire_me', 'help_me', 'connect_me', 'keep_me_engaged',
];

const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 1000;

function buildPrompt(article) {
  return `You are an editorial analyst applying Dmitry Shishkin's User Needs Model 2.0 to classify journalism.

Classify the following article into the single most appropriate user need from this taxonomy:

* update_me: Breaking news, scores, what just happened
* educate_me: Explainers, deep dives, how things work, context
* give_perspective: Opinion, analysis, commentary, a distinct angle
* divert_me: Entertainment, fun reads, culture, things to do
* inspire_me: Profiles, aspirational content, best-of, success stories
* help_me: Service journalism, guides, recommendations, how-to
* connect_me: Community, local identity, belonging, civic content
* keep_me_engaged: Quizzes, puzzles, interactive, serialized/recurring formats

Also identify a secondary need if clearly applicable.

Respond ONLY with valid JSON in this exact format:
{"primary":"<need_id>","secondary":"<need_id_or_null>","confidence":<0.0-1.0>,"rationale":"<one sentence explaining why>"}

Article title: ${article.title}
Article content: ${truncate(article.content_text, 1500)}
Section: ${article.section || 'unknown'}`;
}

async function classifyBatch(articles) {
  const results = [];

  for (const article of articles) {
    try {
      const message = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 256,
        messages: [{ role: 'user', content: buildPrompt(article) }],
      });

      const text = message.content[0]?.text || '';
      // Extract JSON from response (handle possible markdown code fences)
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON in response');

      const parsed = JSON.parse(jsonMatch[0]);
      const primary = VALID_NEEDS.includes(parsed.primary) ? parsed.primary : null;
      const secondary = VALID_NEEDS.includes(parsed.secondary) ? parsed.secondary : null;
      const confidence = Math.min(1, Math.max(0, parseFloat(parsed.confidence) || 0));

      results.push({
        wp_id: article.wp_id,
        user_need: primary,
        user_need_secondary: secondary,
        user_need_confidence: confidence,
        user_need_rationale: String(parsed.rationale || '').slice(0, 500),
        classified_at: new Date().toISOString(),
        error: null,
      });
    } catch (err) {
      console.error(`[Classify] Error for wp_id ${article.wp_id}:`, err.message);
      results.push({
        wp_id: article.wp_id,
        user_need: null,
        user_need_secondary: null,
        user_need_confidence: null,
        user_need_rationale: null,
        classified_at: null,
        error: err.message,
      });
    }
  }

  return results;
}

export async function classifyUnclassified() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('[Classify] No ANTHROPIC_API_KEY — skipping classification');
    return { classified: 0, errors: 0 };
  }

  const db = getDb();

  // Find articles needing classification: no classified_at OR modified since last classification.
  // Microposts are often title-only quips with no body — Claude can still classify from the
  // title alone, so they're exempted from the non-empty content_text requirement (which exists
  // to skip regular articles whose content sync failed/hasn't run yet).
  const unclassified = db.prepare(`
    SELECT wp_id, title, content_text, section
    FROM content
    WHERE (classified_at IS NULL OR modified_at > classified_at)
      AND title IS NOT NULL AND title != ''
      AND (content_type = 'micropost' OR (content_text IS NOT NULL AND content_text != ''))
    ORDER BY published_at DESC
    LIMIT 100
  `).all();

  if (unclassified.length === 0) {
    console.log('[Classify] No unclassified articles');
    return { classified: 0, errors: 0 };
  }

  console.log(`[Classify] Classifying ${unclassified.length} articles in batches of ${BATCH_SIZE}`);

  const update = db.prepare(`
    UPDATE content SET
      user_need = @user_need,
      user_need_secondary = @user_need_secondary,
      user_need_confidence = @user_need_confidence,
      user_need_rationale = @user_need_rationale,
      classified_at = @classified_at,
      updated_at = datetime('now')
    WHERE wp_id = @wp_id
  `);

  let classified = 0;
  let errors = 0;

  for (let i = 0; i < unclassified.length; i += BATCH_SIZE) {
    const batch = unclassified.slice(i, i + BATCH_SIZE);
    const results = await classifyBatch(batch);

    db.transaction(() => {
      for (const r of results) {
        if (!r.error) {
          update.run(r);
          classified++;
        } else {
          errors++;
        }
      }
    })();

    const progress = Math.min(i + BATCH_SIZE, unclassified.length);
    console.log(`[Classify] Progress: ${progress}/${unclassified.length}`);

    if (i + BATCH_SIZE < unclassified.length) {
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  console.log(`[Classify] Done. Classified: ${classified}, Errors: ${errors}`);
  return { classified, errors };
}

export async function classifySingle(wpId) {
  const db = getDb();
  const article = db.prepare(
    'SELECT wp_id, title, content_text, section FROM content WHERE wp_id = ?'
  ).get(wpId);

  if (!article) throw new Error(`Article ${wpId} not found`);

  const [result] = await classifyBatch([article]);
  if (result.error) throw new Error(result.error);

  db.prepare(`
    UPDATE content SET
      user_need = @user_need,
      user_need_secondary = @user_need_secondary,
      user_need_confidence = @user_need_confidence,
      user_need_rationale = @user_need_rationale,
      classified_at = @classified_at,
      updated_at = datetime('now')
    WHERE wp_id = @wp_id
  `).run(result);

  return result;
}
