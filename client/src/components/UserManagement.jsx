import React, { useEffect, useState } from 'react';
import { api } from '../api/index.js';
import { useAuth } from '../context/AuthContext.jsx';

// SQLite's datetime('now') is UTC without a zone marker; everything else here is ISO. Show both in the viewer's local time.
function fmtWhen(s) {
  if (!s) return '—';
  const d = new Date(s.includes('T') ? s : s.replace(' ', 'T') + 'Z');
  return isNaN(d) ? s : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Admin-only (the server enforces it; Settings only renders this for admins).
export default function UserManagement() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ username: '', display_name: '', password: '', role: 'user' });
  const [busy, setBusy] = useState(false);
  const [logins, setLogins] = useState([]);
  const [showLogins, setShowLogins] = useState(false);

  const load = () => {
    api.listUsers().then(setUsers).catch(e => setError(e.message));
    api.listLogins().then(setLogins).catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const run = async (fn) => {
    setError(null);
    try { await fn(); await load(); } catch (e) { setError(e.message); }
  };

  const add = async (e) => {
    e.preventDefault();
    setBusy(true);
    await run(async () => {
      await api.createUser(form);
      setForm({ username: '', display_name: '', password: '', role: 'user' });
    });
    setBusy(false);
  };

  const resetPassword = (u) => {
    const pw = window.prompt(`New password for ${u.username} (10+ characters). They'll be signed out everywhere.`);
    if (pw) run(() => api.resetUserPassword(u.id, pw));
  };
  const remove = (u) => {
    if (window.confirm(`Delete ${u.username}? Their login is removed; their goals and Insights history stay in the database but become inaccessible.`)) {
      run(() => api.deleteUser(u.id));
    }
  };

  const cell = { padding: '8px 10px', fontSize: 13, color: 'var(--text-secondary)' };
  const small = { fontSize: 11, padding: '3px 8px' };

  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 24, gridColumn: '1 / -1' }}>
      <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 18, marginBottom: 4, color: 'var(--text-primary)' }}>Users</h3>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
        Everyone signs in with their own account and keeps their own goals and Insights history.
        Only admins can see Settings (scoring weights, syncs, exclusions) and manage users.
      </p>

      {error && <div role="alert" style={{ fontSize: 12, color: '#e05c5c', marginBottom: 10 }}>{error}</div>}

      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 20 }}>
        <thead>
          <tr style={{ borderBottom: '2px solid var(--border)', textAlign: 'left' }}>
            {['User', 'Role', 'Status', 'Last active', 'Visits (30d)', 'Visits (all)', 'Sign-ins', ''].map(h => <th key={h} style={{ ...cell, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {users.map(u => {
            const self = u.id === me.id;
            return (
              <tr key={u.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <td style={cell}><strong style={{ color: 'var(--text-primary)' }}>{u.display_name}</strong> <span style={{ color: 'var(--text-muted)' }}>@{u.username}</span></td>
                <td style={cell}>
                  <select value={u.role} disabled={self} onChange={e => run(() => api.updateUser(u.id, { role: e.target.value }))}>
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                </td>
                <td style={{ ...cell, color: u.active ? '#4caf86' : 'var(--text-muted)' }}>{u.active ? 'Active' : 'Deactivated'}</td>
                <td style={cell} title={u.last_login_at ? `Last sign-in: ${fmtWhen(u.last_login_at)}` : 'Has never signed in'}>{u.last_active_at ? fmtWhen(u.last_active_at) : 'never'}</td>
                <td style={cell}>{u.visits_30d}</td>
                <td style={cell}>{u.visits_total}</td>
                <td style={cell}>{u.logins_total}</td>
                <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button style={small} onClick={() => resetPassword(u)}>Reset password</button>{' '}
                  {!self && <button style={small} onClick={() => run(() => api.updateUser(u.id, { active: !u.active }))}>{u.active ? 'Deactivate' : 'Reactivate'}</button>}{' '}
                  {!self && <button style={{ ...small, color: '#e05c5c' }} onClick={() => remove(u)}>Delete</button>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: -10, marginBottom: 16 }}>
        A visit is a stretch of activity — a new one starts after 30 minutes of silence. Background refreshes of an open tab don't count.{' '}
        <button type="button" onClick={() => setShowLogins(v => !v)} style={{ fontSize: 11, padding: '2px 8px' }}>
          {showLogins ? 'Hide' : 'Show'} recent sign-ins
        </button>
      </div>
      {showLogins && (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 20 }}>
          <tbody>
            {logins.length === 0 && <tr><td style={cell}>No sign-ins recorded yet.</td></tr>}
            {logins.map(e => (
              <tr key={e.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <td style={cell}>{fmtWhen(e.at)}</td>
                <td style={cell}>@{e.username}</td>
                <td style={{ ...cell, color: e.success ? '#4caf86' : '#e05c5c' }}>{e.success ? 'Signed in' : 'Failed attempt'}</td>
                <td style={{ ...cell, fontFamily: 'var(--font-mono)', fontSize: 12 }}>{e.ip || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form onSubmit={add} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={lbl}>Username<input value={form.username} onChange={e => setForm(f => ({ ...f, username: e.target.value }))} required autoComplete="off" /></label>
        <label style={lbl}>Display name<input value={form.display_name} onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))} autoComplete="off" /></label>
        <label style={lbl}>Temporary password<input type="text" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} required minLength={10} autoComplete="off" placeholder="10+ characters" /></label>
        <label style={lbl}>Role
          <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))}>
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </select>
        </label>
        <button type="submit" disabled={busy}>Add user</button>
      </form>
    </div>
  );
}
const lbl = { fontSize: 12, color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 4 };
