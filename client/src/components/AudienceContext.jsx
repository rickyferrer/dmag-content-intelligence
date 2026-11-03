import React, { useEffect, useState } from 'react';
import { api } from '../api/index.js';

// Admin-only: the audience description the Coverage Gaps report is judged
// against (who D's readers are, the personas, what they love and dislike). It
// is internal strategy text, so it lives in the database, not the code. Paste
// it or load it from a .txt/.md file, then Save; the next report uses it.
export default function AudienceContext() {
  const [text, setText] = useState('');
  const [saved, setSaved] = useState('');
  const [max, setMax] = useState(12000);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api.getAudienceContext()
      .then(r => { setText(r.text); setSaved(r.text); setMax(r.maxChars); })
      .catch(err => setError(err.message));
  }, []);

  const loadFile = async (e) => {
    const file = e.target.files?.[0];
    if (file) { setText(await file.text()); setMsg(''); }
  };

  const save = async () => {
    setBusy(true); setError(''); setMsg('');
    try {
      const r = await api.saveAudienceContext(text);
      setText(r.text); setSaved(r.text);
      setMsg('Saved. The next Coverage Gaps report will use it.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const dirty = text.trim() !== saved.trim();
  return (
    <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border-subtle)' }}>
      <h4 style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 4 }}>Audience context</h4>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
        Who D's readers are and what they want: personas, what they love and what frustrates them. The Coverage Gaps
        report uses it to rank gaps and tailor angles. Kept in the database, not the code. Empty means the report
        runs without an audience lens.
      </p>
      <input type="file" accept=".txt,.md,text/plain" onChange={loadFile} disabled={busy} style={{ fontSize: 12, marginBottom: 8 }} />
      <textarea
        value={text}
        onChange={e => { setText(e.target.value); setMsg(''); }}
        rows={12}
        style={{
          width: '100%', boxSizing: 'border-box', fontSize: 12, lineHeight: 1.5, padding: 10, borderRadius: 4,
          background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)',
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
        <button
          onClick={save}
          disabled={busy || !dirty || text.length > max}
          style={{
            padding: '7px 14px', borderRadius: 4, fontSize: 12,
            background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)',
            opacity: busy || !dirty ? 0.6 : 1,
          }}
        >
          Save audience context
        </button>
        <span style={{ fontSize: 11, color: text.length > max ? '#d9534f' : 'var(--text-muted)' }}>{text.length.toLocaleString()} / {max.toLocaleString()}</span>
        {msg && <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>{msg}</span>}
        {error && <span style={{ fontSize: 12, color: '#d9534f' }}>{error}</span>}
      </div>
    </div>
  );
}
