// Single-issue sales from the magazine's Shopify store — units sold per
// product per day, saved to shopify_sales_daily and rolled up per issue by
// routes/analytics.js's /by-issue (see utils/issueSales.js for the scoring).
//
// Needs a custom app on the store (Settings → Apps → Develop apps) with the
// Admin API scopes read_orders and read_products. Env: SHOPIFY_STORE (the
// *.myshopify.com domain) and SHOPIFY_ADMIN_TOKEN.
//
// Without the read_all_orders scope (not available to this store's custom app)
// Shopify only returns the past 60 days of orders. So each run re-reads the
// last ~55 days and replaces just those days; everything older is kept as
// saved by earlier runs. Re-reading (not adding) is what makes recent refunds,
// cancellations and edits correct and heals a missed run. History from before
// the first run isn't in here and has to be backfilled separately.
import { DATA_START } from '../utils/dataStart.js';

const API_VERSION = '2025-07';
const PAGE_SIZE = 100;
const LOOKBACK_DAYS = 55; // inside Shopify's 60-day limit, with slack
const DAY_MS = 86400000;

// First day a sync re-reads (and replaces): LOOKBACK_DAYS back, but never before DATA_START.
export function lookbackStart(today = new Date().toISOString().slice(0, 10)) {
  const back = new Date(Date.parse(today) - LOOKBACK_DAYS * DAY_MS).toISOString().slice(0, 10);
  return back > DATA_START ? back : DATA_START;
}

export function shopifyConfigured() {
  return !!(process.env.SHOPIFY_STORE && process.env.SHOPIFY_ADMIN_TOKEN);
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const SEASONS = ['spring', 'summer', 'fall', 'winter'];

// Product title → "{pub}/{year}/{period}" (the same shape as /by-issue's key and
// content.publication_override), or null when it doesn't look like a single
// issue. The period is the issue's slug on the site: a month ("october"), two
// ("june-july"), or a season ("fall", "fall-winter"), as in
// /publications/d-home/2026/fall/. A single issue is a title naming a
// publication's period and a year; subscriptions, memberships and one-off
// specials ("Dallas 500") don't fit and stay unmapped. Anything this gets wrong
// can be fixed per product with PUT /api/analytics/shopify-products/:id
// (stored in shopify_product_map).
const PUBLICATIONS = [
  ['d-ceo', /\bd\s*ceo\b/i],
  ['d-home', /\bd\s*home\b/i],
  ['d-weddings', /\bd\s*weddings?\b/i],
  ['d-magazine', /\bd\s*magazine\b/i],
];
const TOKEN = `(?:${[...MONTHS, ...SEASONS].join('|')})`;
const PERIOD = new RegExp(`^${TOKEN}(?:[\\s/&-]+${TOKEN})*$`);

// Annual specials the site files by name, not month — the site's slugs carry
// the year too ("medical-guide-2025", "dallas-500-2025"), which the by-issue
// match tolerates (see /by-issue), so the slug here is just the name.
const SPECIALS = [
  [/\bmedical guide\b/i, 'd-magazine', 'medical-guide'],
  [/\bdallas 500\b/i, 'd-ceo', 'dallas-500'],
];

export function parseIssueFromTitle(title) {
  if (!title) return null;
  const year = title.match(/\b(20\d{2})\b/);
  if (!year) return null;
  const special = SPECIALS.find(([re]) => re.test(title));
  if (special) return `${special[1]}/${year[1]}/${special[2]}`;
  const pub = PUBLICATIONS.find(([, re]) => re.test(title));
  let period = title.slice(0, year.index);
  if (pub) period = period.replace(pub[1], ' ');
  period = period.toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, '');
  if (!PERIOD.test(period)) return null;
  return `${pub ? pub[0] : 'd-magazine'}/${year[1]}/${period.split(/[^a-z]+/).join('-')}`;
}

async function shopifyQuery(query, variables) {
  const url = `https://${process.env.SHOPIFY_STORE}/admin/api/${API_VERSION}/graphql.json`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_TOKEN },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 429) { await new Promise(r => setTimeout(r, 2000 * (attempt + 1))); continue; }
    if (!res.ok) throw new Error(`Shopify HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = await res.json();
    const throttled = body.errors?.some(e => e.extensions?.code === 'THROTTLED');
    if (throttled) { await new Promise(r => setTimeout(r, 2000 * (attempt + 1))); continue; }
    if (body.errors?.length) throw new Error(`Shopify: ${body.errors.map(e => e.message).join('; ')}`);
    return body.data;
  }
  throw new Error('Shopify: still throttled after retries');
}

const ORDERS_QUERY = `
  query Orders($first: Int!, $after: String, $query: String) {
    orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes {
        createdAt
        cancelledAt
        test
        lineItems(first: 100) {
          nodes {
            title
            currentQuantity
            discountedTotalSet { shopMoney { amount } }
            product { id title }
          }
        }
      }
    }
  }
`;

// → Map keyed `${productId}|${date}` of { product_id, product_title, date, units, revenue }.
// currentQuantity is the quantity after refunds and edits, so a fully refunded
// line counts 0. Cancelled and test orders are skipped. Revenue is the line's
// discounted total, and isn't net of refunds (units are what the score uses).
export async function fetchShopifySales(sinceDate = lookbackStart()) {
  const sales = new Map();
  let after = null;
  for (;;) {
    const data = await shopifyQuery(ORDERS_QUERY, { first: PAGE_SIZE, after, query: `created_at:>=${sinceDate}` });
    for (const order of data.orders.nodes) {
      if (order.cancelledAt || order.test) continue;
      const date = order.createdAt.slice(0, 10);
      for (const li of order.lineItems.nodes) {
        if (!li.product?.id || !li.currentQuantity) continue; // deleted product, or fully refunded
        const key = `${li.product.id}|${date}`;
        const row = sales.get(key) || { product_id: li.product.id, product_title: li.product.title || li.title, date, units: 0, revenue: 0 };
        row.units += li.currentQuantity;
        row.revenue += parseFloat(li.discountedTotalSet?.shopMoney?.amount || 0);
        sales.set(key, row);
      }
    }
    if (!data.orders.pageInfo.hasNextPage) break;
    after = data.orders.pageInfo.endCursor;
  }
  return sales;
}

// Replaces the days from `since` on and leaves earlier days alone.
export function saveShopifySales(db, sales, since = lookbackStart()) {
  const insert = db.prepare(`
    INSERT INTO shopify_sales_daily (product_id, date, product_title, units, revenue)
    VALUES (@product_id, @date, @product_title, @units, @revenue)
  `);
  db.transaction(() => {
    db.prepare('DELETE FROM shopify_sales_daily WHERE date >= ?').run(since);
    for (const row of sales.values()) insert.run(row);
  })();
  return sales.size;
}

export async function syncShopifySales(db) {
  const since = lookbackStart();
  const sales = await fetchShopifySales(since);
  const rows = saveShopifySales(db, sales, since);
  const units = [...sales.values()].reduce((n, r) => n + r.units, 0);
  return { since, rows, units, products: new Set([...sales.values()].map(r => r.product_id)).size };
}
