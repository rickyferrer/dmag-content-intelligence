import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';

const cardStyle = {
  width: 340, background: 'var(--bg-surface)', border: '1px solid var(--border)',
  borderRadius: 8, padding: 28, display: 'flex', flexDirection: 'column', gap: 14,
};
const lbl = { fontSize: 12, color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 4 };
const primaryBtn = (busy) => ({
  padding: '8px 14px', borderRadius: 4, border: 'none', fontWeight: 500,
  background: 'var(--accent-gold)', color: '#fff', cursor: busy ? 'default' : 'pointer',
});
const linkBtn = { background: 'none', border: 'none', padding: 0, fontSize: 12, color: 'var(--text-secondary)', textDecoration: 'underline', textAlign: 'left', cursor: 'pointer' };
const hint = { fontSize: 11, color: 'var(--text-muted)' };

function Brand() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
      <img src="/logo/d-logo.png" alt="D Magazine" style={{ height: 32, width: 32, borderRadius: 4 }} />
      <span style={{ fontSize: 11, color: 'var(--accent-gold)', fontWeight: 500, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
        Content Intelligence
      </span>
    </div>
  );
}

// Open sign-up: anyone can create an account with a name and email; a
// password is optional. Sign-in asks for a password only when that account
// has one (the server tells us, so email-only people just type their email).
export default function Login() {
  const { login, signup } = useAuth();
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [needsPassword, setNeedsPassword] = useState(false);
  const [error, setError] = useState(null);
  const [noAccount, setNoAccount] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = (fn) => async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNoAccount(false);
    try { await fn(); } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  const signIn = run(async () => {
    try {
      await login(email.trim(), password);
    } catch (err) {
      if (err.code === 'password_required') { setNeedsPassword(true); setError(password ? err.message : null); return; }
      if (err.code === 'no_account') setNoAccount(true);
      throw err;
    }
  });
  const createAccount = run(() => signup(email.trim(), name.trim(), password));
  const switchMode = (m) => { setMode(m); setError(null); setNoAccount(false); setNeedsPassword(false); setPassword(''); };

  if (mode === 'signup') {
    return (
      <Screen>
        <form onSubmit={createAccount} style={cardStyle}>
          <Brand />
          <label style={lbl}>Your name<input value={name} onChange={e => setName(e.target.value)} autoFocus required maxLength={80} /></label>
          <label style={lbl}>Email<input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" required /></label>
          <label style={lbl}>Password <span style={hint}>(optional, 10+ characters)</span>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" minLength={10} />
          </label>
          <div style={hint}>Without a password, anyone who knows your email can sign in as you. Add one to keep your goals and Insights history private.</div>
          {error && <div role="alert" style={{ fontSize: 12, color: '#e05c5c' }}>{error}</div>}
          <button type="submit" disabled={busy || !email || !name} style={primaryBtn(busy)}>{busy ? 'Creating…' : 'Create account'}</button>
          <button type="button" onClick={() => switchMode('signin')} style={linkBtn}>Already have an account? Sign in</button>
        </form>
      </Screen>
    );
  }

  return (
    <Screen>
      <form onSubmit={signIn} style={cardStyle}>
        <Brand />
        <label style={lbl}>
          Email or username
          <input value={email} onChange={e => { setEmail(e.target.value); setNeedsPassword(false); }} autoFocus autoComplete="username" required />
        </label>
        {needsPassword && (
          <label style={lbl}>
            Password
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" autoFocus required />
          </label>
        )}
        {error && <div role="alert" style={{ fontSize: 12, color: '#e05c5c' }}>{error}</div>}
        <button type="submit" disabled={busy || !email || (needsPassword && !password)} style={primaryBtn(busy)}>
          {busy ? 'Signing in…' : needsPassword ? 'Sign in' : 'Continue'}
        </button>
        <button type="button" onClick={() => switchMode('signup')} style={linkBtn}>
          {noAccount ? 'Create an account with this email' : 'New here? Create an account'}
        </button>
      </form>
    </Screen>
  );
}

function Screen({ children }) {
  return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>{children}</div>;
}
