// Import a Shopify CSV — the Analytics report "Net items sold by day" (Day, Product
// title, Net items sold; preferred, already net of refunds) or an Orders export
// (Orders → Export) — to fill in single-issue sales from before the live
// sync's 60-day reach (see server/sync/shopify.js). Safe to re-run: it replaces
// its own earlier rows each time. The same import is available to admins in the
// app (Settings → Import Shopify sales history), which needs no shell.
//
// Usage: node server/scripts/import-shopify-orders-csv.mjs <path-to-csv> [--dry-run]
import fs from 'fs';
import { getDb } from '../db.js';
import { importShopifyHistory } from '../sync/shopifyCsv.js';

const args = process.argv.slice(2);
const csvPath = args.find(a => !a.startsWith('--'));
const dryRun = args.includes('--dry-run');
if (!csvPath) {
  console.error('Usage: node server/scripts/import-shopify-orders-csv.mjs <path-to-csv> [--dry-run]');
  process.exit(1);
}

const r = importShopifyHistory(getDb(), fs.readFileSync(csvPath, 'utf8'), { dryRun });
if (!r.liveSyncSeen) console.log(`No live Shopify sales saved yet — importing up to ${r.before} (run the Shopify sync first to be exact).`);
console.log(`${r.orders == null ? '' : r.orders + ' orders, '}${r.units} units across ${r.products.length} products, ${r.from} to before ${r.before} (${r.skipped} rows skipped: cancelled, refunded, or outside that range)`);
for (const p of r.products) console.log(`  ${String(p.units).padStart(5)}  ${p.title}  →  ${p.issue || '(not an issue — no score)'}`);
console.log(dryRun ? 'Dry run — nothing written.' : `Saved ${r.rows} product-day rows.`);
