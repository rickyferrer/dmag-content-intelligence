import React from 'react';

// Deep, muted ink tones instead of bright pastels — same hue per need as
// before (preserved for continuity), but all normalized to HSL(hue, 45%, 32%)
// instead of a light/bright register. That reads as editorial and confident
// rather than playful, and is already dark enough to double as both text
// color and a rich (near-opaque) chart/bar fill — no separate pastel "fill"
// needed.
const NEED_META = {
  update_me:       { label: 'Update Me',       color: '#762d2d' }, // deep brick / oxblood
  educate_me:      { label: 'Educate Me',      color: '#2d5576' }, // navy
  give_perspective:{ label: 'Perspective',     color: '#4d2d76' }, // plum / violet-ink
  divert_me:       { label: 'Divert Me',       color: '#76662d' }, // olive / muted ochre
  inspire_me:      { label: 'Inspire Me',      color: '#2d765a' }, // forest teal
  help_me:         { label: 'Help Me',         color: '#76432d' }, // rust / sienna
  connect_me:      { label: 'Connect Me',      color: '#762d55' }, // wine / burgundy
  keep_me_engaged: { label: 'Keep Engaged',    color: '#2d2e76' }, // indigo
};

export default function NeedBadge({ need, size = 'sm' }) {
  if (!need) return <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>;

  const meta = NEED_META[need] || { label: need, color: '#888' };
  const fontSize = size === 'lg' ? 13 : 11;
  const padding = size === 'lg' ? '4px 10px' : '2px 7px';

  return (
    <span style={{
      display: 'inline-block',
      fontSize,
      fontFamily: 'var(--font-sans)',
      fontWeight: 600,
      color: meta.color,
      background: `${meta.color}18`,
      border: `1px solid ${meta.color}40`,
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
