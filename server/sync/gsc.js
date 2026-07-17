// Google Search Console sync — pulls real per-page, per-query search performance.
// Reuses the same GA4 service account (it's just a Google Cloud service account;
// it needs to additionally be granted access to the Search Console property).
const SITE_URL = process.env.GSC_SITE_URL || 'sc-domain:dmagazine.com';
const KEY_FILE = process.env.GA4_KEY_FILE || './credentials/ga4-service-account.json';
const LOOKBACK_DAYS = 90;
const ROW_LIMIT = 25000;
const MAX_PAGES = 10; // safety cap — up to 250k page+query rows per sync

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

// Fetch page+query rows from Search Console, paginated.
async function fetchSearchAnalytics(token) {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - LOOKBACK_DAYS);

  const rows = [];
  let startRow = 0;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(SITE_URL)}/searchAnalytics/query`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          startDate: fmtDate(startDate),
          endDate: fmtDate(endDate),
          dimensions: ['page', 'query'],
          rowLimit: ROW_LIMIT,
          startRow,
        }),
      });
    } catch (err) {
      const cause = err.cause ? ` (cause: ${err.cause?.code || err.cause?.message || err.cause})` : '';
      throw new Error(`GSC fetch failed: ${err.message}${cause}`);
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GSC query failed: ${res.status} — ${text.slice(0, 300)}`);
    }

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
  const rows = await fetchSearchAnalytics(token);

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
