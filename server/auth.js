import { getSessionUser, countUsers, createUser, touchVisit, SESSION_DAYS } from './authDb.js';
import { getDb } from './db.js';

const COOKIE = 'dmci_session';

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure}`);
}
export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}
export const sessionTokenOf = (req) => parseCookies(req.headers.cookie)[COOKIE] || null;

// Attaches req.user from the session cookie (or leaves it undefined).
export function attachUser(req, res, next) {
  const user = getSessionUser(sessionTokenOf(req));
  if (user) {
    req.user = user;
    req.auth = { user: user.username }; // what audit-log call sites read
    // Usage logging. The sync-status poll is skipped: the open app fires it
    // every 10 minutes on its own, so counting it would make a tab left open
    // overnight look like continuous use.
    if (req.path.startsWith('/api/') && req.path !== '/api/sync/status') {
      try { touchVisit(user.id, req.ip, req.headers['user-agent']); } catch (e) { console.error('[Auth] usage log failed:', e.message); }
    }
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not signed in' });
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not signed in' });
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

// First-run bootstrap: if no accounts exist yet, create the admin from the
// existing env credentials (ADMIN_USER/ADMIN_PASS, else DASHBOARD_USER/
// DASHBOARD_PASS — the same ones that already guard the app), then hand
// every pre-existing goal and Insights conversation to that admin so
// nothing created before individual logins is orphaned.
export function bootstrapAdmin() {
  if (countUsers() > 0) return;
  const username = process.env.ADMIN_USER || process.env.DASHBOARD_USER;
  const password = process.env.ADMIN_PASS || process.env.DASHBOARD_PASS;
  if (!username || !password) {
    console.error('[Auth] No accounts exist and no ADMIN_USER/ADMIN_PASS (or DASHBOARD_USER/DASHBOARD_PASS) is set — nobody can sign in. Set them and restart to create the first admin.');
    return;
  }
  if (password.length < 10) {
    console.warn('[Auth] The bootstrap password is shorter than 10 characters — sign in and change it right away.');
  }
  // createUser doesn't enforce length on purpose here: it must not lock out an existing deployment.
  const admin = createUser({ username, displayName: username, password, role: 'admin' });
  const db = getDb();
  db.prepare('UPDATE goals SET user_id = ? WHERE user_id IS NULL').run(admin.id);
  db.prepare('UPDATE insight_conversations SET user_id = ? WHERE user_id IS NULL').run(admin.id);
  console.log(`[Auth] Created first admin account "${admin.username}" and assigned existing goals/insights to it.`);
}

// Failed-login throttle: 8 failures per key (IP+username, and username
// alone) per 15 minutes.
const fails = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = 8;
export function isThrottled(keys) {
  const now = Date.now();
  return keys.some(k => (fails.get(k) || []).filter(t => now - t < WINDOW_MS).length >= MAX_FAILS);
}
export function recordFailure(keys) {
  const now = Date.now();
  for (const k of keys) fails.set(k, [...(fails.get(k) || []).filter(t => now - t < WINDOW_MS), now]);
}
export function clearFailures(keys) { for (const k of keys) fails.delete(k); }
