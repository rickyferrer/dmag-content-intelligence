// One-off: decode HTML entities and strip inline tags (e.g. <i>...</i>) from
// already-stored article titles. Going forward, server/sync/wordpress.js
// applies stripHtml() to titles at sync time, so this only needs to run once
// to clean up rows synced before that fix.
import { getDb } from '../db.js';
import { stripHtml } from '../utils/stripHtml.js';

const db = getDb();
const rows = db.prepare("SELECT wp_id, title FROM content WHERE title LIKE '%&#%' OR title LIKE '%<%' OR title LIKE '%&amp;%' OR title LIKE '%&quot;%'").all();

console.log(`Found ${rows.length} titles to clean`);

const update = db.prepare('UPDATE content SET title = ? WHERE wp_id = ?');
let changed = 0;

db.transaction(() => {
  for (const row of rows) {
    const clean = stripHtml(row.title);
    if (clean !== row.title) {
      update.run(clean, row.wp_id);
      changed++;
    }
  }
})();

console.log(`Updated ${changed} titles`);
process.exit(0);
