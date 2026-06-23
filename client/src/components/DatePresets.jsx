import React, { useState } from 'react';

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
];

function fmt(d) { return d.toISOString().slice(0, 10); }

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
    default:          return { from: '', to: '' };
  }
}

export default function DatePresets({ onChange, defaultValue = DEFAULT_PRESET }) {
  const [selected, setSelected] = useState(defaultValue);

  const handleChange = (value) => {
    setSelected(value);
    const { from, to } = resolveDates(value);
    onChange(from, to);
  };

  return (
    <select
      value={selected}
      onChange={e => handleChange(e.target.value)}
      style={{ minWidth: 130 }}
    >
      {PRESETS.map(p => (
        <option key={p.value} value={p.value}>{p.label}</option>
      ))}
    </select>
  );
}
