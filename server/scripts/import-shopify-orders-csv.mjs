// Import a Shopify Orders export (Shopify admin → Orders → Export → all orders,
// CSV for Excel/plain) to fill in single-issue sales from before the live
// sync's 60-day reach (see server/sync/shopify.js). Safe to re-run: it replaces
// its own earlier rows each time.
//
// Usage: node server/scripts/import-shopify-orders-csv.mjs <path-to-csv> [--dry-run]
//
// Only days from DATA_START up to (not including) the earliest day the live
// sync has saved are imported, so nothing is counted twice; with no live data
// yet, up to the start of the live sync's lookback. Run it where the database
// lives (the Render shell), after the first Shopify sync.
import fs from 'fs';
import { getDb } from '../db.js';
import { DATA_START } from '../utils/dataStart.js';
import { lookbackStart } from '../sync/shopify.js';
import { salesFromOrdersCsv, saveCsvSales } from '../sync/shopifyCsv.js';

const args = process.argv.slice(2);
const csvPath = args.find(a => !a.startsWith('--'));
const dryRun = args.includes('--dry-run');
if (!csvPath) {
  console.error('Usage: node server/scripts/import-shopify-orders-csv.mjs <path-to-csv> [--dry-run]');
  process.exit(1);
}

const db = getDb();
const firstLive = db.prepare("SELECT MIN(date) AS d FROM shopify_sales_daily WHERE product_id NOT LIKE 'csv:%'").get().d;
const before = firstLive || lookbackStart();
if (!firstLive) console.log(`No live Shopify sales saved yet — importing up to ${before} (run the Shopify sync first to be exact).`);

const { sales, orders, skipped } = salesFromOrdersCsv(fs.readFileSync(csvPath, 'utf8'), { from: DATA_START, before });
const units = [...sales.values()].reduce((n, r) => n + r.units, 0);
const products = new Set([...sales.values()].map(r => r.product_id));
console.log(`${orders} orders, ${units} units across ${products.size} products, ${DATA_START} to before ${before} (${skipped} line items skipped: cancelled, refunded, or outside that range)`);
for (const id of [...products].sort()) {
  const u = [...sales.values()].filter(r => r.product_id === id).reduce((n, r) => n + r.units, 0);
  console.log(`  ${String(u).padStart(5)}  ${id.slice(4)}`);
}

if (dryRun) { console.log('Dry run — nothing written.'); process.exit(0); }
saveCsvSales(db, sales);
db.prepare("INSERT INTO sync_state (key, value, updated_at) VALUES ('last_shopify_csv_import', ?, datetime('now')) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").run(new Date().toISOString());
console.log(`Saved ${sales.size} product-day rows.`);
