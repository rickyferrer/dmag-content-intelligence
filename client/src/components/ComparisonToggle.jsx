import React from 'react';
import { useComparisons } from '../context/ComparisonContext.jsx';

// Global on/off switch for the period-over-period "+/-%" badges and "vs.
// previous period" captions — lives in the app header so it's reachable
// from every tab instead of being duplicated per-view.
export default function ComparisonToggle() {
  const { showComparisons, setShowComparisons } = useComparisons();

  return (
    <label
      title="Show +/-% comparison badges to the previous period"
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        fontSize: 13, color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none',
      }}
    >
      Comparisons
      <span
        onClick={() => setShowComparisons(v => !v)}
        style={{
          position: 'relative', width: 34, height: 18, borderRadius: 9,
          background: showComparisons ? 'var(--accent-gold)' : 'var(--border)',
          transition: 'background 0.15s', flexShrink: 0,
        }}
      >
        <span style={{
          position: 'absolute', top: 2, left: showComparisons ? 18 : 2,
          width: 14, height: 14, borderRadius: '50%', background: '#fff',
          transition: 'left 0.15s',
        }} />
      </span>
    </label>
  );
}
