// Read-only client for the deployed dashboard's API, for Claude Code (or you)
// to pull report data as a signed-in user.
//
//   node --env-file=.env scripts/dash.mjs /api/analytics/summary
//   node --env-file=.env scripts/dash.mjs "/api/analytics/by-section?period=30d"
//
// Env: DASH_URL (e.g. https://ci.dmagazine.com), DASH_USER, DASH_PASS
// — a dedicated non-admin account, not your own login. GET requests to /api/
// only, so it can't change anything even if pointed at the wrong path.
const base = (process.env.DASH_URL || '').replace(/\/$/, '');
const [user, pass] = [process.env.DASH_USER, process.env.DASH_PASS];
const path = process.argv[2];

if (!base || !user || !pass) {
  console.error('Set DASH_URL, DASH_USER and DASH_PASS (see .env.example).');
  process.exit(2);
}
if (!path || !path.startsWith('/api/') || path.startsWith('/api/auth')) {
  console.error('Usage: node --env-file=.env scripts/dash.mjs /api/<route>[?query]  (GET only; /api/auth is off limits)');
  process.exit(2);
}

const login = await fetch(`${base}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: user, password: pass }),
}).catch(err => {
  console.error(`Can't reach ${base}: ${err.cause?.code || err.message} (is DASH_URL right, and is DNS set up?)`);
  process.exit(1);
});
if (!login.ok) {
  console.error(`Login failed (${login.status}): ${(await login.json().catch(() => ({}))).error || login.statusText}`);
  process.exit(1);
}
const cookie = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');

const res = await fetch(base + path, { headers: { Cookie: cookie } });
const body = await res.text();
if (!res.ok) {
  console.error(`GET ${path} failed (${res.status}): ${body.slice(0, 500)}`);
  process.exit(1);
}
try { console.log(JSON.stringify(JSON.parse(body), null, 2)); } catch { console.log(body); }
