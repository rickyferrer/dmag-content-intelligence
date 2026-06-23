import { getSyncState, setSyncState } from '../db.js';

const API_BASE = process.env.MARFEEL_API_BASE || 'https://api.newsroom.bi/api';
const AUTH_ENDPOINT = process.env.MARFEEL_AUTH_ENDPOINT || 'https://api.newsroom.bi/api/user/signin';
const EMAIL = process.env.MARFEEL_EMAIL || '';
const PASSWORD = process.env.MARFEEL_PASSWORD || '';

const RATE_LIMIT_DELAY = 65 * 1000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getToken() {
  const storedToken = getSyncState('marfeel_token');
  const tokenExpiry = getSyncState('marfeel_token_expires');

  if (storedToken && tokenExpiry) {
    const expiryMs = parseInt(tokenExpiry, 10);
    if (Date.now() < expiryMs - 86400000) return storedToken;
  }

  if (!EMAIL || !PASSWORD) throw new Error('Marfeel credentials not configured');

  console.log('[Marfeel] Authenticating...');
  const res = await fetch(AUTH_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`Marfeel auth failed: ${res.status}`);

  const body = await res.json();
  const token = body.token || body.accessToken || body.access_token;
  if (!token) throw new Error('Marfeel auth: no token in response');

  const expiry = Date.now() + 14 * 24 * 60 * 60 * 1000;
  setSyncState('marfeel_token', token);
  setSyncState('marfeel_token_expires', String(expiry));
  console.log('[Marfeel] Authenticated successfully');
  return token;
}

async function marfeelQuery(token, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

  let res;
  try {
    res = await fetch(`${API_BASE}/dashboard/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    const cause = err.cause ? ` (cause: ${err.cause?.code || err.cause?.message || err.cause})` : '';
    throw new Error(`Marfeel fetch failed: ${err.message}${cause}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Marfeel query failed: ${res.status} — ${text.slice(0, 200)}`);
  }

  const text = await res.text();

  // Empty body = metric name not recognised by this account's API.
  // Return null so callers can distinguish "unknown metric" from actual errors.
  if (!text || !text.trim()) return null;

  try {
    return JSON.parse(text);
  } catch (err) {
    console.error('[Marfeel] JSON parse error. First 300 chars:', text.slice(0, 300));
    throw new Error('Marfeel response is not valid JSON');
  }
}

// Marfeel returns one of several response shapes depending on the query and API version.
// When groupBy includes 'url', the response is an array of metric objects:
//   [{metric: "uniqueUsers", total: N, actualData: {values: [{key: urlOrHash, value: N, ...}]}}]
// When no groupBy, it may return aggregate-only objects.
// This function normalises whatever comes back into a Map<url, {metricName: value}>
function parseGroupedResponse(response, label) {
  const urlMap = new Map();

  if (!response) return urlMap;

  const arr = Array.isArray(response) ? response : [response];

  // Debug: print key shape of first element
  if (arr.length > 0) {
    const first = arr[0];
    const valueItems = first?.actualData?.values || first?.data?.values || [];
    if (valueItems.length > 0) {
      console.log(`[Marfeel] ${label} — first value item:`, JSON.stringify(valueItems[0]));
    } else {
      console.log(`[Marfeel] ${label} — no values found in response shape:`, Object.keys(first || {}));
    }
  }

  for (const metricObj of arr) {
    const metricName = metricObj.metric || metricObj.name;
    const values = metricObj.actualData?.values
      || metricObj.data?.values
      || metricObj.values
      || [];

    for (const item of values) {
      // The URL is nested inside item.items[]:
      // {"key":"hash","total":22525,"items":[{"id":"https://...","value":"https://...","type":"url"}]}
      let resolvedUrl = null;
      if (Array.isArray(item.items) && item.items.length > 0) {
        const urlItem = item.items.find(i => i.type === 'url') || item.items[0];
        const candidate = urlItem?.value || urlItem?.id;
        if (candidate && (candidate.startsWith('http') || candidate.startsWith('/'))) {
          resolvedUrl = candidate;
        }
      }

      // Fallback: key itself if it looks like a URL
      if (!resolvedUrl) {
        const rawKey = item.key ?? item.url ?? item.article;
        if (rawKey && typeof rawKey === 'string' &&
            (rawKey.startsWith('http') || rawKey.startsWith('/'))) {
          resolvedUrl = rawKey;
        }
      }

      if (!resolvedUrl) continue; // hash key with no URL — skip

      // Normalize: strip query string & fragment, ensure consistent trailing slash
      try {
        const u = new URL(resolvedUrl);
        resolvedUrl = u.origin + u.pathname; // drops ?query and #fragment
      } catch { /* not a full URL — keep as-is */ }

      if (!urlMap.has(resolvedUrl)) urlMap.set(resolvedUrl, {});
      const row = urlMap.get(resolvedUrl);

      // Metric value: item.total is the per-URL aggregate
      let value = 0;
      if (typeof item.total === 'number') {
        value = item.total;
      } else if (typeof item.value === 'number') {
        value = item.value;
      } else if (Array.isArray(item.values)) {
        value = item.values.reduce((sum, v) =>
          sum + (typeof v === 'number' ? v : (v?.value ?? v?.total ?? 0)), 0);
      }

      row[metricName] = (row[metricName] || 0) + value;
    }
  }

  return urlMap;
}

// Newsletter signup data lives on a different endpoint from the main dashboard queries.
// Marfeel uses /api/traffic/realtime with metric "goal::newsletter_signup" (note the "::" prefix).
// The per-article signup count is in item.users, not inside item.metrics.
async function fetchNewsletterSignups(token) {
  const results = new Map(); // normalised url → signup count
  const limit = 500;
  let from = 0;

  while (true) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    let res;
    try {
      res = await fetch(`${API_BASE}/traffic/realtime`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          filters: [],
          limit,
          from,
          article: null,
          dates: { last: { number: 30, dimension: 'day' } },
          plotBy: 'medium',
          metrics: ['goal::newsletter_signup'],
          model: 'posts',
          tagValue: null,
          version: 2,
        }),
      });
    } catch (err) {
      const cause = err.cause ? ` (cause: ${err.cause?.code || err.cause?.message || err.cause})` : '';
      throw new Error(`Marfeel realtime fetch failed: ${err.message}${cause}`);
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Marfeel realtime failed: ${res.status} — ${text.slice(0, 200)}`);
    }

    const text = await res.text();
    if (!text || !text.trim()) break;

    const data = JSON.parse(text);
    const items = data.main || data.articles || data.data || [];
    if (items.length === 0) break;

    for (const item of items) {
      const raw = item.url;
      const count = item.users || 0;
      if (!raw || count === 0) continue;

      let url = raw;
      try { const u = new URL(raw); url = u.origin + u.pathname; } catch { /* keep raw */ }

      results.set(url, (results.get(url) || 0) + count);
    }

    if (items.length < limit) break; // last page
    from += limit;
  }

  return results;
}

