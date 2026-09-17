import React from 'react';
import { useComparisons } from '../context/ComparisonContext.jsx';

// Central gate for period-over-period display: every comparison badge in
// the app renders through this one component, so the global toggle only
// needs to be checked here rather than at every call site.
export function ChangeBadge({ change }) {
  const { showComparisons } = useComparisons();
  if (!showComparisons) return null;
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

export default function KPICard({ label, value, sub, gold = false, change, info }) {
  return (
    <div style={{
      background: 'var(--bg-surface)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      padding: '12px 8px',
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.02em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={label}>
          {label}
        </span>
        {info && (
          <span
            title={info}
            style={{
              flexShrink: 0, width: 12, height: 12, borderRadius: '50%',
              border: '1px solid var(--text-muted)', color: 'var(--text-muted)',
              fontSize: 9, fontStyle: 'italic', fontFamily: 'var(--font-sans)',
              lineHeight: '11px', textAlign: 'center', cursor: 'help',
            }}
          >
            i
          </span>
        )}
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
