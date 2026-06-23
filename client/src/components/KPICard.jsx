import React from 'react';

export default function KPICard({ label, value, sub, gold = false }) {
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
      <div style={{
        fontSize: 28,
        fontFamily: 'var(--font-mono)',
        fontWeight: 500,
        color: gold ? 'var(--accent-gold)' : 'var(--text-primary)',
        lineHeight: 1.2,
      }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{sub}</div>
      )}
    </div>
  );
}
