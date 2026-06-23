import { existsSync, readFileSync } from 'fs';
import { getDb } from '../db.js';

const PROPERTY_ID = process.env.GA4_PROPERTY_ID || '320675632';
const KEY_FILE = process.env.GA4_KEY_FILE || './credentials/ga4-service-account.json';
const OAUTH_TOKEN_FILE = './credentials/ga4-oauth-token.json';
const GA4_REST_BASE = `https://analyticsdata.googleapis.com/v1beta/properties/${PROPERTY_ID}`;

const DFW_CITIES = [
  'Dallas', 'Fort Worth', 'Plano', 'Irving', 'Arlington',
  'Frisco', 'McKinney', 'Garland', 'Denton', 'Richardson',
  'Lewisville', 'Carrollton', 'Allen', 'Mesquite', 'Grand Prairie',
];

// ── Auth ──────────────────────────────────────────────────────────────────────

let cachedAccessToken = null;
let tokenExpiry = 0;

// Authenticate to GA4. Prefers the service account (never expires); falls back
// to the OAuth refresh-token file if the service account is unavailable.
async function serviceAccountToken() {
  const { GoogleAuth } = await import('google-auth-library');

  // Support credentials passed as a base64-encoded env var (e.g. on Render)
  // instead of a file on disk.
  let authConfig;
  if (process.env.GA4_SERVICE_ACCOUNT_JSON) {
    const credentials = JSON.parse(Buffer.from(process.env.GA4_SERVICE_ACCOUNT_JSON, 'base64').toString('utf8'));
    authConfig = { credentials, scopes: ['https://www.googleapis.com/auth/analytics.readonly'] };
  } else {
    authConfig = { keyFile: KEY_FILE, scopes: ['https://www.googleapis.com/auth/analytics.readonly'] };
  }

  const auth = new GoogleAuth(authConfig);
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  return token;
}

async function oauthToken() {
  const { client_id, client_secret, refresh_token } = JSON.parse(readFileSync(OAUTH_TOKEN_FILE, 'utf8'));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id, client_secret, refresh_token, grant_type: 'refresh_token' }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`GA4 token refresh failed: ${data.error_description || data.error}`);
  return data.access_token;
}

async function getAccessToken() {
  if (cachedAccessToken && Date.now() < tokenExpiry - 60000) return cachedAccessToken;

  // 1. Prefer the service account — no weekly expiry.
  if (process.env.GA4_SERVICE_ACCOUNT_JSON || (KEY_FILE && existsSync(KEY_FILE))) {
    try {
      cachedAccessToken = await serviceAccountToken();
      tokenExpiry = Date.now() + 3500 * 1000;
      return cachedAccessToken;
    } catch (err) {
      console.warn('[GA4] Service account auth failed, falling back to OAuth:', err.message);
    }
  }

  // 2. Fall back to the OAuth refresh token (expires ~weekly in Testing mode).
  if (existsSync(OAUTH_TOKEN_FILE)) {
    cachedAccessToken = await oauthToken();
    tokenExpiry = Date.now() + 3600 * 1000;
    return cachedAccessToken;
  }

  throw new Error('No GA4 credentials found. Add a service account key or run scripts/setup-ga4-oauth.mjs.');
}

// ── REST API helper ───────────────────────────────────────────────────────────

