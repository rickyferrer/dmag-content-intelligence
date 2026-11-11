// Google Search Console sync — pulls real per-page, per-query search performance.
// Reuses the same GA4 service account (it's just a Google Cloud service account;
// it needs to additionally be granted access to the Search Console property).
const SITE_URL = process.env.GSC_SITE_URL || 'sc-domain:dmagazine.com';
const KEY_FILE = process.env.GA4_KEY_FILE || './credentials/ga4-service-account.json';
const LOOKBACK_DAYS = 90;
const ROW_LIMIT = 25000;
const MAX_PAGES = 10; // safety cap — up to 250k rows per sync

async function getAccessToken() {
  const { GoogleAuth } = await import('google-auth-library');

  let authConfig;
  if (process.env.GA4_SERVICE_ACCOUNT_JSON) {
    const credentials = JSON.parse(Buffer.from(process.env.GA4_SERVICE_ACCOUNT_JSON, 'base64').toString('utf8'));
    authConfig = { credentials, scopes: ['https://www.googleapis.com/auth/webmasters.readonly'] };
  } else {
    authConfig = { keyFile: KEY_FILE, scopes: ['https://www.googleapis.com/auth/webmasters.readonly'] };
  }

  const auth = new GoogleAuth(authConfig);
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  return token;
}

function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}

// A 25,000-row page can take Google well over 30s, so each attempt gets two
// minutes, and a timeout, network error, 429 or 5xx is retried (a 4xx like a
// 403 for missing access is not — it won't get better).
const REQUEST_TIMEOUT_MS = 120000;
const ATTEMPTS = 3;
async function postWithRetry(url, token, body) {
  let lastError;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        signal: controller.signal,
        body,
      });
      if (res.ok) return res;
      const text = await res.text();
      lastError = new Error(`GSC query failed: ${res.status} — ${text.slice(0, 300)}`);
      if (res.status !== 429 && res.status < 500) throw lastError; // access/config problem: don't retry
    } catch (err) {
      if (err === lastError) throw err;
      const cause = err.cause ? ` (cause: ${err.cause?.code || err.cause?.message || err.cause})` : '';
      const what = err.name === 'AbortError' ? `timed out after ${REQUEST_TIMEOUT_MS / 1000}s` : err.message;
      lastError = new Error(`GSC fetch failed: ${what}${cause}`);
    } finally {
      clearTimeout(timeout);
    }
    if (attempt < ATTEMPTS) await new Promise(r => setTimeout(r, 5000 * attempt));
  }
  throw lastError;
}

// Fetch rows from Search Console for the given dimension combination,
// paginated. Shared by the per-query sync (dimensions: page, query) and the
// per-day trend sync (dimensions: page, date) — same API, same auth, same
// pagination, just a different breakdown of the same 90-day window.
async function fetchSearchAnalytics(token, dimensions) {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - LOOKBACK_DAYS);

  const rows = [];
  let startRow = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE_URL)}/searchAnalytics/query`;
    const body = JSON.stringify({
      startDate: fmtDate(startDate),
      endDate: fmtDate(endDate),
      dimensions,
      rowLimit: ROW_LIMIT,
      startRow,
    });
    const res = await postWithRetry(url, token, body);
    const data = await res.json();
    const batch = data.rows || [];
    rows.push(...batch);

    if (batch.length < ROW_LIMIT) break; // last page
    startRow += ROW_LIMIT;
  }

  return rows;
}

// Normalize a URL to origin+pathname for matching against content.url variants.
function normalizeUrl(raw) {
  try {
    const u = new URL(raw);
    return u.origin + u.pathname;
  } catch {
    return raw;
  }
}

export async function syncGSC() {
  const token = await getAccessToken();
  const rows = await fetchSearchAnalytics(token, ['page', 'query']);

  console.log(`[GSC] Fetched ${rows.length} page+query rows (last ${LOOKBACK_DAYS} days)`);

  // Group by normalized page URL
  const byUrl = new Map(); // normalizedUrl → [{query, clicks, impressions, ctr, position}]
  for (const row of rows) {
    const [page, query] = row.keys;
    const norm = normalizeUrl(page);
    if (!byUrl.has(norm)) byUrl.set(norm, []);
    byUrl.get(norm).push({
      query,
      clicks: row.clicks || 0,
      impressions: row.impressions || 0,
      ctr: row.ctr || 0,
      position: row.position || 0,
    });
  }

  return byUrl;
}

// Per-page daily trend — no query dimension, so a page shows up here even
// when it never earns enough clicks on any single query to appear in
// gsc_queries. This is what powers the CTR-decline-while-impressions-hold
// fallback signal for articles that would otherwise fall back to a pure
// title guess.
export async function syncGSCTrend() {
  const token = await getAccessToken();
  const rows = await fetchSearchAnalytics(token, ['page', 'date']);

  console.log(`[GSC] Fetched ${rows.length} page+date rows (last ${LOOKBACK_DAYS} days)`);

  const byUrl = new Map(); // normalizedUrl → [{date, clicks, impressions, ctr, position}]
  for (const row of rows) {
    const [page, date] = row.keys;
    const norm = normalizeUrl(page);
    if (!byUrl.has(norm)) byUrl.set(norm, []);
    byUrl.get(norm).push({
      date,
      clicks: row.clicks || 0,
      impressions: row.impressions || 0,
      ctr: row.ctr || 0,
      position: row.position || 0,
    });
  }

  return byUrl;
}