// Fetch per-article acquisition sources via source+url combined groupBy.
// Returns Map<normalised_url, Array<{source, pageviews}>>
async function fetchSourceData(token, dateRange) {
  const result = new Map(); // url → [{source, pageviews}]
  const limit = 2000;
  let from = 0;

  while (true) {
    let resp;
    try {
      resp = await marfeelQuery(token, {
        dates: dateRange,
        granularity: 'daily',
        filters: [],
        groupBy: ['source', 'url'],
        metrics: ['pageViewsTotal'],
        order: { metric: 'pageViewsTotal', sort: 'DESC' },
        limit,
        from,
      });
    } catch (err) {
      console.warn('[Marfeel] Source data fetch failed:', err.message);
      break;
    }
    if (!resp) break;

    const items = resp[0]?.actualData?.values || resp[0]?.data?.values || [];
    if (items.length === 0) break;

    for (const item of items) {
      const sourceItem = item.items?.find(i => i.type === 'source');
      const urlItem    = item.items?.find(i => i.type === 'url');
      const source = sourceItem?.value;
      const rawUrl = urlItem?.value || urlItem?.id;
      if (!source || !rawUrl) continue;

      let url = rawUrl;
      try { const u = new URL(rawUrl); url = u.origin + u.pathname; } catch { /* keep raw */ }

      if (!result.has(url)) result.set(url, []);
      result.get(url).push({ source, pageviews: item.total || 0 });
    }

    if (items.length < limit) break;
    from += limit;
    await sleep(3000);
  }

  return result;
}

