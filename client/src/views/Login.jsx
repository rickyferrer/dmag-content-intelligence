import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api/index.js';

export const cardStyle = {
  width: 340, background: 'var(--bg-surface)', border: '1px solid var(--border)',
  borderRadius: 8, padding: 28, display: 'flex', flexDirection: 'column', gap: 14,
};
export const lbl = { fontSize: 12, color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 4 };
export const primaryBtn = (busy) => ({
  padding: '8px 14px', borderRadius: 4, border: 'none', fontWeight: 500,
  background: 'var(--accent-gold)', color: '#fff', cursor: busy ? 'default' : 'pointer',
});
export const linkBtn = { background: 'none', border: 'none', padding: 0, fontSize: 12, color: 'var(--text-secondary)', textDecoration: 'underline', textAlign: 'left', cursor: 'pointer' };

export function Brand() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
      <img src="/logo/d-logo.png" alt="D Magazine" style={{ height: 32, width: 32, borderRadius: 4 }} />
      <span style={{ fontSize: 11, color: 'var(--accent-gold)', fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
        Content Intelligence
      </span>
    </div>
  );
}

export function Screen({ children }) {
  return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>{children}</div>;
}

export default function Login() {
  const { login } = useAuth();
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup'
  const [config, setConfig] = useState(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(null);

  useEffect(() => { api.authConfig().then(setConfig).catch(() => setConfig({ signup_enabled: false })); }, []);

  const run = (fn) => async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try { await fn(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  const signIn = run(() => login(username.trim(), password));
  const requestSignup = run(async () => setSent((await api.signup(username.trim(), name.trim())).message));
  const switchMode = (m) => { setMode(m); setError(null); setSent(null); };

  if (mode === 'signup') {
    return (
      <Screen>
        <form onSubmit={requestSignup} style={cardStyle}>
          <Brand />
          {sent ? (
            <>
              <div style={{ fontSize: 14, color: 'var(--text-primary)', fontWeight: 500 }}>Check your email</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{sent}</div>
              <button type="button" onClick={() => switchMode('signin')} style={linkBtn}>Back to sign in</button>
            </>
          ) : (
            <>
              <label style={lbl}>Your name<input value={name} onChange={e => setName(e.target.value)} autoFocus required maxLength={80} /></label>
              <label style={lbl}>Work email<input type="email" value={username} onChange={e => setUsername(e.target.value)} autoComplete="email" required /></label>
              {config?.signup_domains && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  Open to {config.signup_domains.map(d => '@' + d).join(', ')} addresses. We'll email you a link to confirm it and choose a password.
                </div>
              )}
              {error && <div role="alert" style={{ fontSize: 12, color: '#e05c5c' }}>{error}</div>}
              <button type="submit" disabled={busy || !username || !name} style={primaryBtn(busy)}>{busy ? 'Sending…' : 'Email me a link'}</button>
              <button type="button" onClick={() => switchMode('signin')} style={linkBtn}>Already have an account? Sign in</button>
            </>
          )}
        </form>
      </Screen>
    );
  }

  return (
    <Screen>
      <form onSubmit={signIn} style={cardStyle}>
        <Brand />
        <label style={lbl}>
          Username or email
          <input value={username} onChange={e => setUsername(e.target.value)} autoFocus autoComplete="username" required />
        </label>
        <label style={lbl}>
          Password
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        {error && <div role="alert" style={{ fontSize: 12, color: '#e05c5c' }}>{error}</div>}
        <button type="submit" disabled={busy || !username || !password} style={primaryBtn(busy)}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        {config?.signup_enabled
          ? <button type="button" onClick={() => switchMode('signup')} style={linkBtn}>New here? Create an account</button>
          : <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Need an account? Ask an admin to create one for you.</div>}
      </form>
    </Screen>
  );
}
