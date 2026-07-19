import React from 'react';

// `color` is a dark tint used for text/links/accent borders (needs contrast on
// white). `fill` is the brand pastel, used for badge/chart/progress-bar fills
// where a large area of flat color reads fine without contrast concerns.
const NEED_META = {
  update_me:       { label: 'Update Me',       color: '#a53030', fill: '#e67272' },
  educate_me:      { label: 'Educate Me',      color: '#2474bb', fill: '#c3daec' },
  give_perspective:{ label: 'Perspective',     color: '#8e44ad', fill: '#e0c8ff' },
  divert_me:       { label: 'Divert Me',       color: '#9a6f00', fill: '#ffc700' },
  inspire_me:      { label: 'Inspire Me',      color: '#256e5c', fill: '#a6d5c3' },
  help_me:         { label: 'Help Me',         color: '#9c3a19', fill: '#fbcfbd' },
  connect_me:      { label: 'Connect Me',      color: '#a6307c', fill: '#f5c6e0' },
  keep_me_engaged: { label: 'Keep Engaged',    color: '#4040a6', fill: '#c7c8f5' },
};

export default function NeedBadge({ need, size = 'sm' }) {
  if (!need) return <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>;

  const meta = NEED_META[need] || { label: need, color: '#888', fill: '#ccc' };
  const fontSize = size === 'lg' ? 13 : 11;
  const padding = size === 'lg' ? '4px 10px' : '2px 7px';

  return (
    <span style={{
      display: 'inline-block',
      fontSize,
      fontFamily: 'var(--font-sans)',
      fontWeight: 600,
      color: meta.color,
      background: meta.fill,
      border: `1px solid ${meta.color}30`,
      borderRadius: 20,
      padding,
      whiteSpace: 'nowrap',
      letterSpacing: '0.02em',
    }}>
      {meta.label}
    </span>
  );
}

export { NEED_META };
