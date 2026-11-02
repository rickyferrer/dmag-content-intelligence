import React from 'react';
import { DEFAULT_PRESET } from './DatePresets.jsx';

// Shown under a tab's date filter when the range isn't the default trailing
// 30 days, so it's clear the traffic columns follow the range while Content
// Value stays the rolling-30-day score.
export default function RangeNote({ preset, from, to }) {
  if (preset === DEFAULT_PRESET) return null;
  const span = from && to ? `${from} to ${to}` : 'Jan 1, 2026 to today';
  return (
    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: -12 }}>
      Users, Pageviews, Loyal Users, Sub Clicks, Newsletter and Eng. Time cover{' '}
      <strong style={{ color: 'var(--text-secondary)' }}>{span}</strong>. Content Value stays a rolling 30-day score.
    </div>
  );
}
