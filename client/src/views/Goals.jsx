import React, { useEffect, useState } from 'react';
import { api } from '../api/index.js';
import { NEED_META } from '../components/NeedBadge.jsx';

function fmt(n) {
  if (n === null || n === undefined) return '—';
  if (Math.abs(n) >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (Math.abs(n) >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(Math.round(n));
}

function fmtValue(n, unit) {
  if (n === null || n === undefined) return '—';
  return unit === 'currency' ? '$' + fmt(n) : fmt(n);
}

const STATUS_META = {
  ahead:       { label: 'Ahead of Pace',  color: '#4caf86' },
  on_track:    { label: 'On Track',       color: '#4caf86' },
  behind:      { label: 'Behind Pace',    color: '#e0a13c' },
  not_started: { label: 'Not Started',    color: 'var(--text-muted)' },
  met:         { label: 'Goal Met',       color: '#4caf86' },
  missed:      { label: 'Goal Missed',    color: '#e05c5c' },
};

// Monday–Sunday, containing today.
function weekRange() {
  const d = new Date();
  const from = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
  const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 6);
  return { from: fmtDate(from), to: fmtDate(to) };
}
function monthRange() {
  const d = new Date();
  const from = new Date(d.getFullYear(), d.getMonth(), 1);
  const to = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { from: fmtDate(from), to: fmtDate(to) };
}
function quarterRange() {
  const d = new Date();
  const q = Math.floor(d.getMonth() / 3);
  const from = new Date(d.getFullYear(), q * 3, 1);
  const to = new Date(d.getFullYear(), q * 3 + 3, 0);
  return { from: fmtDate(from), to: fmtDate(to) };
}
function yearRange() {
  const d = new Date();
  return { from: `${d.getFullYear()}-01-01`, to: `${d.getFullYear()}-12-31` };
}
function fmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const EMPTY_FORM = {
  name: '', metric: 'pageviews', scope_type: 'site', scope_value: '',
  target: '', start_date: monthRange().from, end_date: monthRange().to,
};

function GoalPanel({ goal, catalog, sections, writers, types, onClose, onSaved, onDeleted }) {
  const isEdit = !!goal;
  const [form, setForm] = useState(() => goal ? {
    name: goal.name, metric: goal.metric, scope_type: goal.scope_type,
    scope_value: goal.scope_value || '', target: String(goal.target),
    start_date: goal.start_date, end_date: goal.end_date,
  } : EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const scopeMeta = catalog.scopes.find(s => s.key === form.scope_type);
  const needsScopeValue = scopeMeta?.needsValue;

  const scopeOptions = () => {
    switch (form.scope_type) {
      case 'section':      return sections.map(s => ({ value: s.section, label: `${s.section} (${s.count})` }));
      case 'writer':       return writers.map(w => ({ value: w.writer, label: `${w.writer} (${w.count})` }));
      case 'content_type': return types.map(t => ({ value: t.content_type, label: `${t.content_type} (${t.count})` }));
      case 'user_need':    return Object.entries(NEED_META).map(([key, m]) => ({ value: key, label: m.label }));
      default: return [];
    }
  };

  const set = (key, value) => setForm(f => ({ ...f, [key]: value }));

  const applyPreset = (preset) => {
    const range = preset === 'week' ? weekRange() : preset === 'month' ? monthRange() : preset === 'quarter' ? quarterRange() : yearRange();
    setForm(f => ({ ...f, start_date: range.from, end_date: range.to }));
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    const body = {
      name: form.name,
      metric: form.metric,
      scope_type: form.scope_type,
      scope_value: needsScopeValue ? form.scope_value : null,
      target: parseFloat(form.target),
      start_date: form.start_date,
      end_date: form.end_date,
    };
    try {
      const saved = isEdit ? await api.updateGoal(goal.id, body) : await api.createGoal(body);
      onSaved(saved);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Delete goal "${goal.name}"? This can't be undone.`)) return;
    setSaving(true);
    try {
      await api.deleteGoal(goal.id);
      onDeleted(goal.id);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, width: 420,
      background: 'var(--bg-surface)', borderLeft: '1px solid var(--border)',
      overflowY: 'auto', zIndex: 100, display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--text-primary)' }}>
          {isEdit ? 'Edit Goal' : 'New Goal'}
        </h2>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 20, lineHeight: 1, padding: 4, cursor: 'pointer' }}>×</button>
      </div>

      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16, flex: 1 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
          Goal name
          <input
            type="text" value={form.name} onChange={e => set('name', e.target.value)}
            placeholder="e.g. Hit 500K pageviews this month"
            style={{ padding: '7px 9px' }}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
          Metric
          <select value={form.metric} onChange={e => set('metric', e.target.value)} style={{ padding: '7px 9px' }}>
            {catalog.metrics.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
        </label>

        <div style={{ display: 'flex', gap: 10 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--text-secondary)', flex: 1 }}>
            Scope
            <select
              value={form.scope_type}
              onChange={e => setForm(f => ({ ...f, scope_type: e.target.value, scope_value: '' }))}
              style={{ padding: '7px 9px' }}
            >
              {catalog.scopes.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
          {needsScopeValue && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--text-secondary)', flex: 1.4 }}>
              {scopeMeta.label}
              <select value={form.scope_value} onChange={e => set('scope_value', e.target.value)} style={{ padding: '7px 9px' }}>
                <option value="">Select…</option>
                {scopeOptions().map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          )}
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
          Target
          <input
            type="number" min="0" step="any" value={form.target}
            onChange={e => set('target', e.target.value)}
            placeholder={catalog.metrics.find(m => m.key === form.metric)?.unit === 'currency' ? 'e.g. 5000' : 'e.g. 500000'}
            style={{ padding: '7px 9px' }}
          />
        </label>

        <div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6 }}>Time period</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <button type="button" onClick={() => applyPreset('week')} style={{ fontSize: 11, padding: '4px 9px' }}>This Week</button>
            <button type="button" onClick={() => applyPreset('month')} style={{ fontSize: 11, padding: '4px 9px' }}>This Month</button>
            <button type="button" onClick={() => applyPreset('quarter')} style={{ fontSize: 11, padding: '4px 9px' }}>This Quarter</button>
            <button type="button" onClick={() => applyPreset('year')} style={{ fontSize: 11, padding: '4px 9px' }}>This Year</button>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input type="date" value={form.start_date} max={form.end_date} onChange={e => set('start_date', e.target.value)} />
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>to</span>
            <input type="date" value={form.end_date} min={form.start_date} onChange={e => set('end_date', e.target.value)} />
          </div>
        </div>

        {error && <div style={{ color: '#e05c5c', fontSize: 12 }}>{error}</div>}
      </div>

      <div style={{ padding: 20, borderTop: '1px solid var(--border)', display: 'flex', gap: 10, justifyContent: 'space-between' }}>
        {isEdit ? (
          <button onClick={remove} disabled={saving} style={{ color: '#e05c5c', background: 'none', border: '1px solid #e05c5c50', borderRadius: 4, padding: '7px 14px' }}>
            Delete
          </button>
        ) : <span />}
        <button
          onClick={save}
          disabled={saving || !form.name.trim() || !form.target || (needsScopeValue && !form.scope_value)}
          style={{ background: 'var(--accent-gold)', color: '#1a1a1a', border: 'none', borderRadius: 4, padding: '7px 18px', fontWeight: 600 }}
        >
          {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Goal'}
        </button>
      </div>
    </div>
  );
}

function GoalCard({ goal, catalog, onClick }) {
  const metric = catalog.metrics.find(m => m.key === goal.metric) || {};
  const scope = catalog.scopes.find(s => s.key === goal.scope_type) || {};
  const status = STATUS_META[goal.progress.status] || STATUS_META.not_started;
  const pct = Math.max(0, Math.min(100, goal.progress.pct_of_target));

  return (
    <div
      onClick={onClick}
      style={{
        background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8,
        padding: 18, cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 10,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.3 }}>{goal.name}</div>
        <span style={{
          fontSize: 10, fontWeight: 600, color: status.color, background: status.color + '18',
          padding: '2px 8px', borderRadius: 10, whiteSpace: 'nowrap', flexShrink: 0,
        }}>
          {status.label}
        </span>
      </div>

      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        {metric.label} · {scope.label}{goal.scope_value ? ` (${goal.scope_value})` : ''}
      </div>

      <div>
        <div style={{ height: 6, background: 'var(--bg-elevated)', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: status.color, transition: 'width 0.3s' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 12 }}>
          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>
            {fmtValue(goal.progress.current, metric.unit)} <span style={{ color: 'var(--text-muted)' }}>/ {fmtValue(goal.progress.target, metric.unit)}</span>
          </span>
          <span style={{ color: 'var(--text-muted)' }}>{Math.round(pct)}%</span>
        </div>
      </div>

      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        {goal.progress.days_remaining > 0
          ? `${goal.progress.days_remaining} day${goal.progress.days_remaining === 1 ? '' : 's'} left · ${goal.start_date} – ${goal.end_date}`
          : `Ended ${goal.end_date}`}
      </div>
    </div>
  );
}

export default function Goals() {
  const [goals, setGoals] = useState([]);
  const [catalog, setCatalog] = useState({ metrics: [], scopes: [] });
  const [sections, setSections] = useState([]);
  const [writers, setWriters] = useState([]);
  const [types, setTypes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [panel, setPanel] = useState(null); // null | 'new' | goal object

  const loadGoals = () => api.getGoals().then(setGoals).catch(console.error);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      loadGoals(),
      api.getGoalMetrics().then(setCatalog),
      api.getTaxonomies().then(t => setSections(t.sections || [])),
      api.getWriters().then(setWriters),
      api.getContentTypes().then(setTypes),
    ]).catch(console.error).finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 560 }}>
          Set a target for any metric, scope, and date range, and track how the site is pacing toward it.
        </p>
        <button
          onClick={() => setPanel('new')}
          style={{ background: 'var(--accent-gold)', color: '#1a1a1a', border: 'none', borderRadius: 4, padding: '8px 16px', fontWeight: 600, whiteSpace: 'nowrap' }}
        >
          + New Goal
        </button>
      </div>

      {goals.length === 0 ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '40px 0', textAlign: 'center' }}>
          No goals yet. Create one to start tracking pace.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16 }}>
          {goals.map(g => (
            <GoalCard key={g.id} goal={g} catalog={catalog} onClick={() => setPanel(g)} />
          ))}
        </div>
      )}

      {panel && (
        <GoalPanel
          goal={panel === 'new' ? null : panel}
          catalog={catalog}
          sections={sections}
          writers={writers}
          types={types}
          onClose={() => setPanel(null)}
          onSaved={() => { setPanel(null); loadGoals(); }}
          onDeleted={() => { setPanel(null); loadGoals(); }}
        />
      )}
    </div>
  );
}
