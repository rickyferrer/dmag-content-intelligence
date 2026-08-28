import React, { useEffect, useState } from 'react';
import { api } from '../api/index.js';

// Mirrors server/utils/trueValue.js's BENCHMARK_META labels/units — kept
// here too since there's no API endpoint that just returns metadata.
const BENCHMARK_LABELS = {
  subCount:      { label: 'Subscribe Clicks',   unit: '' },
  newsCount:     { label: 'Newsletter Signups', unit: '' },
  loyalCount:    { label: 'Loyal Readers',      unit: '' },
  inmarketShare: { label: 'In-Market Share',    unit: '%', scale: 100 },
  engSeconds:    { label: 'Engagement Seconds', unit: 's' },
  adRpm:         { label: 'Ad Revenue / 1,000', unit: '$' },
};

function fmtBenchmarkValue(key, value) {
  if (value == null) return '—';
  const meta = BENCHMARK_LABELS[key] || {};
  const n = meta.scale ? value * meta.scale : value;
  const rounded = Number.isInteger(n) ? n : n.toFixed(meta.scale ? 0 : 2);
  return meta.unit === '$' ? `$${rounded}` : `${rounded}${meta.unit}`;
}

const WEIGHT_META = {
  score_w_subscription: { label: "Subscribe Clicks",       min: 0, max: 100, step: 1, desc: "Total subscribe clicks (raw count). 5 clicks = full score. More clicks = higher score." },
  score_w_loyal:        { label: "Loyal Readers",          min: 0, max: 100, step: 1, desc: "Total loyal (repeat, 3+ sessions/30 days) readers (raw count). 1,400 readers = full score — set near the best story we've seen, so a full score means genuinely exceptional. More loyal readers = higher score, regardless of total audience size." },
  score_w_inmarket:     { label: "In-Market (DFW) Readers",min: 0, max: 100, step: 1, desc: "Share of audience located in the DFW area — independent of loyalty (rate - quality signal)." },
  score_w_newsletter:   { label: "Newsletter Signups",     min: 0, max: 100, step: 1, desc: "Total newsletter signups (raw count). 5 signups = full score. More signups = higher score." },
  score_w_engagement:   { label: "Engagement",             min: 0, max: 100, step: 1, desc: "Avg reading time (rate - quality signal, not total time)." },
  score_w_ad_revenue:   { label: "Ad Revenue",             min: 0, max: 100, step: 1, desc: "Potential ad revenue per 1,000 readers — ad impressions × $10 CPM, not real tracked revenue. Kept small so the score isn’t just pageviews." },
  score_confidence_k:   { label: "Confidence Threshold",   min: 0, max: 1000,step: 25,desc: "Readers needed before an article earns full score. Prevents a 1-signup article from 50 readers beating a 3-signup article from 5,000." },
};

