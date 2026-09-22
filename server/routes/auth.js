import { Router } from 'express';
import {
  getUserRecordByUsername, verifyPassword, verifyAgainstDummy, createSession, deleteSession,
  setPassword, deleteUserSessions, validatePassword, logLoginEvent, createUser, emailInUse, hasPassword,
} from '../authDb.js';
import {
  setSessionCookie, clearSessionCookie, sessionTokenOf, requireAuth,
  isThrottled, recordFailure, clearFailures, EMAIL_RE, signupThrottled,
} from '../auth.js';

const router = Router();

// POST /api/auth/login — every attempt is recorded in login_events (who, when,
// from where, success or not). An account with a password always needs it; an
// email-only account (open sign-up) signs in with just the address. The client
// learns which by the `code` on the 401: "password_required" or "no_account".
router.post('/login', (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (!username) return res.status(400).json({ error: 'Enter your email address.' });
  if (!EMAIL_RE.test(username)) return res.status(400).json({ error: 'Enter a valid email address.', code: 'invalid_email' });

  const meta = { username, ip: req.ip, userAgent: req.headers['user-agent'] };
  const keys = [`ip:${req.ip}|${username.toLowerCase()}`, `user:${username.toLowerCase()}`];
  if (isThrottled(keys)) {
    logLoginEvent({ ...meta, success: false });
    return res.status(429).json({ error: 'Too many failed attempts. Try again in a few minutes.' });
  }

  const rec = getUserRecordByUsername(username);
  if (!rec) {
    verifyAgainstDummy(password);
    logLoginEvent({ ...meta, success: false });
    return res.status(401).json({ error: 'No account found for that email. Create one below.', code: 'no_account' });
  }
  if (!rec.active) {
    logLoginEvent({ ...meta, userId: rec.id, success: false });
    return res.status(401).json({ error: 'This account has been deactivated. Ask an admin.', code: 'deactivated' });
  }
  if (hasPassword(rec)) {
    if (!password) return res.status(401).json({ error: 'Enter your password.', code: 'password_required' });
    if (!verifyPassword(password, rec.password_hash)) {
      recordFailure(keys);
      logLoginEvent({ ...meta, userId: rec.id, success: false });
      return res.status(401).json({ error: 'Incorrect password.', code: 'wrong_password' });
    }
  }
  clearFailures(keys);
  logLoginEvent({ ...meta, userId: rec.id, success: true });
  setSessionCookie(res, createSession(rec.id));
  res.json({ user: { id: rec.id, username: rec.username, display_name: rec.display_name, role: rec.role, has_password: hasPassword(rec) } });
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
  // An email-only account has no current password to check — this is where it adds one.
  if (!rec || (hasPassword(rec) && !verifyPassword(String(current_password || ''), rec.password_hash))) {
    return res.status(400).json({ error: 'Current password is incorrect.' });
  }
  const bad = validatePassword(new_password);
  if (bad) return res.status(400).json({ error: bad });
  setPassword(rec.id, new_password);
  deleteUserSessions(rec.id);
  setSessionCookie(res, createSession(rec.id));
  res.json({ ok: true });
});

// ── Open sign-up ────────────────────────────────────────────────────────────
// POST /api/auth/signup — name + email (password optional) creates the account
// and signs the person in. No verification, no email sent: see auth.js for why
// there's no domain rule or auto-admin.
router.post('/signup', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const name = String(req.body?.display_name || '').trim().slice(0, 80);
  const password = String(req.body?.password || '');
  if (!name) return res.status(400).json({ error: 'Please enter your name.' });
  if (email.length > 254 || !EMAIL_RE.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
  if (password) { const bad = validatePassword(password); if (bad) return res.status(400).json({ error: bad }); }
  if (signupThrottled(req.ip)) return res.status(429).json({ error: 'Too many sign-ups from here. Try again in a little while.' });
  if (emailInUse(email)) return res.status(409).json({ error: 'That email already has an account — sign in instead.', code: 'exists' });

  const user = createUser({ username: email, displayName: name, password: password || null, role: 'user', email });
  logLoginEvent({ userId: user.id, username: email, success: true, ip: req.ip, userAgent: req.headers['user-agent'] });
  setSessionCookie(res, createSession(user.id));
  res.status(201).json({ user: { id: user.id, username: user.username, display_name: user.display_name, role: user.role, has_password: !!password } });
});

export default router;
