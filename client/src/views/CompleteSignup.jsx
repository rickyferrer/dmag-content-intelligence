import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api/index.js';
import { Screen, Brand, cardStyle, lbl, primaryBtn, linkBtn } from './Login.jsx';

// Landing page for the emailed link (?signup=TOKEN). Looking up the link is
// read-only; the account is only created when the person submits a password.
export default function CompleteSignup({ token, onDone }) {
  const { completeSignup } = useAuth();
  const [info, setInfo] = useState(undefined); // undefined = loading, null = invalid
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.signupInfo(token).then(setInfo).catch(() => setInfo(null)); }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    if (password !== confirm) return setError("Those passwords don't match.");
    setBusy(true);
    setError(null);
    try {
      await completeSignup(token, password);
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  if (info === undefined) return <Screen><div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Checking your link…</div></Screen>;

  return (
    <Screen>
      <form onSubmit={submit} style={cardStyle}>
        <Brand />
        {info === null ? (
          <>
            <div style={{ fontSize: 13, color: '#e05c5c' }}>This link is invalid or has expired.</div>
            <button type="button" onClick={onDone} style={linkBtn}>Back to sign in to request a new one</button>
          </>
        ) : (
          <>
            <div>
              <div style={{ fontSize: 14, color: 'var(--text-primary)', fontWeight: 500 }}>Welcome, {info.display_name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Confirming {info.email} — choose a password to finish.</div>
            </div>
            <label style={lbl}>Password (10+ characters)<input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" autoFocus required minLength={10} /></label>
            <label style={lbl}>Confirm password<input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" required minLength={10} /></label>
            {error && <div role="alert" style={{ fontSize: 12, color: '#e05c5c' }}>{error}</div>}
            <button type="submit" disabled={busy || !password} style={primaryBtn(busy)}>{busy ? 'Creating account…' : 'Create account'}</button>
          </>
        )}
      </form>
    </Screen>
  );
}
