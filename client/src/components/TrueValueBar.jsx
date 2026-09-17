import React from 'react';

export default function TrueValueBar({ value, max = 100 }) {
  const score = Math.round(value || 0);
  const pct   = max > 0 ? Math.min(100, (score / max) * 100) : 0;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{
        flex: 1,
        height: 4,
        background: 'var(--bg-elevated)',
        borderRadius: 2,
        overflow: 'hidden',
      }}>
        <div style={{
          width: `${pct}%`,
          height: '100%',
          background: 'linear-gradient(90deg, var(--accent-gold-dim), var(--accent-gold))',
          borderRadius: 2,
          transition: 'width 0.3s ease',
        }} />
      </div>
      <span style={{
        fontSize: 12,
        fontFamily: 'var(--font-mono)',
        color: score > 0 ? 'var(--accent-gold)' : 'var(--text-muted)',
        minWidth: 28,
        textAlign: 'right',
      }}>
        {score > 0 ? score : '—'}
      </span>
    </div>
  );
}