export default function Settings() {
  const [settings, setSettings] = useState({});
  const [dirty, setDirty] = useState({});
  const [saving, setSaving] = useState(false);
  const [recalculating, setRecalculating] = useState(false);
  const [syncStatus, setSyncStatus] = useState(null);
  const [triggering, setTriggering] = useState(false);
  const [saved, setSaved] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [cleanResult, setCleanResult] = useState(null);
  const [exclusionText, setExclusionText] = useState('');
  const [exclusionResult, setExclusionResult] = useState(null);
  const [savingExclusions, setSavingExclusions] = useState(false);
  const [cleanupConfirmText, setCleanupConfirmText] = useState('');
  const [auditLog, setAuditLog] = useState([]);
  const [benchmarkChecks, setBenchmarkChecks] = useState({ pending: [], last_checked: null });
  const [runningCheck, setRunningCheck] = useState(false);
  const [benchmarkBusyId, setBenchmarkBusyId] = useState(null);

  const loadAuditLog = () => api.getAuditLog().then(setAuditLog).catch(console.error);
  const loadBenchmarkChecks = () => api.getBenchmarkChecks().then(setBenchmarkChecks).catch(console.error);

  useEffect(() => {
    api.getSettings().then(setSettings).catch(console.error);
    api.getSyncStatus().then(setSyncStatus).catch(console.error);
    api.getExclusions()
      .then(rows => setExclusionText(rows.map(r => r.url).join('\n')))
      .catch(console.error);
    loadAuditLog();
    loadBenchmarkChecks();
  }, []);

  const handleChange = (key, val) => {
    setDirty(d => ({ ...d, [key]: parseFloat(val) }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await api.updateSettings({ ...settings, ...dirty });
      setSettings(res.settings);
      setDirty({});
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      loadAuditLog();
    } catch (err) {
      alert('Save error: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRecalculate = async () => {
    if (!window.confirm('Recalculate Content Value scores for all content using the current weights?')) return;
    setRecalculating(true);
    try {
      await api.recalculateScores();
      setTimeout(() => { setRecalculating(false); loadAuditLog(); }, 3000);
    } catch (err) {
      alert('Recalculation error: ' + err.message);
      setRecalculating(false);
    }
  };

  const handleRunBenchmarkCheck = async () => {
    setRunningCheck(true);
    try {
      await api.runBenchmarkCheck();
      await loadBenchmarkChecks();
    } catch (err) {
      alert('Benchmark check error: ' + err.message);
    } finally {
      setRunningCheck(false);
    }
  };

  const handleApplyBenchmark = async (id) => {
    setBenchmarkBusyId(id);
    try {
      const res = await api.applyBenchmarkCheck(id);
      setSettings(res.settings);
      await loadBenchmarkChecks();
      loadAuditLog();
    } catch (err) {
      alert('Apply error: ' + err.message);
    } finally {
      setBenchmarkBusyId(null);
    }
  };

  const handleDismissBenchmark = async (id) => {
    setBenchmarkBusyId(id);
    try {
      await api.dismissBenchmarkCheck(id);
      await loadBenchmarkChecks();
    } catch (err) {
      alert('Dismiss error: ' + err.message);
    } finally {
      setBenchmarkBusyId(null);
    }
  };

  const handleSaveExclusions = async () => {
    setSavingExclusions(true);
    setExclusionResult(null);
    try {
      const urls = exclusionText.split('\n').map(u => u.trim()).filter(Boolean);
      const result = await api.setExclusions(urls);
      setExclusionResult(result);
      loadAuditLog();
    } catch (err) {
      alert('Error saving exclusions: ' + err.message);
    } finally {
      setSavingExclusions(false);
    }
  };

  // Destructive + irreversible, so this requires typing "DELETE" rather than
  // a single dismissable confirm() dialog — the backend independently
  // requires the same confirmation, so this isn't just a UI nicety.
  const handleCleanup = async () => {
    if (cleanupConfirmText !== 'DELETE') return;
    setCleaning(true);
    setCleanResult(null);
    try {
      const result = await api.cleanupData(2);
      setCleanResult(result);
      setCleanupConfirmText('');
      loadAuditLog();
    } catch (err) {
      alert('Cleanup error: ' + err.message);
    } finally {
      setCleaning(false);
    }
  };

  const handleTriggerSync = async (type) => {
    if (!window.confirm(`Trigger a "${type}" sync now? This runs in the background and may take a while.`)) return;
    setTriggering(true);
    try {
      await api.triggerSync(type);
      setTimeout(async () => {
        const status = await api.getSyncStatus().catch(() => syncStatus);
        setSyncStatus(status);
        setTriggering(false);
        loadAuditLog();
      }, 2000);
    } catch (err) {
      alert('Trigger error: ' + err.message);
      setTriggering(false);
    }
  };

  const vals = { ...settings, ...dirty };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start' }}>
      {/* Content Value Model */}
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 24 }}>
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 20, marginBottom: 4, color: 'var(--text-primary)' }}>
          Content Value Model
        </h3>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
          Each article is scored on how well it converts its readers (per-reader rates vs. a
          benchmark), weighted by strategic priority below — so a niche article that drives
          subscriptions beats a high-traffic article that doesn't. Weights are relative.
          After changing any value, hit <strong>Recalculate All Scores</strong>.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {Object.entries(WEIGHT_META).map(([key, meta]) => {
            const val = vals[key] ?? 0;
            return (
              <div key={key}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>{meta.label}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{meta.desc}</div>
                  </div>
                  <div style={{
                    fontFamily: 'var(--font-mono)', fontSize: 18,
                    color: dirty[key] !== undefined ? 'var(--accent-gold)' : 'var(--text-secondary)',
                    minWidth: 60, textAlign: 'right',
                  }}>
                    {typeof val === 'number' ? val : '—'}
                  </div>
                </div>
                <input
                  type="range"
                  min={meta.min} max={meta.max} step={meta.step}
                  value={val || 0}
                  onChange={e => handleChange(key, e.target.value)}
                  style={{ width: '100%', accentColor: 'var(--accent-gold)' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  <span>{meta.min}</span>
                  <span>{meta.max}</span>
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 24 }}>
          <button
            onClick={handleSave}
            disabled={saving || Object.keys(dirty).length === 0}
            style={{
              padding: '8px 18px', borderRadius: 4, fontSize: 14, fontWeight: 500,
              background: 'var(--accent-gold)', border: 'none', color: '#0f0f0f',
              opacity: (saving || Object.keys(dirty).length === 0) ? 0.5 : 1,
            }}
          >
            {saving ? 'Saving...' : saved ? 'Saved ✓' : 'Save Weights'}
          </button>
          <button
            onClick={handleRecalculate}
            disabled={recalculating}
            style={{
              padding: '8px 18px', borderRadius: 4, fontSize: 14,
              background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)',
              opacity: recalculating ? 0.6 : 1,
            }}
          >
            {recalculating ? 'Recalculating...' : 'Recalculate All Scores'}
          </button>
        </div>
      </div>

      {/* Sync Status */}
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 24 }}>
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 20, marginBottom: 16, color: 'var(--text-primary)' }}>
          Sync Status
        </h3>

        {syncStatus && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
            {Object.entries(syncStatus).map(([key, val]) => (
              <div key={key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{key}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                  {val?.updated_at ? val.updated_at.slice(0, 19).replace('T', ' ') : '—'}
                </span>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {['all', 'content', 'analytics', 'classify'].map(type => (
            <button
              key={type}
              onClick={() => handleTriggerSync(type)}
              disabled={triggering}
              style={{
                padding: '7px 14px', borderRadius: 4, fontSize: 13,
                background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)',
                opacity: triggering ? 0.6 : 1,
              }}
            >
              Trigger {type} sync
            </button>
          ))}
        </div>
      </div>

      {/* Benchmark Recalibration */}
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 24, gridColumn: '1 / -1' }}>
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 20, marginBottom: 4, color: 'var(--text-primary)' }}>
          Benchmark Recalibration
        </h3>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
          Every 30 days, checks whether real content is maxing out a Content Value benchmark far
          more often than it should (too soft — 100 stops meaning "exceptional"), or almost never
          reaching one that's fallen well below the real best-ever result (too hard). Never applies
          a change automatically — review and apply each recommendation below, then hit{' '}
          <strong>Recalculate All Scores</strong> to bring existing scores up to date.
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Last checked: {benchmarkChecks.last_checked ? benchmarkChecks.last_checked.slice(0, 19).replace('T', ' ') : 'never'}
          </span>
          <button
            onClick={handleRunBenchmarkCheck}
            disabled={runningCheck}
            style={{
              padding: '6px 14px', borderRadius: 4, fontSize: 13,
              background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)',
              opacity: runningCheck ? 0.6 : 1,
            }}
          >
            {runningCheck ? 'Checking…' : 'Run Check Now'}
          </button>
        </div>

        {benchmarkChecks.pending.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Nothing flagged — every benchmark is within a healthy range.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {benchmarkChecks.pending.map(row => {
              const meta = BENCHMARK_LABELS[row.benchmark_key] || {};
              const isSoft = row.direction === 'too_soft';
              const badgeColor = isSoft ? '#c0392b' : '#2474bb';
              return (
                <div key={row.id} style={{
                  display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
                  padding: '12px 14px', background: 'var(--bg-elevated)', borderRadius: 6,
                  border: `1px solid ${badgeColor}30`,
                }}>
                  <div style={{ minWidth: 160 }}>
                    <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>{meta.label || row.benchmark_key}</div>
                    <span style={{
                      fontSize: 11, fontWeight: 600, color: badgeColor, background: badgeColor + '18',
                      padding: '2px 6px', borderRadius: 4, textTransform: 'uppercase', letterSpacing: '0.04em',
                    }}>
                      {isSoft ? 'Too Soft' : 'Too Hard'}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                    {isSoft
                      ? <>Capping <strong style={{ color: 'var(--text-primary)' }}>{row.capping_pct.toFixed(1)}%</strong> of {row.sample_size.toLocaleString()} articles at 100</>
                      : <>Never reached across {row.sample_size.toLocaleString()} articles</>}
                  </div>
                  <div style={{ fontSize: 14, fontFamily: 'var(--font-mono)', marginLeft: 'auto', whiteSpace: 'nowrap' }}>
                    <span style={{ color: 'var(--text-muted)' }}>{fmtBenchmarkValue(row.benchmark_key, row.current_value)}</span>
                    <span style={{ color: 'var(--text-muted)', margin: '0 6px' }}>→</span>
                    <span style={{ color: 'var(--accent-gold)' }}>{fmtBenchmarkValue(row.benchmark_key, row.recommended_value)}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={() => handleApplyBenchmark(row.id)}
                      disabled={benchmarkBusyId === row.id}
                      style={{
                        padding: '5px 12px', borderRadius: 4, fontSize: 12, fontWeight: 500,
                        background: 'var(--accent-gold)', border: 'none', color: '#0f0f0f',
                        opacity: benchmarkBusyId === row.id ? 0.6 : 1,
                      }}
                    >
                      Apply
                    </button>
                    <button
                      onClick={() => handleDismissBenchmark(row.id)}
                      disabled={benchmarkBusyId === row.id}
                      style={{
                        padding: '5px 12px', borderRadius: 4, fontSize: 12,
                        background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-muted)',
                        opacity: benchmarkBusyId === row.id ? 0.6 : 1,
                      }}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Scoring Exclusions */}
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 24, gridColumn: '1 / -1' }}>
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 20, marginBottom: 4, color: 'var(--text-primary)' }}>
          Scoring Exclusions
        </h3>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
          Pages listed here are excluded from the 1–100 Content Value normalization scale.
          Paste one URL per line. After saving, hit <strong>Recalculate All Scores</strong> to apply.
        </p>
        <textarea
          value={exclusionText}
          onChange={e => setExclusionText(e.target.value)}
          placeholder={'https://www.dmagazine.com/\nhttps://www.dmagazine.com/section/frontburner/\nhttps://www.dmagazine.com/guides/'}
          rows={8}
          style={{
            width: '100%', boxSizing: 'border-box',
            fontFamily: 'var(--font-mono)', fontSize: 13,
            background: 'var(--bg-elevated)', border: '1px solid var(--border)',
            borderRadius: 4, padding: '10px 12px',
            color: 'var(--text-primary)', resize: 'vertical',
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 12, flexWrap: 'wrap' }}>
          <button
            onClick={handleSaveExclusions}
            disabled={savingExclusions}
            style={{
              padding: '8px 18px', borderRadius: 4, fontSize: 14, fontWeight: 500,
              background: 'var(--accent-gold)', border: 'none', color: '#0f0f0f',
              opacity: savingExclusions ? 0.5 : 1,
            }}
          >
            {savingExclusions ? 'Saving…' : 'Save Exclusions'}
          </button>

          {exclusionResult && (
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
              <span style={{ color: 'var(--accent-gold)', fontWeight: 600 }}>{exclusionResult.matched.length} matched</span>
              {exclusionResult.unmatched.length > 0 && (
                <span style={{ color: '#c0392b', marginLeft: 12 }}>
                  {exclusionResult.unmatched.length} not found:{' '}
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{exclusionResult.unmatched.join(', ')}</span>
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Data Cleanup */}
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 24, gridColumn: '1 / -1' }}>
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 20, marginBottom: 4, color: 'var(--text-primary)' }}>
          Data Cleanup
        </h3>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
          Remove content published more than 2 years ago and its associated analytics snapshots.
          Also prunes excess snapshots, keeping the most recent 30 per content item.
          Future content syncs will only fetch the last 2 years automatically.
        </p>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
          background: '#c0392b0c', border: '1px solid #c0392b30', borderRadius: 6, padding: '10px 12px',
        }}>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            This permanently deletes data. Type <strong style={{ color: '#c0392b', fontFamily: 'var(--font-mono)' }}>DELETE</strong> to enable:
          </span>
          <input
            type="text"
            value={cleanupConfirmText}
            onChange={e => setCleanupConfirmText(e.target.value)}
            placeholder="DELETE"
            style={{
              width: 100, padding: '5px 8px', fontSize: 13, fontFamily: 'var(--font-mono)',
              border: '1px solid var(--border)', borderRadius: 4,
              background: 'var(--bg-surface)', color: 'var(--text-primary)',
            }}
          />
          <button
            onClick={handleCleanup}
            disabled={cleaning || cleanupConfirmText !== 'DELETE'}
            style={{
              padding: '8px 18px', borderRadius: 4, fontSize: 14, fontWeight: 500,
              background: cleaning || cleanupConfirmText !== 'DELETE' ? 'var(--bg-elevated)' : '#c0392b18',
              border: '1px solid #c0392b50',
              color: cleaning || cleanupConfirmText !== 'DELETE' ? 'var(--text-muted)' : '#c0392b',
              opacity: cleaning || cleanupConfirmText !== 'DELETE' ? 0.6 : 1,
              cursor: cleaning || cleanupConfirmText !== 'DELETE' ? 'not-allowed' : 'pointer',
            }}
          >
            {cleaning ? 'Cleaning up…' : 'Delete old content (>2 years)'}
          </button>
        </div>

        <div style={{ marginTop: 12 }}>
          {cleanResult && (
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
              <span style={{ color: '#c0392b', fontWeight: 600 }}>Deleted </span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{cleanResult.contentDeleted.toLocaleString()}</span>
              {' content items and '}
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{cleanResult.snapshotsDeleted.toLocaleString()}</span>
              {' snapshots (cutoff: '}
              <span style={{ fontFamily: 'var(--font-mono)' }}>{cleanResult.cutoff}</span>
              {'). Remaining: '}
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{cleanResult.remainingContent.toLocaleString()}</span>
              {' items · '}
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{cleanResult.remainingSnapshots.toLocaleString()}</span>
              {' snapshots.'}
            </div>
          )}
        </div>
      </div>

      {/* Audit Log */}
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 24, gridColumn: '1 / -1' }}>
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 20, marginBottom: 4, color: 'var(--text-primary)' }}>
          Audit Log
        </h3>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
          Every admin action taken on this page — who, what, and when. Most recent 100 entries.
        </p>
        {auditLog.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No admin actions recorded yet.</div>
        ) : (
          <div style={{ maxHeight: 320, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Time', 'Actor', 'Action', 'Details'].map(h => (
                    <th key={h} style={{
                      position: 'sticky', top: 0, background: 'var(--bg-surface)',
                      padding: '6px 10px', textAlign: 'left', fontSize: 12, fontWeight: 600,
                      color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {auditLog.map(entry => (
                  <tr key={entry.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td style={{ padding: '6px 10px', fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {entry.ts?.slice(0, 19).replace('T', ' ')}
                    </td>
                    <td style={{ padding: '6px 10px', fontSize: 13, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                      {entry.actor}
                    </td>
                    <td style={{ padding: '6px 10px', fontSize: 13, color: 'var(--accent-gold)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                      {entry.action}
                    </td>
                    <td style={{ padding: '6px 10px', fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                      {entry.details ? JSON.stringify(entry.details) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
