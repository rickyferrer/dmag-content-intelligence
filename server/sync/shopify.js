// Single-issue sales from the magazine's Shopify store — units sold per
// product per day, saved to shopify_sales_daily and rolled up per issue by
// routes/analytics.js's /by-issue (see utils/issueSales.js for the scoring).
//
// Needs a custom app on the store (Settings → Apps → Develop apps) with the
// Admin API scopes read_orders and read_products, plus read_all_orders:
// without that last one Shopify only returns the past 60 days of orders, which
// would cut off everything since DATA_START. Env: SHOPIFY_STORE (the
// *.myshopify.com domain) and SHOPIFY_ADMIN_TOKEN.
//
// Each run re-reads every order since DATA_START and replaces the table in one
// transaction. A store this size has at most a few thousand orders a year, and
// replacing (instead of adding) is what makes later refunds, cancellations and
// edits correct, and heals a run missed to a deploy restart.
import { DATA_START } from '../utils/dataStart.js';

const API_VERSION = '2025-07';
const PAGE_SIZE = 100;

export function shopifyConfigured() {
  return !!(process.env.SHOPIFY_STORE && process.env.SHOPIFY_ADMIN_TOKEN);
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

// Product title → "{pub}/{year}/{month}" (the same shape as /by-issue's key and
// content.publication_override), or null when it doesn't look like a single
// issue. A single issue is a title naming a month and a year; subscriptions,
// gift cards and merchandise don't have one. No publication named means the
// flagship, D Magazine. Anything this gets wrong can be fixed per product with
// PUT /api/analytics/shopify-products/:id (stored in shopify_product_map).
const PUBLICATIONS = [
  ['d-ceo', /\bd\s*ceo\b/i],
  ['d-home', /\bd\s*home\b/i],
  ['d-weddings', /\bd\s*weddings?\b/i],
  ['d-magazine', /\bd\s*magazine\b/i],
];

export function parseIssueFromTitle(title) {
  if (!title) return null;
  const m = title.toLowerCase().match(new RegExp(`\\b(${MONTHS.join('|')})\\b[^0-9]{0,12}(20\\d{2})\\b`));
  if (!m) return null;
  const pub = PUBLICATIONS.find(([, re]) => re.test(title))?.[0] || 'd-magazine';
  return `${pub}/${m[2]}/${m[1]}`;
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
export async function fetchShopifySales(sinceDate = DATA_START) {
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

export function saveShopifySales(db, sales) {
  const insert = db.prepare(`
    INSERT INTO shopify_sales_daily (product_id, date, product_title, units, revenue)
    VALUES (@product_id, @date, @product_title, @units, @revenue)
  `);
  db.transaction(() => {
    db.prepare('DELETE FROM shopify_sales_daily').run();
    for (const row of sales.values()) insert.run(row);
  })();
  return sales.size;
}

export async function syncShopifySales(db) {
  const sales = await fetchShopifySales();
  const rows = saveShopifySales(db, sales);
  const units = [...sales.values()].reduce((n, r) => n + r.units, 0);
  return { rows, units, products: new Set([...sales.values()].map(r => r.product_id)).size };
}
