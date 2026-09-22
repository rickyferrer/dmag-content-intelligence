import {
  getSessionUser, countUsers, countActiveAdmins, getUserRecordByUsername, createUser, updateUser, touchVisit, SESSION_DAYS,
} from './authDb.js';
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
// First-run bootstrap, and self-healing recovery: whenever the server starts
// up with ZERO ACTIVE ADMINS — not just zero accounts — ensure the account
// named by ADMIN_USER/ADMIN_PASS (else DASHBOARD_USER/DASHBOARD_PASS, the
// same credentials that guarded the app before individual logins) is an
// active admin. This is deliberately broader than "no accounts exist":
// with open sign-up, someone else creating an account first would otherwise
// permanently skip bootstrap and could leave a deployment with no admin at
// all and no way back in through the UI (see the incident that prompted
// this — server/scripts/promote-admin.mjs is the manual fallback for right
// now; this is what stops it happening again). If that account already
// exists, this only restores its role/active flag — it never touches an
// existing password, so it can't be used to silently reset one.
export function bootstrapAdmin() {
  if (countActiveAdmins() > 0) return;
  const username = process.env.ADMIN_USER || process.env.DASHBOARD_USER;
  const password = process.env.ADMIN_PASS || process.env.DASHBOARD_PASS;
  if (!username || !password) {
    console.error('[Auth] No active admin exists and no ADMIN_USER/ADMIN_PASS (or DASHBOARD_USER/DASHBOARD_PASS) is set — nobody can reach Settings. Set them and restart, or run server/scripts/promote-admin.mjs <username> to promote someone directly.');
    return;
  }
  if (password.length < 10) {
    console.warn('[Auth] The bootstrap password is shorter than 10 characters — sign in and change it right away.');
  }

  const existing = getUserRecordByUsername(username);
  if (existing) {
    updateUser(existing.id, { role: 'admin', active: true });
    console.log(`[Auth] No active admin existed — restored admin on the existing account "${username}".`);
    return;
  }

  // createUser doesn't enforce password length on purpose here: it must not lock out an existing deployment.
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

// ── Open sign-up ────────────────────────────────────────────────────────────
// Anyone can create an account (email + name, password optional). There is
// deliberately no domain allowlist or "this email becomes admin" rule: without
// email verification an address is just typed text, so either would be a
// door anyone could walk through. Admins remove accounts they don't
// recognize in Settings → Users, and admin role requires a password.
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// 10 new accounts/hour per IP — stops the form being used to flood the user list.
const signupHits = new Map();
export function signupThrottled(ip) {
  const now = Date.now();
  const recent = (signupHits.get(ip) || []).filter(t => now - t < 3600000);
  if (recent.length >= 10) { signupHits.set(ip, recent); return true; }
  signupHits.set(ip, [...recent, now]);
  return false;
}
