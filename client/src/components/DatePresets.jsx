import React from 'react';

export const DEFAULT_PRESET = '30d';

const PRESETS = [
  { label: 'All time',      value: 'all' },
  { label: 'Today',         value: 'today' },
  { label: 'Yesterday',     value: 'yesterday' },
  { label: 'Last 7 days',   value: '7d' },
  { label: 'Last 28 days',  value: '28d' },
  { label: 'Last 30 days',  value: '30d' },
  { label: 'Last 90 days',  value: '90d' },
  { label: 'This year',     value: 'year' },
  { label: 'Custom range',  value: 'custom' },
];

// Format the LOCAL calendar date as YYYY-MM-DD. Deliberately not
// `d.toISOString().slice(0, 10)` — that converts to UTC first, which shifts
// the date by one for any timezone west of UTC once local time passes into
// evening (e.g. after ~7pm Central), silently turning "Today"/"Yesterday"
// into the wrong day and filtering out all of that day's real content.
function fmt(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function resolveDates(value) {
  const today = new Date();
  const ago = (n) => { const d = new Date(today); d.setDate(d.getDate() - n); return d; };

  switch (value) {
    case 'all':       return { from: '', to: '' };
    case 'today':     return { from: fmt(today), to: fmt(today) };
    case 'yesterday': return { from: fmt(ago(1)), to: fmt(ago(1)) };
    case '7d':        return { from: fmt(ago(6)),  to: fmt(today) };
    case '28d':       return { from: fmt(ago(27)), to: fmt(today) };
    case '30d':       return { from: fmt(ago(29)), to: fmt(today) };
    case '90d':       return { from: fmt(ago(89)), to: fmt(today) };
    case 'year':      return { from: `${today.getFullYear()}-01-01`, to: fmt(today) };
    case 'custom':    return { from: fmt(ago(29)), to: fmt(today) }; // sensible starting point
    default:          return { from: '', to: '' };
  }
}

// Fully controlled: the parent owns `value` (the preset key) plus the actual
// `from`/`to` date strings. This matters because a parent that conditionally
// unmounts its tree while loading (e.g. `if (loading) return <Spinner/>`)
// would otherwise wipe out any internal selection state on every reload,
// visually resetting the dropdown back to its default even though the real
// filter values were fine. Keeping the parent as the single source of truth
// means the selection survives that.
export default function DatePresets({ value, from, to, onChange }) {
  const handlePresetChange = (newValue) => {
    const dates = resolveDates(newValue);
    onChange(newValue, dates.from, dates.to);
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <select value={value} onChange={e => handlePresetChange(e.target.value)} style={{ minWidth: 130 }}>
        {PRESETS.map(p => (
          <option key={p.value} value={p.value}>{p.label}</option>
        ))}
      </select>
      {value === 'custom' && (
        <>
          <input
            type="date"
            value={from || ''}
            max={to || undefined}
            onChange={e => onChange('custom', e.target.value, to)}
          />
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>to</span>
          <input
            type="date"
            value={to || ''}
            min={from || undefined}
            onChange={e => onChange('custom', from, e.target.value)}
          />
        </>
      )}
    </div>
  );
}
