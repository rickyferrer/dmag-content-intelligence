import React, { useState } from 'react';
import { api } from '../api/index.js';

// Admin-only: backfill single-issue sales from before the live Shopify sync's
// 60-day reach, from the Analytics report "Net items sold by day" (Day, Product
// title, Net items sold). Choosing a file previews what it would do; nothing is
// saved until Import is pressed. Re-importing replaces the earlier import.
export default function ShopifyImport() {
  const [text, setText] = useState(null);
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const choose = async (e) => {
    const file = e.target.files?.[0];
    setPreview(null); setError(''); setSaved(false);
    if (!file) return;
    setFileName(file.name);
    setBusy(true);
    try {
      const body = await file.text();
      setText(body);
      setPreview(await api.importShopifyHistory(body, true));
    } catch (err) {
      setError(err.message);
      setText(null);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true); setError('');
    try {
      setPreview(await api.importShopifyHistory(text, false));
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const unmapped = preview?.products.filter(p => !p.issue) || [];
  const mapped = preview?.products.filter(p => p.issue) || [];

  return (
    <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border-subtle)' }}>
      <h4 style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 4 }}>Import Shopify sales history</h4>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
        Shopify only lets the live sync see the last 60 days. For older single-issue sales, export the
        Analytics report <em>Net items sold by day</em> (Jan 1, 2026 to today) and choose the CSV here. Run the
        Shopify sync first; days the live sync already covers are skipped.
      </p>
      <input type="file" accept=".csv,text/csv" onChange={choose} disabled={busy} style={{ fontSize: 12 }} />
      {busy && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>Working…</div>}
      {error && <div style={{ fontSize: 12, color: '#d9534f', marginTop: 8 }}>{error}</div>}

      {preview && (
        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text-secondary)' }}>
          <div style={{ marginBottom: 8 }}>
            <strong>{preview.units.toLocaleString()}</strong> units across {preview.products.length} products,{' '}
            {preview.from} to before {preview.before}
            {!preview.liveSyncSeen && ' (no live sync yet — run it first for an exact cutoff)'}
            {preview.skipped > 0 && ` · ${preview.skipped} rows skipped (after that date)`}
          </div>
          <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 4 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <tbody>
                {[...mapped, ...unmapped].map(p => (
                  <tr key={p.title} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '4px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{p.units}</td>
                    <td style={{ padding: '4px 8px' }}>{p.title}</td>
                    <td style={{ padding: '4px 8px', color: p.issue ? 'var(--text-muted)' : '#e8a33d', fontFamily: 'var(--font-mono)' }}>
                      {p.issue || 'not an issue — no score'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {saved ? (
            <div style={{ marginTop: 10, color: 'var(--text-primary)', fontWeight: 600 }}>
              ✓ Imported {preview.rows} product-day rows from {fileName}. Reload the Publications tab to see them.
            </div>
          ) : (
            <button
              onClick={save}
              disabled={busy}
              style={{
                marginTop: 10, padding: '7px 14px', borderRadius: 4, fontSize: 12,
                background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)',
                opacity: busy ? 0.6 : 1,
              }}
            >
              Import {preview.units.toLocaleString()} units
            </button>
          )}
        </div>
      )}
    </div>
  );
}
