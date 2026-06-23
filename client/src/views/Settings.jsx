import React, { useEffect, useState } from 'react';
import { api } from '../api/index.js';

const WEIGHT_META = {
  score_w_subscription: { label: "Subscribe Clicks",       min: 0, max: 100, step: 1, desc: "Total subscribe clicks (raw count). 5 clicks = full score. More clicks = higher score." },
  score_w_loyal:        { label: "Loyal In-Market Reach",  min: 0, max: 100, step: 1, desc: "Share of audience that is loyal, DFW-area readers (rate - quality signal)." },
  score_w_newsletter:   { label: "Newsletter Signups",     min: 0, max: 100, step: 1, desc: "Total newsletter signups (raw count). 5 signups = full score. More signups = higher score." },
  score_w_engagement:   { label: "Engagement",             min: 0, max: 100, step: 1, desc: "Avg reading time (rate - quality signal, not total time)." },
  score_w_ad_revenue:   { label: "Ad Revenue",             min: 0, max: 100, step: 1, desc: "Ad revenue per 1,000 readers. Kept small so the score isn’t just pageviews." },
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

  useEffect(() => {
    api.getSettings().then(setSettings).catch(console.error);
    api.getSyncStatus().then(setSyncStatus).catch(console.error);
    api.getExclusions()
      .then(rows => setExclusionText(rows.map(r => r.url).join('\n')))
      .catch(console.error);
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
    } catch (err) {
      alert('Save error: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRecalculate = async () => {
    setRecalculating(true);
    try {
      await api.recalculateScores();
      setTimeout(() => setRecalculating(false), 3000);
    } catch (err) {
      alert('Recalculation error: ' + err.message);
      setRecalculating(false);
    }
  };

  const handleSaveExclusions = async () => {
    setSavingExclusions(true);
    setExclusionResult(null);
    try {
      const urls = exclusionText.split('\n').map(u => u.trim()).filter(Boolean);
      const result = await api.setExclusions(urls);
      setExclusionResult(result);
    } catch (err) {
      alert('Error saving exclusions: ' + err.message);
    } finally {
      setSavingExclusions(false);
    }
  };

  const handleCleanup = async () => {
    if (!window.confirm('This will permanently delete all content published more than 2 years ago and its analytics data. Continue?')) return;
    setCleaning(true);
    setCleanResult(null);
    try {
      const result = await api.cleanupData(2);
      setCleanResult(result);
    } catch (err) {
      alert('Cleanup error: ' + err.message);
    } finally {
      setCleaning(false);
    }
  };

  const handleTriggerSync = async (type) => {
    setTriggering(true);
    try {
      await api.triggerSync(type);
      setTimeout(async () => {
        const status = await api.getSyncStatus().catch(() => syncStatus);
        setSyncStatus(status);
        setTriggering(false);
      }, 2000);
    } catch (err) {
      alert('Trigger error: ' + err.message);
      setTriggering(false);
    }
  };

  const vals = { ...settings, ...dirty };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start' }}>
      {/* True Value Model */}
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 24 }}>
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 18, marginBottom: 4, color: 'var(--text-primary)' }}>
          True Value Model
        </h3>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20 }}>
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
                    <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{meta.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{meta.desc}</div>
                  </div>
                  <div style={{
                    fontFamily: 'var(--font-mono)', fontSize: 16,
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
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
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
              padding: '8px 18px', borderRadius: 4, fontSize: 13, fontWeight: 500,
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
              padding: '8px 18px', borderRadius: 4, fontSize: 13,
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
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 18, marginBottom: 16, color: 'var(--text-primary)' }}>
          Sync Status
        </h3>

        {syncStatus && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
            {Object.entries(syncStatus).map(([key, val]) => (
              <div key={key} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '6px 0', borderBottom: '1px solid var(--border-subtle)' }}>
                <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{key}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
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
                padding: '7px 14px', borderRadius: 4, fontSize: 12,
                background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)',
                opacity: triggering ? 0.6 : 1,
              }}
            >
              Trigger {type} sync
            </button>
          ))}
        </div>
      </div>

      {/* Scoring Exclusions */}
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 24, gridColumn: '1 / -1' }}>
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 18, marginBottom: 4, color: 'var(--text-primary)' }}>
          Scoring Exclusions
        </h3>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
          Pages listed here are excluded from the 1–100 True Value normalization scale.
          Paste one URL per line. After saving, hit <strong>Recalculate All Scores</strong> to apply.
        </p>
        <textarea
          value={exclusionText}
          onChange={e => setExclusionText(e.target.value)}
          placeholder={'https://www.dmagazine.com/\nhttps://www.dmagazine.com/section/frontburner/\nhttps://www.dmagazine.com/guides/'}
          rows={8}
          style={{
            width: '100%', boxSizing: 'border-box',
            fontFamily: 'var(--font-mono)', fontSize: 12,
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
              padding: '8px 18px', borderRadius: 4, fontSize: 13, fontWeight: 500,
              background: 'var(--accent-gold)', border: 'none', color: '#0f0f0f',
              opacity: savingExclusions ? 0.5 : 1,
            }}
          >
            {savingExclusions ? 'Saving…' : 'Save Exclusions'}
          </button>

          {exclusionResult && (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
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
        <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 18, marginBottom: 4, color: 'var(--text-primary)' }}>
          Data Cleanup
        </h3>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
          Remove content published more than 2 years ago and its associated analytics snapshots.
          Also prunes excess snapshots, keeping the most recent 30 per content item.
          Future content syncs will only fetch the last 2 years automatically.
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <button
            onClick={handleCleanup}
            disabled={cleaning}
            style={{
              padding: '8px 18px', borderRadius: 4, fontSize: 13, fontWeight: 500,
              background: cleaning ? 'var(--bg-elevated)' : '#c0392b18',
              border: '1px solid #c0392b50',
              color: cleaning ? 'var(--text-muted)' : '#c0392b',
              opacity: cleaning ? 0.6 : 1,
              cursor: cleaning ? 'not-allowed' : 'pointer',
            }}
          >
            {cleaning ? 'Cleaning up…' : 'Delete old content (>2 years)'}
          </button>

          {cleanResult && (
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
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
    </div>
  );
}
