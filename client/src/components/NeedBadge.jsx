import React, { useEffect, useRef, useState } from 'react';

// Moderately saturated jewel tones — each hand-balanced rather than forced
// to one lightness/saturation formula, since the same L/S reads differently
// per hue (yellow needs to run darker than blue to avoid looking neon, etc).
// This is the original palette the app used before a detour through bright
// pastels (too playful) and then overly dark ink tones (too muddy) — it was
// already the right middle ground.
// `desc` mirrors the exact category definitions given to the classifier
// (server/classify/userNeeds.js, Shishkin's User Needs Model 2.0) so the UI
// never drifts from what actually determines an article's classification.
const NEED_META = {
  update_me:       { label: 'Update Me',       color: '#c0392b', desc: 'Breaking news, scores, and what just happened — timely updates readers need right now.' }, // red
  educate_me:      { label: 'Educate Me',      color: '#2474bb', desc: 'Explainers and deep dives that build understanding — how things work, and the context behind them.' }, // blue
  give_perspective:{ label: 'Perspective',     color: '#8e44ad', desc: 'Opinion, analysis, and commentary — a distinct point of view on a topic.' }, // purple
  divert_me:       { label: 'Divert Me',       color: '#9a6f00', desc: 'Entertainment, fun reads, culture, and things to do — content for enjoyment, not information.' }, // gold
  inspire_me:      { label: 'Inspire Me',      color: '#0e7c8a', desc: 'Profiles, best-of lists, and aspirational stories — people and achievements worth admiring.' }, // teal
  help_me:         { label: 'Help Me',         color: '#1e7a3c', desc: 'Service journalism — guides, recommendations, and how-to content readers can act on.' }, // green
  connect_me:      { label: 'Connect Me',      color: '#b5520a', desc: 'Community and local-identity content — belonging, civic life, and shared local experience.' }, // burnt orange
  keep_me_engaged: { label: 'Keep Engaged',    color: '#a93226', desc: 'Quizzes, puzzles, and serialized or recurring formats — content designed to be revisited.' }, // brick red
};

// Click-to-open (not hover) so it works on touch devices — closes on an
// outside click, same pattern as a native <details>/popover but styled to
// match the rest of the app instead of the browser default.
function NeedInfoIcon({ need, color }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const desc = NEED_META[need]?.desc;

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  if (!desc) return null;

  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex', verticalAlign: 'middle' }}>
      <button
        type="button"
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        aria-label={`What defines "${NEED_META[need]?.label}"`}
        title="What defines this user need"
        style={{
          width: 14, height: 14, borderRadius: '50%', border: `1px solid ${color}88`,
          background: open ? `${color}18` : 'none', color, fontSize: 9, fontWeight: 700,
          lineHeight: '12px', padding: 0, cursor: 'pointer', flexShrink: 0,
          fontFamily: 'var(--font-sans)', fontStyle: 'italic',
        }}
      >
        i
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: '150%', left: 0, zIndex: 30,
          width: 220, background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 6, padding: '9px 11px', fontSize: 11, lineHeight: 1.5, fontWeight: 400,
          color: 'var(--text-secondary)', boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
        }}>
          {desc}
        </div>
      )}
    </span>
  );
}

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

export { NEED_META, NeedInfoIcon };