async function ga4Request(endpoint, body) {
  const token = await getAccessToken();
  const res = await fetch(`${GA4_REST_BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw new Error(`GA4 API error ${res.status}: ${err.error?.message || JSON.stringify(err)}`);
  }
  return res.json();
}

// Convert GA4 REST response rows into a usable array
function parseRows(response) {
  const dimHeaders = response.dimensionHeaders?.map(h => h.name) || [];
  const metHeaders = response.metricHeaders?.map(h => h.name) || [];
  return (response.rows || []).map(row => {
    const obj = {};
    row.dimensionValues?.forEach((v, i) => { obj[dimHeaders[i]] = v.value; });
    row.metricValues?.forEach((v, i) => { obj[metHeaders[i]] = parseFloat(v.value) || 0; });
    return obj;
  });
}

// ── Sync ──────────────────────────────────────────────────────────────────────

function isDFW(city) {
  if (!city) return false;
  return DFW_CITIES.some(c => city.toLowerCase().includes(c.toLowerCase()));
}

export async function syncGA4() {
  const db = getDb();
  const content = db.prepare("SELECT wp_id, url FROM content WHERE url IS NOT NULL AND url != ''").all();

  if (content.length === 0) {
    console.log('[GA4] No content to sync');
    return new Map();
  }

  // Build a pathname → wp_id map for matching GA4 pagePaths to our content
  const pathMap = new Map();
  for (const row of content) {
    try {
      const u = new URL(row.url);
      const path = u.pathname.replace(/\/$/, '') || '/';
      pathMap.set(path, row.wp_id);
      pathMap.set(path + '/', row.wp_id);
    } catch {
      pathMap.set(row.url, row.wp_id);
    }
  }

  const allMetrics = new Map(); // wp_id → metrics

  console.log('[GA4] Starting analytics sync');

  try {
    // ── Query 1: Main metrics ─────────────────────────────────────────────────
    const mainData = await ga4Request(':runReport', {
      dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
      dimensions: [{ name: 'pagePath' }],
      metrics: [
        { name: 'screenPageViews' },
        { name: 'activeUsers' },
        { name: 'averageSessionDuration' },
        { name: 'sessions' },
        { name: 'totalRevenue' },
      ],
      limit: 10000,
    });

    for (const row of parseRows(mainData)) {
      const path = (row.pagePath || '').replace(/\/$/, '') || '/';
      const wpId = pathMap.get(path) || pathMap.get(path + '/');
      if (!wpId) continue;
      allMetrics.set(wpId, {
        ga4_pageviews: Math.round(row.screenPageViews || 0),
        ga4_users: Math.round(row.activeUsers || 0),
        ga4_avg_engagement_time: row.averageSessionDuration || 0,
        ga4_sessions: Math.round(row.sessions || 0),
        ga4_ad_revenue: row.totalRevenue || 0,
        ga4_loyal_users: 0,
        ga4_inmarket_pageviews: 0,
        ga4_loyal_inmarket_pv: 0,
        ga4_subscribe_clicks: 0,
        ga4_email_signups: 0,
      });
    }

    // ── Query 2: DFW in-market active users ───────────────────────────────────
    const geoData = await ga4Request(':runReport', {
      dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
      dimensions: [{ name: 'pagePath' }, { name: 'city' }],
      metrics: [{ name: 'activeUsers' }],
      limit: 50000,
    });

    for (const row of parseRows(geoData)) {
      if (!isDFW(row.city)) continue;
      const path = (row.pagePath || '').replace(/\/$/, '') || '/';
      const wpId = pathMap.get(path) || pathMap.get(path + '/');
      if (!wpId) continue;
      if (!allMetrics.has(wpId)) allMetrics.set(wpId, { ga4_pageviews: 0, ga4_users: 0, ga4_avg_engagement_time: 0, ga4_sessions: 0, ga4_ad_revenue: 0, ga4_loyal_users: 0, ga4_inmarket_pageviews: 0, ga4_loyal_inmarket_pv: 0, ga4_subscribe_clicks: 0, ga4_email_signups: 0 });
      allMetrics.get(wpId).ga4_inmarket_pageviews += Math.round(row.activeUsers || 0);
    }

    // ── Query 3: Loyal users — GA4 audience "3 or more sessions, last 30 days" ──
    const loyalData = await ga4Request(':runReport', {
      dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
      dimensions: [{ name: 'pagePath' }, { name: 'audienceName' }],
      metrics: [{ name: 'activeUsers' }],
      dimensionFilter: {
        filter: {
          fieldName: 'audienceName',
          stringFilter: { matchType: 'EXACT', value: '3 or more sessions, last 30 days' },
        },
      },
      limit: 10000,
    });

    for (const row of parseRows(loyalData)) {
      const path = (row.pagePath || '').replace(/\/$/, '') || '/';
      const wpId = pathMap.get(path) || pathMap.get(path + '/');
      if (!wpId) continue;
      if (allMetrics.has(wpId)) {
        allMetrics.get(wpId).ga4_loyal_users += Math.round(row.activeUsers || 0);
      }
    }

    // Cap loyal_users at total users — GA4's audience dimension is property-level
    // and can return more "loyal visitors to this URL" than total users for that URL
    // (especially on recurring articles with a stable URL that build up audience visits
    // across multiple publications). Loyal is always a subset of total.
    for (const [, m] of allMetrics) {
      m.ga4_loyal_users = Math.min(m.ga4_loyal_users, m.ga4_users);
    }

    // Approximate loyal in-market: loyal_users × (inmarket_users / total_users)
    for (const [wpId, m] of allMetrics) {
      const ratio = m.ga4_users > 0
        ? Math.min(1, m.ga4_inmarket_pageviews / m.ga4_users)
        : 0;
      m.ga4_loyal_inmarket_pv = Math.round(m.ga4_loyal_users * ratio);
    }

    // ── Query 4: subscribe_click events ───────────────────────────────────────
    const subData = await ga4Request(':runReport', {
      dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
      dimensions: [{ name: 'pagePath' }, { name: 'eventName' }],
      metrics: [{ name: 'eventCount' }],
      dimensionFilter: {
        filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'subscribe_click' } },
      },
      limit: 10000,
    });

    for (const row of parseRows(subData)) {
      const path = (row.pagePath || '').replace(/\/$/, '') || '/';
      const wpId = pathMap.get(path) || pathMap.get(path + '/');
      if (!wpId) continue;
      if (allMetrics.has(wpId)) {
        allMetrics.get(wpId).ga4_subscribe_clicks += Math.round(row.eventCount || 0);
      }
    }

    // ── Query 5: email_signup events ──────────────────────────────────────────
    const signupData = await ga4Request(':runReport', {
      dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
      dimensions: [{ name: 'pagePath' }, { name: 'eventName' }],
      metrics: [{ name: 'eventCount' }],
      dimensionFilter: {
        filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'email_signup' } },
      },
      limit: 10000,
    });

    for (const row of parseRows(signupData)) {
      const path = (row.pagePath || '').replace(/\/$/, '') || '/';
      const wpId = pathMap.get(path) || pathMap.get(path + '/');
      if (!wpId) continue;
      if (allMetrics.has(wpId)) {
        allMetrics.get(wpId).ga4_email_signups += Math.round(row.eventCount || 0);
      }
    }

  } catch (err) {
    console.error('[GA4] API error:', err.message);
    throw err;
  }

  const withLoyal = [...allMetrics.values()].filter(m => m.ga4_loyal_users > 0).length;
  const withSub   = [...allMetrics.values()].filter(m => m.ga4_subscribe_clicks > 0).length;
  console.log(`[GA4] Fetched metrics for ${allMetrics.size} URLs — loyal_users>0: ${withLoyal}, subscribe_clicks>0: ${withSub}`);
  return allMetrics;
}

// Fetch site-wide conversion metrics broken down by GA4 channel group.
// Returns Array<{channel, users, subscribe_clicks, avg_engagement_time, ad_revenue}>
// These are DIRECT measurements — no attribution math.
// Note: GA4's "Organic Search" includes Google Discover; "Direct" includes dark social.
// Marfeel source data is more granular on those distinctions.
export async function syncGA4Sources() {
  const results = new Map(); // channel → metrics

  try {
    // Query 1: users + engagement + revenue by channel
    const channelData = await ga4Request(':runReport', {
      dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
      dimensions: [{ name: 'sessionDefaultChannelGrouping' }],
      metrics: [
        { name: 'activeUsers' },
        { name: 'averageSessionDuration' },
        { name: 'totalRevenue' },
        { name: 'sessions' },
      ],
      limit: 50,
    });

    for (const row of parseRows(channelData)) {
      const ch = row.sessionDefaultChannelGrouping || '(not set)';
      results.set(ch, {
        channel: ch,
        users:               Math.round(row.activeUsers || 0),
        sessions:            Math.round(row.sessions || 0),
        avg_engagement_time: row.averageSessionDuration || 0,
        ad_revenue:          row.totalRevenue || 0,
        subscribe_clicks:    0,
      });
    }

    // Query 2: subscribe_click events by channel
    const subData = await ga4Request(':runReport', {
      dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
      dimensions: [{ name: 'sessionDefaultChannelGrouping' }, { name: 'eventName' }],
      metrics: [{ name: 'eventCount' }],
      dimensionFilter: {
        filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'subscribe_click' } },
      },
      limit: 50,
    });

    for (const row of parseRows(subData)) {
      const ch = row.sessionDefaultChannelGrouping || '(not set)';
      if (results.has(ch)) {
        results.get(ch).subscribe_clicks += Math.round(row.eventCount || 0);
      }
    }

    console.log(`[GA4] Source performance: ${results.size} channel groups`);
  } catch (err) {
    console.error('[GA4] Source performance error:', err.message);
  }

  return [...results.values()].sort((a, b) => b.users - a.users);
}
