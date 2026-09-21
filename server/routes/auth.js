import { Router } from 'express';
import {
  getUserRecordByUsername, verifyPassword, verifyAgainstDummy, createSession, deleteSession,
  setPassword, deleteUserSessions, validatePassword, logLoginEvent,
  createPendingSignup, getPendingSignup, deletePendingSignup, emailInUse, createUser,
} from '../authDb.js';
import {
  setSessionCookie, clearSessionCookie, sessionTokenOf, requireAuth,
  isThrottled, recordFailure, clearFailures,
  allowedSignupDomains, emailAllowedToSignUp, adminEmails, EMAIL_RE, signupThrottled,
} from '../auth.js';
import { sendSignupEmail, signupsAvailable, appBaseUrl } from '../mailer.js';

const router = Router();

// POST /api/auth/login — every attempt is recorded in login_events (who, when,
// from where, success or not) so admins can see sign-ins and spot guessing.
router.post('/login', (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required.' });

  const meta = { username, ip: req.ip, userAgent: req.headers['user-agent'] };
  const keys = [`ip:${req.ip}|${username.toLowerCase()}`, `user:${username.toLowerCase()}`];
  if (isThrottled(keys)) {
    logLoginEvent({ ...meta, success: false });
    return res.status(429).json({ error: 'Too many failed attempts. Try again in a few minutes.' });
  }

  const rec = getUserRecordByUsername(username);
  const ok = rec ? verifyPassword(password, rec.password_hash) : (verifyAgainstDummy(password), false);
  if (!ok || !rec.active) {
    recordFailure(keys);
    logLoginEvent({ ...meta, userId: rec?.id ?? null, success: false });
    return res.status(401).json({ error: 'Incorrect username or password.' });
  }
  clearFailures(keys);
  logLoginEvent({ ...meta, userId: rec.id, success: true });
  setSessionCookie(res, createSession(rec.id));
  res.json({ user: { id: rec.id, username: rec.username, display_name: rec.display_name, role: rec.role } });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  const token = sessionTokenOf(req);
  if (token) deleteSession(token);
  clearSessionCookie(res);
  res.json({ ok: true });
});

// GET /api/auth/me — 401 when signed out, which is what the client keys off.
router.get('/me', requireAuth, (req, res) => res.json({ user: req.user }));

// POST /api/auth/change-password — own password; signs out every other session.
router.post('/change-password', requireAuth, (req, res) => {
  const { current_password, new_password } = req.body || {};
  const rec = getUserRecordByUsername(req.user.username);
  if (!rec || !verifyPassword(String(current_password || ''), rec.password_hash)) {
    return res.status(400).json({ error: 'Current password is incorrect.' });
  }
  const bad = validatePassword(new_password);
  if (bad) return res.status(400).json({ error: bad });
  setPassword(rec.id, new_password);
  deleteUserSessions(rec.id);
  setSessionCookie(res, createSession(rec.id));
  res.json({ ok: true });
});

// ── Self-service sign-up ────────────────────────────────────────────────────
// Flow: POST /signup (email + name) → emailed link → GET /signup-info shows
// the address → POST /signup/complete (token + password) creates the verified
// account and signs in. Nothing is created before the link is used.

// GET /api/auth/config — lets the sign-in screen know whether to offer sign-up.
router.get('/config', (req, res) => {
  const domains = allowedSignupDomains();
  res.json({ signup_enabled: signupsAvailable(), signup_domains: domains.includes('*') ? null : domains });
});

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  if (!signupsAvailable()) return res.status(503).json({ error: 'Sign-ups are unavailable right now — ask an admin to create your account.' });
  const email = String(req.body?.email || '').trim().toLowerCase();
  const name = String(req.body?.display_name || '').trim().slice(0, 80);
  if (!name) return res.status(400).json({ error: 'Please enter your name.' });
  if (email.length > 254 || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (!emailAllowedToSignUp(email)) {
    const d = allowedSignupDomains();
    return res.status(400).json({ error: `Sign-ups are limited to ${d.map(x => '@' + x).join(', ')} addresses.` });
  }
  if (signupThrottled(req.ip, email)) return res.status(429).json({ error: 'Too many requests. Try again in a little while.' });

  // Same answer whether or not the address already has an account, so this
  // form can't be used to discover who does.
  const generic = { ok: true, message: 'If that address can register, a link to finish is on its way. It expires in 24 hours.' };
  if (emailInUse(email)) return res.json(generic);
  try {
    const token = createPendingSignup(email, name);
    await sendSignupEmail({ to: email, name, link: `${appBaseUrl()}/?signup=${token}` });
  } catch (err) {
    console.error('[Auth] Sign-up email failed:', err.message);
    deletePendingSignup(email);
    return res.status(502).json({ error: "We couldn't send the email. Try again shortly, or ask an admin to create your account." });
  }
  res.json(generic);
});

// GET /api/auth/signup-info?token= — read-only (safe against email link
// scanners); the account is only created by the POST below.
router.get('/signup-info', (req, res) => {
  const p = getPendingSignup(String(req.query.token || ''));
  if (!p) return res.status(404).json({ error: 'This link is invalid or has expired. Request a new one.' });
  res.json({ email: p.email, display_name: p.display_name });
});

// POST /api/auth/signup/complete
router.post('/signup/complete', (req, res) => {
  const p = getPendingSignup(String(req.body?.token || ''));
  if (!p) return res.status(400).json({ error: 'This link is invalid or has expired. Request a new one.' });
  const bad = validatePassword(req.body?.password);
  if (bad) return res.status(400).json({ error: bad });
  const email = p.email.toLowerCase();
  if (emailInUse(email)) { deletePendingSignup(p.email); return res.status(409).json({ error: 'That address already has an account — sign in instead.' }); }

  const role = adminEmails().includes(email) ? 'admin' : 'user';
  const user = createUser({ username: email, displayName: p.display_name, password: req.body.password, role, email });
  deletePendingSignup(p.email);
  logLoginEvent({ userId: user.id, username: email, success: true, ip: req.ip, userAgent: req.headers['user-agent'] });
  setSessionCookie(res, createSession(user.id));
  res.json({ user: { id: user.id, username: user.username, display_name: user.display_name, role: user.role } });
});

export default router;
