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

// `onClick` makes the card a button that opens its trend (Overview's top
// cards) — keyboard-reachable, with a faint trend glyph so it's discoverable
// without hovering. Cards without it (anywhere else KPICard is reused) render
// exactly as before.
export default function KPICard({ label, value, sub, gold = false, change, onClick }) {
  const [hover, setHover] = React.useState(false);
  const clickable = typeof onClick === 'function';
  return (
    <div
      {...(clickable ? {
        role: 'button',
        tabIndex: 0,
        'aria-label': `${label}: show trend over the last three months`,
        onClick,
        onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } },
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
        title: `${label} — click to see the trend over the last three months`,
      } : {})}
      style={{
        position: 'relative',
        background: 'var(--bg-surface)',
        border: `1px solid ${clickable && hover ? 'var(--accent-gold-dim)' : 'var(--border)'}`,
        borderRadius: 8,
        padding: '12px 8px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        cursor: clickable ? 'pointer' : 'default',
        transition: 'border-color 0.12s',
      }}
    >
      {clickable && (
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"
          style={{ position: 'absolute', top: 10, right: 8, color: hover ? 'var(--accent-gold)' : 'var(--text-muted)', opacity: hover ? 1 : 0.55 }}>
          <path d="M1.5 12 5.5 7.5l3 2.5 5-6.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
      <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.02em', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', paddingRight: clickable ? 16 : 0 }} title={clickable ? undefined : label}>
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
