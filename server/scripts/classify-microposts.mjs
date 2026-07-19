// One-off: classify every FrontBurner micropost that's missing a user_need,
// including title-only posts with no content_text (classifyUnclassified's
// bulk query now allows these through, but this targets them directly rather
// than depending on the LIMIT 100 / published_at ordering of the general
// backlog, which could otherwise be crowded out by other unclassified content).
import { getDb } from '../db.js';
import { classifySingle } from '../classify/userNeeds.js';

const db = getDb();
const rows = db.prepare(`
  SELECT wp_id, title FROM content
  WHERE content_type = 'micropost' AND user_need IS NULL
    AND title IS NOT NULL AND title != ''
  ORDER BY published_at DESC
`).all();

console.log(`Found ${rows.length} unclassified microposts`);

let classified = 0, errors = 0;
for (const row of rows) {
  try {
    const result = await classifySingle(row.wp_id);
    classified++;
    console.log(`[${classified}/${rows.length}] ${row.wp_id} "${row.title}" -> ${result.user_need}`);
  } catch (err) {
    errors++;
    console.error(`Error classifying ${row.wp_id} "${row.title}":`, err.message);
  }
  await new Promise(r => setTimeout(r, 300));
}

console.log(`Done. Classified: ${classified}, Errors: ${errors}`);
process.exit(0);
