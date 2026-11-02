// Single-issue sales as a score dimension for a magazine issue (Publications).
//
// An issue is sold as a whole, so this is an issue-level score, not a
// per-article one: article Content Value is untouched. The issue's score is
// its articles' Lifetime Value total plus the sales points below.
//
//   sales score  = units sold ÷ benchmark × 100, capped at 100 (same shape as
//                  the article dimensions in trueValue.js)
//   sales points = sales score × weight ÷ 100
//
// With the default weight of 100, an issue that hits the benchmark adds as
// much as one article with a perfect Lifetime Value. Both numbers are
// settings (issue_sales_benchmark / issue_sales_weight) and the defaults here
// are placeholders to tune once real sales are flowing in.
import { getDb } from '../db.js';
import { parseIssueFromTitle } from '../sync/shopify.js';

export const DEFAULT_ISSUE_SALES_BENCHMARK = 50;
export const DEFAULT_ISSUE_SALES_WEIGHT = 100;
export const ISSUE_SALES_SETTING_KEYS = ['issue_sales_benchmark', 'issue_sales_weight'];

export function getIssueSalesParams(settings = {}) {
  return {
    benchmark: parseFloat(settings.issue_sales_benchmark ?? DEFAULT_ISSUE_SALES_BENCHMARK),
    weight: parseFloat(settings.issue_sales_weight ?? DEFAULT_ISSUE_SALES_WEIGHT),
  };
}

export function issueSalesScore(units, p) {
  if (!(p.benchmark > 0)) return 0;
  return Math.max(0, Math.min(100, (units || 0) / p.benchmark * 100));
}

// Every synced product with units/revenue since DATA_START and the issue it
// counts toward: an explicit shopify_product_map entry beats the title guess
// ('ignore' drops the product), and `issue` is null when neither places it.
export function getShopifyProducts(db = getDb()) {
  return db.prepare(`
    SELECT s.product_id, MAX(s.product_title) AS title, SUM(s.units) AS units, SUM(s.revenue) AS revenue,
           m.issue AS override
    FROM shopify_sales_daily s
    LEFT JOIN shopify_product_map m ON m.product_id = s.product_id
    GROUP BY s.product_id
    ORDER BY units DESC
  `).all().map(r => {
    const issue = r.override === 'ignore' ? null : (r.override || parseIssueFromTitle(r.title));
    return { ...r, issue, source: r.override ? 'manual' : issue ? 'auto' : 'unmapped' };
  });
}

// Units sold per issue key ("{pub}/{year}/{month}"), or null when the store
// has never synced — so the UI can tell "no sales" from "not connected".
export function getIssueSales(db = getDb()) {
  if (!db.prepare("SELECT 1 FROM sync_state WHERE key = 'last_shopify_sync'").get()) return null;
  const byIssue = new Map();
  for (const p of getShopifyProducts(db)) {
    if (p.issue) byIssue.set(p.issue, (byIssue.get(p.issue) || 0) + p.units);
  }
  return byIssue;
}
