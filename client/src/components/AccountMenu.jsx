import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api/index.js';
import { useAuth } from '../context/AuthContext.jsx';

// Header account control: who's signed in, change own password, sign out.
export default function AccountMenu() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [changing, setChanging] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)} style={{
        background: 'transparent', border: '1px solid var(--border)', borderRadius: 4,
        padding: '4px 10px', fontSize: 12, color: 'var(--text-secondary)',
      }}>
        {user.display_name || user.username}{user.role === 'admin' ? ' · admin' : ''}
      </button>
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: '120%', minWidth: 170, zIndex: 60,
          background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6,
          boxShadow: '0 4px 16px rgba(0,0,0,0.15)', padding: 4, display: 'flex', flexDirection: 'column',
        }}>
          <button onClick={() => { setOpen(false); setChanging(true); }} style={menuItem}>{user.has_password ? 'Change password' : 'Set a password'}</button>
          <button onClick={logout} style={menuItem}>Sign out</button>
        </div>
      )}
      {changing && <ChangePassword hasPassword={user.has_password} onClose={() => setChanging(false)} />}
    </div>
  );
}

const menuItem = { background: 'transparent', border: 'none', textAlign: 'left', padding: '7px 10px', fontSize: 12, color: 'var(--text-primary)', borderRadius: 4 };

function ChangePassword({ onClose, hasPassword }) {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try { await api.changePassword(cur, next); setDone(true); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onMouseDown={onClose}>
      <form onSubmit={submit} onMouseDown={e => e.stopPropagation()} style={{ width: 320, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--text-primary)' }}>{hasPassword ? 'Change password' : 'Set a password'}</h3>
        {done ? (
          <>
            <div style={{ fontSize: 13, color: '#4caf86' }}>Password saved. Your other sessions were signed out.</div>
            <button type="button" onClick={onClose}>Close</button>
          </>
        ) : (
          <>
            {hasPassword
              ? <label style={lbl}>Current password<input type="password" value={cur} onChange={e => setCur(e.target.value)} autoComplete="current-password" required /></label>
              : <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>You signed up with just your email, so anyone who knows it can sign in as you. A password stops that.</div>}
            <label style={lbl}>New password (10+ characters)<input type="password" value={next} onChange={e => setNext(e.target.value)} autoComplete="new-password" required minLength={10} /></label>
            {error && <div role="alert" style={{ fontSize: 12, color: '#e05c5c' }}>{error}</div>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={onClose}>Cancel</button>
              <button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
const lbl = { fontSize: 12, color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 4 };
