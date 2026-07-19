import React from 'react';

function ChangeBadge({ change }) {
  if (change === null || change === undefined) return null;
  const isPos = change >= 0;
  const color = isPos ? '#4caf86' : '#e05c5c';
  const sign = isPos ? '+' : '';
  return (
    <span style={{
      fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 600,
      color, background: color + '18', padding: '2px 6px', borderRadius: 4,
    }}>
      {sign}{change.toFixed(0)}%
    </span>
  );
}

export default function KPICard({ label, value, sub, gold = false, change }) {
  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      padding: '20px 24px',
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
    }}>
      <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <div style={{
          fontSize: 28,
          fontFamily: 'var(--font-mono)',
          fontWeight: 500,
          color: gold ? 'var(--accent-gold)' : 'var(--text-primary)',
          lineHeight: 1.2,
        }}>
          {value}
        </div>
        <ChangeBadge change={change} />
      </div>
      {sub && (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{sub}</div>
      )}
    </div>
  );
}
