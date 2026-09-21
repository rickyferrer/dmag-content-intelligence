import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <form onSubmit={submit} style={{
        width: 340, background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 8, padding: 28, display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <img src="/logo/d-logo.png" alt="D Magazine" style={{ height: 32, width: 32, borderRadius: 4 }} />
          <span style={{ fontSize: 11, color: 'var(--accent-gold)', fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Content Intelligence
          </span>
        </div>
        <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 4 }}>
          Username
          <input value={username} onChange={e => setUsername(e.target.value)} autoFocus autoComplete="username" required />
        </label>
        <label style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 4 }}>
          Password
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        {error && <div role="alert" style={{ fontSize: 12, color: '#e05c5c' }}>{error}</div>}
        <button type="submit" disabled={busy || !username || !password} style={{
          padding: '8px 14px', borderRadius: 4, border: 'none', fontWeight: 500,
          background: 'var(--accent-gold)', color: '#fff', cursor: busy ? 'default' : 'pointer',
        }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Need an account? Ask an admin to create one for you.</div>
      </form>
    </div>
  );
}