export async function syncMarfeel() {
  if (!PASSWORD) {
    console.log('[Marfeel] No password configured — skipping');
    return new Map();
  }

  let token;
  try {
    token = await getToken();
  } catch (err) {
    console.error('[Marfeel] Auth error:', err.message);
    return new Map();
  }

  const allMetrics = new Map(); // url → metrics
  const dateRange = { last: { number: 30, dimension: 'day' } };

  try {
    // Query 1: Per-URL traffic — use 'daily' (Marfeel doesn't support 'total' granularity)
    console.log('[Marfeel] Fetching traffic metrics...');
    const trafficResp = await marfeelQuery(token, {
      dates: dateRange,
      granularity: 'daily',
      filters: [],
      groupBy: ['url'],
      metrics: ['uniqueUsers', 'pageViewsTotal'],
      order: { metric: 'pageViewsTotal', sort: 'DESC' },
      limit: 500,
      from: 0,
    });

    const trafficMap = parseGroupedResponse(trafficResp, 'traffic');

    for (const [url, row] of trafficMap) {
      allMetrics.set(url, {
        mf_unique_users: row.uniqueUsers || 0,
        mf_pageviews: row.pageViewsTotal || row.pageViews || 0,
        mf_loyal_users: 0,
        mf_scroll_depth: 0,
        mf_recirculation_rate: 0,
        mf_newsletter_signups: 0,
      });
    }

    console.log(`[Marfeel] Traffic URLs parsed: ${allMetrics.size}`);
    if (allMetrics.size > 0) {
      const sampleKeys = [...allMetrics.keys()].slice(0, 3);
      console.log('[Marfeel] Sample URL keys:', sampleKeys);
    }

    if (allMetrics.size === 0) {
      // groupBy: ['url'] returned hashes. Try alternate dimension names some accounts use.
      const altDimensions = ['articleUrl', 'pageUrl', 'article', 'page'];
      let found = false;

      for (const dim of altDimensions) {
        console.log(`[Marfeel] Trying groupBy: ['${dim}']...`);
        try {
          const altResp = await marfeelQuery(token, {
            dates: dateRange,
            granularity: 'daily',
            filters: [],
            groupBy: [dim],
            metrics: ['uniqueUsers', 'pageViewsTotal'],
            order: { metric: 'pageViewsTotal', sort: 'DESC' },
            limit: 5,
            from: 0,
          });
          const altMap = parseGroupedResponse(altResp, `alt:${dim}`);
          if (altMap.size > 0) {
            console.log(`[Marfeel] ✓ groupBy: ['${dim}'] works — found ${altMap.size} URLs`);
            for (const [url, row] of altMap) {
              allMetrics.set(url, {
                mf_unique_users: row.uniqueUsers || 0,
                mf_pageviews: row.pageViewsTotal || row.pageViews || 0,
                mf_loyal_users: 0,
                mf_scroll_depth: 0,
                mf_recirculation_rate: 0,
              });
            }
            found = true;
            break;
          }
        } catch (err) {
          console.log(`[Marfeel] groupBy: ['${dim}'] failed:`, err.message);
        }
        await sleep(RATE_LIMIT_DELAY);
      }

      if (!found) {
        console.log('[Marfeel] All groupBy variants returned hashes. Contact Marfeel support to get the correct dimension name for per-URL data. Marfeel metrics will be 0 for now.');
        return allMetrics;
      }
    }

    // Query 2: Loyal + Lover users
    console.log('[Marfeel] Fetching loyal user metrics...');
    await sleep(RATE_LIMIT_DELAY);

    const loyalResp = await marfeelQuery(token, {
      dates: dateRange,
      granularity: 'daily',
      filters: [{ filter: 'visitorFrequency', op: 'eq', value: [4, 5] }],
      groupBy: ['url'],
      metrics: ['uniqueUsers'],
      order: { metric: 'uniqueUsers', sort: 'DESC' },
      limit: 500,
      from: 0,
    });

    const loyalMap = parseGroupedResponse(loyalResp, 'loyal');
    for (const [url, row] of loyalMap) {
      if (allMetrics.has(url)) {
        allMetrics.get(url).mf_loyal_users = row.uniqueUsers || 0;
      }
    }

    // Query 3: Scroll depth
    console.log('[Marfeel] Fetching scroll depth metrics...');
    await sleep(RATE_LIMIT_DELAY);

    try {
      const scrollResp = await marfeelQuery(token, {
        dates: dateRange,
        granularity: 'daily',
        filters: [],
        groupBy: ['url'],
        metrics: ['scrollDepth'],
        order: { metric: 'scrollDepth', sort: 'DESC' },
        limit: 500,
        from: 0,
      });

      if (scrollResp === null) {
        console.log('[Marfeel] scrollDepth not available in this account');
      } else {
        const scrollMap = parseGroupedResponse(scrollResp, 'scrollDepth');
        for (const [url, row] of scrollMap) {
          if (allMetrics.has(url)) {
            allMetrics.get(url).mf_scroll_depth = row.scrollDepth || 0;
          }
        }
      }
    } catch (err) {
      console.warn('[Marfeel] scrollDepth query failed:', err.message);
    }

    // Query 4: Newsletter signups via /api/traffic/realtime
    // Uses metric "goal::newsletter_signup"; count lives in item.users of the response.
    console.log('[Marfeel] Fetching newsletter signup conversions...');
    await sleep(RATE_LIMIT_DELAY);

    try {
      const newsletterSignups = await fetchNewsletterSignups(token);
      let mapped = 0;
      for (const [url, count] of newsletterSignups) {
        if (allMetrics.has(url)) {
          allMetrics.get(url).mf_newsletter_signups = count;
          mapped++;
        }
      }
      console.log(`[Marfeel] Newsletter signups mapped for ${mapped} URLs (${newsletterSignups.size} from API)`);
    } catch (err) {
      console.warn('[Marfeel] Newsletter signup fetch failed:', err.message);
    }

  } catch (err) {
    console.error('[Marfeel] Sync error:', err.message);
  }

  // Fetch source data separately so a failure here never kills the main metrics.
  let sourcesByUrl = new Map();
  try {
    console.log('[Marfeel] Fetching acquisition sources per article...');
    sourcesByUrl = await fetchSourceData(token, dateRange);
    console.log(`[Marfeel] Source data: ${sourcesByUrl.size} URLs with acquisition breakdown`);
  } catch (err) {
    console.warn('[Marfeel] Source fetch failed:', err.message);
  }

  console.log(`[Marfeel] Sync complete: ${allMetrics.size} URLs`);
  return { metrics: allMetrics, sourcesByUrl };
}
