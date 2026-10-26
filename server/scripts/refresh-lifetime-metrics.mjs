// Run the lifetime GA4 pass on its own and rescore — without a full analytics
// sync (which also hits Marfeel, Search Console and more, and writes nothing
// if interrupted). Use it right after deploying lifetime scoring so lifetime
// values don't wait for the next 6 am sync, or to refresh them on demand.
// Safe to re-run: the counts only ever move up (see sync/lifetimeMetrics.js).
//
// Usage: node server/scripts/refresh-lifetime-metrics.mjs [--dry-run]
//   --dry-run  fetch from GA4 and report, write and rescore nothing
// Needs the GA4 credentials in the environment, like the regular sync.
import { getDb } from '../db.js';
import { syncGA4Lifetime, LIFETIME_FLOOR } from '../sync/ga4.js';
import { saveLifetimeMetrics } from '../sync/lifetimeMetrics.js';
import { scoreContent } from '../sync/scheduler.js';

const dryRun = process.argv.includes('--dry-run');

console.log(`Fetching lifetime GA4 totals since ${LIFETIME_FLOOR}${dryRun ? '   [DRY RUN — nothing will be written]' : ''}...`);
const lifetime = await syncGA4Lifetime();
let users = 0, loyal = 0;
for (const m of lifetime.values()) { users += m.users; loyal += m.loyal_users; }
console.log(`GA4 returned lifetime totals for ${lifetime.size} articles (${users.toLocaleString()} reader-totals, ${loyal.toLocaleString()} loyal).`);

if (!dryRun) {
  const db = getDb();
  saveLifetimeMetrics(db, lifetime);
  console.log('Saved to lifetime_metrics. Rescoring...');
  scoreContent(db);
  console.log('Done — reload the dashboard.');
}
