import React from 'react';

// Small spinning ring in the brand red. `label` adds text beside it;
// `block` centers it in a padded area for whole-view loading states.
export default function Spinner({ size = 16, label, block = false }) {
  const ring = (
    <span
      className="spinner"
      role="status"
      aria-label={label || 'Loading'}
      style={{ width: size, height: size, borderWidth: Math.max(2, Math.round(size / 8)) }}
    />
  );
  const content = label
    ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>{ring}<span>{label}</span></span>
    : ring;
  if (!block) return content;
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: 40, color: 'var(--text-muted)', fontSize: 13 }}>
      {content}
    </div>
  );
}
