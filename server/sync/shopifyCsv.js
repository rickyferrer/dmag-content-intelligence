// Reads Shopify's Orders export CSV (Orders → Export) into the same per-product
// per-day units that sync/shopify.js saves from the API, for the history the
// API can't reach (it only returns 60 days without read_all_orders).
//
// The export has one row per line item. Order-level columns (Created at,
// Financial Status, Cancelled at, …) are filled on an order's FIRST row only;
// the rest of its rows carry just Name + Lineitem fields, so those are carried
// forward from the first row. Columns are read by name. Orders that were
// cancelled, voided or fully refunded are skipped. A partial refund can't be
// netted out (the export has no per-line refund quantity), so it still counts.
//
// There are no product ids in the export, so a product's id is 'csv:' + its
// line item name; sync/shopify.js's issue parser and shopify_product_map work
// on that the same as on a real product.

// RFC 4180 reader: quoted fields may hold commas, "" quotes and newlines
// (order notes and addresses do).
export function parseCsv(text) {
  const rows = [];
  let row = [], cur = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false;
      } else cur += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cur += c;
  }
  row.push(cur);
  if (row.length > 1 || row[0] !== '') rows.push(row);
  return rows;
}

const REQUIRED = ['Name', 'Created at', 'Lineitem quantity', 'Lineitem name'];

// → { sales: Map<`${product_id}|${date}`, {product_id, product_title, date, units, revenue}>, orders, skipped }
export function salesFromOrdersCsv(text, { from = '0000-00-00', before = '9999-99-99' } = {}) {
  const rows = parseCsv(text.replace(/^﻿/, ''));
  if (rows.length === 0) throw new Error('Empty CSV');
  const header = rows[0].map(h => h.trim());
  const col = Object.fromEntries(header.map((h, i) => [h, i]));
  const missing = REQUIRED.filter(h => !(h in col));
  if (missing.length) throw new Error(`Not a Shopify orders export — missing column(s): ${missing.join(', ')}`);
  const get = (r, h) => (h in col ? (r[col[h]] ?? '').trim() : '');

  const sales = new Map();
  const seen = new Set();
  let skipped = 0;
  let order = null; // order-level fields from the order's first row
  for (const r of rows.slice(1)) {
    const name = get(r, 'Name');
    const created = get(r, 'Created at');
    if (created) { // first row of an order
      const status = get(r, 'Financial Status').toLowerCase();
      order = {
        name,
        date: created.slice(0, 10),
        skip: !!get(r, 'Cancelled at') || ['voided', 'refunded'].includes(status),
      };
    }
    if (!order || order.name !== name) continue;
    const title = get(r, 'Lineitem name');
    const qty = parseInt(get(r, 'Lineitem quantity'), 10);
    if (!title || !(qty > 0)) continue;
    if (order.skip || order.date < from || order.date >= before) { skipped++; continue; }
    seen.add(name);
    const id = `csv:${title}`;
    const key = `${id}|${order.date}`;
    const row = sales.get(key) || { product_id: id, product_title: title, date: order.date, units: 0, revenue: 0 };
    row.units += qty;
    row.revenue += qty * (parseFloat(get(r, 'Lineitem price')) || 0);
    sales.set(key, row);
  }
  return { sales, orders: seen.size, skipped };
}

// Replaces earlier CSV rows with these. Live API rows are never touched.
export function saveCsvSales(db, sales) {
  const insert = db.prepare(`
    INSERT INTO shopify_sales_daily (product_id, date, product_title, units, revenue)
    VALUES (@product_id, @date, @product_title, @units, @revenue)
  `);
  db.transaction(() => {
    db.prepare("DELETE FROM shopify_sales_daily WHERE product_id LIKE 'csv:%'").run();
    for (const row of sales.values()) insert.run(row);
  })();
  return sales.size;
}
