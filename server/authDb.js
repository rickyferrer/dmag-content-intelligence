import Database from 'better-sqlite3';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

// Accounts and sessions live in their OWN SQLite file, next to content.db.
// Deliberate: the Insights assistant can run arbitrary SELECTs against
// content.db, and password hashes / session tokens must never be reachable
// from there — a separate file makes that physically impossible (ATTACH is
// already forbidden in insights.js), instead of relying on a blocklist alone.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONTENT_DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'content.db');
const AUTH_DB_PATH = process.env.AUTH_DB_PATH || path.join(path.dirname(CONTENT_DB_PATH), 'auth.db');

export const SESSION_DAYS = 30;
export const MIN_PASSWORD_LENGTH = 10;

let db;
export function getAuthDb() {
  if (!db) {
    db = new Database(AUTH_DB_PATH);
    db.pragma('journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS app_users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
        display_name  TEXT,
        password_hash TEXT NOT NULL,
        role          TEXT NOT NULL DEFAULT 'user',
        active        INTEGER NOT NULL DEFAULT 1,
        created_at    TEXT DEFAULT CURRENT_TIMESTAMP,
        last_login_at TEXT
      );
      -- Only a SHA-256 of the session token is stored, so a leaked database
      -- file can't be replayed as live sessions.
      CREATE TABLE IF NOT EXISTS app_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_app_sessions_user ON app_sessions(user_id);
    `);
    db.pragma('foreign_keys = ON');
  }
  return db;
}

// ── Passwords (scrypt, per-user random salt) ────────────────────────────────
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [scheme, saltHex, hashHex] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

// Burned against when a username doesn't exist, so a wrong username and a
// wrong password take the same time to reject (no account enumeration).
const DUMMY_HASH = hashPassword('dummy-password-for-timing');
export function verifyAgainstDummy(password) { verifyPassword(password, DUMMY_HASH); }

export function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

// ── Users ───────────────────────────────────────────────────────────────────
const PUBLIC_COLS = 'id, username, display_name, role, active, created_at, last_login_at';

export const listUsers = () => getAuthDb().prepare(`SELECT ${PUBLIC_COLS} FROM app_users ORDER BY role = 'admin' DESC, username`).all();
export const getUserById = (id) => getAuthDb().prepare(`SELECT ${PUBLIC_COLS} FROM app_users WHERE id = ?`).get(id);
export const getUserRecordByUsername = (username) => getAuthDb().prepare('SELECT * FROM app_users WHERE username = ?').get(username);
export const countUsers = () => getAuthDb().prepare('SELECT COUNT(*) AS n FROM app_users').get().n;
export const countActiveAdmins = () => getAuthDb().prepare("SELECT COUNT(*) AS n FROM app_users WHERE role = 'admin' AND active = 1").get().n;

export function createUser({ username, displayName, password, role = 'user' }) {
  const r = getAuthDb().prepare(
    'INSERT INTO app_users (username, display_name, password_hash, role) VALUES (?, ?, ?, ?)'
  ).run(username, displayName || username, hashPassword(password), role);
  return getUserById(r.lastInsertRowid);
}

export function updateUser(id, { displayName, role, active }) {
  const cur = getUserById(id);
  if (!cur) return null;
  getAuthDb().prepare('UPDATE app_users SET display_name = ?, role = ?, active = ? WHERE id = ?').run(
    displayName ?? cur.display_name, role ?? cur.role, active === undefined ? cur.active : (active ? 1 : 0), id
  );
  return getUserById(id);
}

export function setPassword(id, password) {
  getAuthDb().prepare('UPDATE app_users SET password_hash = ? WHERE id = ?').run(hashPassword(password), id);
}

export function deleteUser(id) {
  getAuthDb().prepare('DELETE FROM app_users WHERE id = ?').run(id);
}

// ── Sessions ────────────────────────────────────────────────────────────────
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const isoIn = (days) => new Date(Date.now() + days * 86400000).toISOString();

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  getAuthDb().prepare('INSERT INTO app_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(sha256(token), userId, isoIn(SESSION_DAYS));
  getAuthDb().prepare("UPDATE app_users SET last_login_at = datetime('now') WHERE id = ?").run(userId);
  getAuthDb().prepare("DELETE FROM app_sessions WHERE expires_at < ?").run(new Date().toISOString());
  return token;
}

// Returns the active user behind a session token, or null. Sliding: a
// session with under 25 of its 30 days left is pushed back out to 30.
export function getSessionUser(token) {
  if (!token) return null;
  const th = sha256(token);
  const row = getAuthDb().prepare(`
    SELECT s.expires_at, u.id, u.username, u.display_name, u.role, u.active
    FROM app_sessions s JOIN app_users u ON u.id = s.user_id
    WHERE s.token_hash = ?
  `).get(th);
  if (!row || !row.active || row.expires_at < new Date().toISOString()) return null;
  if (row.expires_at < isoIn(SESSION_DAYS - 5)) {
    getAuthDb().prepare('UPDATE app_sessions SET expires_at = ? WHERE token_hash = ?').run(isoIn(SESSION_DAYS), th);
  }
  return { id: row.id, username: row.username, display_name: row.display_name, role: row.role };
}

export const deleteSession = (token) => getAuthDb().prepare('DELETE FROM app_sessions WHERE token_hash = ?').run(sha256(token));
export const deleteUserSessions = (userId) => getAuthDb().prepare('DELETE FROM app_sessions WHERE user_id = ?').run(userId);
