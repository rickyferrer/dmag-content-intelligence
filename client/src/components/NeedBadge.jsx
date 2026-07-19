import React from 'react';

// Moderately saturated jewel tones — each hand-balanced rather than forced
// to one lightness/saturation formula, since the same L/S reads differently
// per hue (yellow needs to run darker than blue to avoid looking neon, etc).
// This is the original palette the app used before a detour through bright
// pastels (too playful) and then overly dark ink tones (too muddy) — it was
// already the right middle ground.
const NEED_META = {
  update_me:       { label: 'Update Me',       color: '#c0392b' }, // red
  educate_me:      { label: 'Educate Me',      color: '#2474bb' }, // blue
  give_perspective:{ label: 'Perspective',     color: '#8e44ad' }, // purple
  divert_me:       { label: 'Divert Me',       color: '#9a6f00' }, // gold
  inspire_me:      { label: 'Inspire Me',      color: '#0e7c8a' }, // teal
  help_me:         { label: 'Help Me',         color: '#1e7a3c' }, // green
  connect_me:      { label: 'Connect Me',      color: '#b5520a' }, // burnt orange
  keep_me_engaged: { label: 'Keep Engaged',    color: '#a93226' }, // brick red
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
