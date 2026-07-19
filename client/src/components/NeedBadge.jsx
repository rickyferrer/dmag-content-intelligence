import React from 'react';

// `color` is a dark tint used for text/links/accent borders (needs contrast on
// white). `fill` is the brand pastel, used for badge/chart/progress-bar fills
// where a large area of flat color reads fine without contrast concerns.
// Fills are all normalized to the same HSL saturation/lightness as the
// update_me reference (#e67272 = H0 S70 L67), hue preserved per need — keeps
// the same chroma "intensity" across the palette instead of some looking
// washed out. divert_me is left as its own vivid gold; it was never a pastel.
const NEED_META = {
  update_me:       { label: 'Update Me',       color: '#a53030', fill: '#e67272' },
  educate_me:      { label: 'Educate Me',      color: '#2474bb', fill: '#70b1e6' },
  give_perspective:{ label: 'Perspective',     color: '#8e44ad', fill: '#a370e6' },
  divert_me:       { label: 'Divert Me',       color: '#9a6f00', fill: '#ffc700' },
  inspire_me:      { label: 'Inspire Me',      color: '#256e5c', fill: '#70e6b9' },
  help_me:         { label: 'Help Me',         color: '#9c3a19', fill: '#e69370' },
  connect_me:      { label: 'Connect Me',      color: '#a6307c', fill: '#e670b1' },
  keep_me_engaged: { label: 'Keep Engaged',    color: '#4040a6', fill: '#7072e6' },
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
