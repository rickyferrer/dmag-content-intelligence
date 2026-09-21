import { Router } from 'express';
import {
  getUserRecordByUsername, verifyPassword, verifyAgainstDummy, createSession, deleteSession,
  setPassword, deleteUserSessions, validatePassword, logLoginEvent,
} from '../authDb.js';
import {
  setSessionCookie, clearSessionCookie, sessionTokenOf, requireAuth,
  isThrottled, recordFailure, clearFailures,
} from '../auth.js';

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

export default router;
