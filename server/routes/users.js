import { Router } from 'express';
import { logAudit } from '../db.js';
import {
  listUsers, getUserById, getUserRecordByUsername, createUser, updateUser, setPassword,
  deleteUser, deleteUserSessions, validatePassword, countActiveAdmins,
  getUsageStats, getRecentLoginEvents,
} from '../authDb.js';

// Mounted behind requireAdmin (see index.js).
const router = Router();
const ROLES = new Set(['admin', 'user']);
const USERNAME_RE = /^[A-Za-z0-9._@-]{3,64}$/;

// Each user carries their usage: last_active_at, visits_30d, visits_total,
// logins_total (a "visit" = a stretch of activity; see touchVisit in authDb.js).
router.get('/', (req, res) => {
  const usage = getUsageStats();
  res.json(listUsers().map(u => ({
    ...u,
    last_active_at: usage[u.id]?.last_active_at || null,
    visits_30d: usage[u.id]?.visits_30d || 0,
    visits_total: usage[u.id]?.visits_total || 0,
    logins_total: usage[u.id]?.logins_total || 0,
  })));
});

// GET /api/users/logins — recent sign-in attempts, newest first (incl. failures).
router.get('/logins', (req, res) => {
  res.json(getRecentLoginEvents(Math.min(200, Number(req.query.limit) || 50)));
});

router.post('/', (req, res) => {
  const { username, display_name, password, role = 'user' } = req.body || {};
  if (!USERNAME_RE.test(String(username || ''))) return res.status(400).json({ error: 'Username must be 3–64 characters: letters, numbers, . _ @ -' });
  if (!ROLES.has(role)) return res.status(400).json({ error: 'Role must be "admin" or "user".' });
  const bad = validatePassword(password);
  if (bad) return res.status(400).json({ error: bad });
  if (getUserRecordByUsername(username)) return res.status(409).json({ error: 'That username is already taken.' });
  const user = createUser({ username, displayName: String(display_name || '').trim() || username, password, role });
  logAudit(req.user.username, 'create_user', { username: user.username, role: user.role });
  res.status(201).json(user);
});

// PUT /api/users/:id — display name, role, active. Never leaves zero active admins.
router.put('/:id', (req, res) => {
  const id = Number(req.params.id);
  const cur = getUserById(id);
  if (!cur) return res.status(404).json({ error: 'User not found' });
  const { display_name, role, active } = req.body || {};
  if (role !== undefined && !ROLES.has(role)) return res.status(400).json({ error: 'Role must be "admin" or "user".' });
  const losesAdmin = cur.role === 'admin' && cur.active && ((role && role !== 'admin') || active === false);
  if (losesAdmin && countActiveAdmins() <= 1) return res.status(400).json({ error: 'There must be at least one active admin.' });
  const user = updateUser(id, { displayName: display_name, role, active });
  if (active === false) deleteUserSessions(id);
  logAudit(req.user.username, 'update_user', { username: user.username, role: user.role, active: !!user.active });
  res.json(user);
});

// POST /api/users/:id/password — admin reset; signs that user out everywhere.
router.post('/:id/password', (req, res) => {
  const id = Number(req.params.id);
  const cur = getUserById(id);
  if (!cur) return res.status(404).json({ error: 'User not found' });
  const bad = validatePassword(req.body?.password);
  if (bad) return res.status(400).json({ error: bad });
  setPassword(id, req.body.password);
  deleteUserSessions(id);
  logAudit(req.user.username, 'reset_password', { username: cur.username });
  res.json({ ok: true });
});

// DELETE /api/users/:id — removes the login; their goals/insight history stay in the database, unreachable.
router.delete('/:id', (req, res) => {
  const id = Number(req.params.id);
  const cur = getUserById(id);
  if (!cur) return res.status(404).json({ error: 'User not found' });
  if (id === req.user.id) return res.status(400).json({ error: "You can't delete your own account." });
  if (cur.role === 'admin' && cur.active && countActiveAdmins() <= 1) return res.status(400).json({ error: 'There must be at least one active admin.' });
  deleteUser(id);
  logAudit(req.user.username, 'delete_user', { username: cur.username });
  res.json({ ok: true });
});

export default router;
