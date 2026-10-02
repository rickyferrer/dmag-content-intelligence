import React, { useEffect, useMemo, useState } from 'react';
import { ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';
import { api } from '../api/index.js';
import Spinner from './Spinner.jsx';

// Side panel showing how one of the Overview's top cards has trended over the
// last three months, week by week. Data comes from /api/analytics/overview-trend
// — see that route for where each metric's history comes from and why it's
// weekly. Same fixed-right-panel pattern as ContentDetail / GoalPanel.

const trim = (x) => x.toFixed(1).replace(/\.0$/, '');
function fmtCount(n) {
  if (n === null || n === undefined) return '—';
  if (Math.abs(n) >= 1000000) return trim(n / 1000000) + 'M';
  if (Math.abs(n) >= 1000) return trim(n / 1000) + 'K';
  return String(Math.round(n));
}
function fmtValue(n, unit) {
  if (n === null || n === undefined) return '—';
  if (unit === 'percent') return n.toFixed(1) + '%';
  if (unit === 'currency') return '$' + fmtCount(n);
  if (unit === 'score') return n.toFixed(1);
  return fmtCount(n);
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDay(iso) {
  const [, m, d] = iso.split('-');
  return `${MONTHS[parseInt(m, 10) - 1]} ${parseInt(d, 10)}`;
}
function pctChange(cur, prev) {
  if (cur == null || prev == null || prev === 0) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}

function TrendTooltip({ active, payload, unit }) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  const short = p.days_with_data > 0 && p.days_with_data < p.days_in_bucket;
  return (
    <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px', fontSize: 12 }}>
      <div style={{ color: 'var(--text-muted)', marginBottom: 2 }}>
        {fmtDay(p.week_start)} – {fmtDay(p.week_end)}{p.partial ? ' (in progress)' : ''}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, color: 'var(--text-primary)' }}>{fmtValue(p.value, unit)}</div>
      {short && <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>Data for {p.days_with_data} of {p.days_in_bucket} days</div>}
    </div>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: 18, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', lineHeight: 1.3 }}>{value}</div>
      {sub}
    </div>
  );
}

export default function MetricTrendPanel({ metric, filters, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null); setData(null);
    const params = {};
    if (filters?.section) params.section = filters.section;
    if (filters?.type) params.type = filters.type;
    if (filters?.userNeed) params.userNeed = filters.userNeed;
    if (filters?.windowDays) params.windowDays = filters.windowDays;
    api.getOverviewTrend(metric, params)
      .then(d => { if (!cancelled) setData(d); })
      .catch(e => { if (!cancelled) setError(e.message || 'Could not load the trend'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [metric, filters?.section, filters?.type, filters?.userNeed, filters?.windowDays]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const unit = data?.unit;

  // Solid line = complete weeks. The in-progress week would read as a false
  // drop (it only has some days in it), so it's drawn as a dashed extension
  // from the last complete week instead of part of the line.
  const chart = useMemo(() => {
    if (!data) return null;
    const pts = data.points;
    const last = pts.length - 1;
    const rows = pts.map((p, i) => ({
      ...p,
      label: fmtDay(p.week_start),
      solid: p.partial ? null : p.value,
      dashed: p.partial ? p.value : (i === last - 1 && pts[last]?.partial && pts[last].value != null ? p.value : null),
    }));
    const breakLabels = (data.breaks || []).map(b => {
      const row = rows.find(r => b.date >= r.week_start && b.date <= r.week_end) || rows.find(r => r.week_start > b.date);
      return row ? { ...b, x: row.label } : null;
    }).filter(Boolean);
    const complete = pts.filter(p => !p.partial && p.value != null);
    const latest = complete[complete.length - 1];
    const prior = complete[complete.length - 2];
    const avg = complete.length ? complete.reduce((s, p) => s + p.value, 0) / complete.length : null;
    const missingLeading = pts.findIndex(p => p.value != null);
    // A week holding a method change mixes old and new numbers, so comparing
    // across it (or averaging across it) would read the change in how the
    // metric is computed as a change in performance.
    const breaks = data.breaks || [];
    const crossesBreak = !!(latest && prior && breaks.some(b => b.date > prior.week_start && b.date <= latest.week_end));
    const avgSpansBreak = breaks.some(b => complete.length && b.date > complete[0].week_start && b.date <= complete[complete.length - 1].week_end);
    return { rows, breakLabels, latest, prior, avg, completeCount: complete.length, missingLeading, crossesBreak, avgSpansBreak };
  }, [data]);

  const change = chart && chart.latest && chart.prior && !chart.crossesBreak ? pctChange(chart.latest.value, chart.prior.value) : null;
  const hasData = chart && chart.rows.some(r => r.value != null);

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, width: 480,
      background: 'var(--bg-surface)', borderLeft: '1px solid var(--border)',
      overflowY: 'auto', zIndex: 100, display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--text-primary)', marginBottom: 2 }}>
            {data?.label || 'Trend'}
          </h2>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Last three months, week by week{data ? ` · ${fmtDay(data.range.from)} – ${fmtDay(data.range.to)}` : ''}
          </div>
        </div>
        <button onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 20, lineHeight: 1, padding: 4, cursor: 'pointer' }}>×</button>
      </div>

      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 18 }}>
        {loading && <Spinner block label="Loading trend…" />}
        {error && <div role="alert" style={{ color: '#e05c5c', fontSize: 13 }}>{error}</div>}

        {data && chart && !hasData && (
          <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '30px 0', textAlign: 'center' }}>
            No history for this metric yet.
          </div>
        )}

        {data && chart && hasData && (
          <>
            <div style={{ display: 'flex', gap: 16 }}>
              <Stat
                label="Latest full week"
                value={fmtValue(chart.latest?.value, unit)}
                sub={change != null ? (
                  <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: change >= 0 ? '#4caf86' : '#e05c5c' }}>
                    {change >= 0 ? '+' : ''}{change.toFixed(0)}% vs prior week
                  </div>
                ) : chart.crossesBreak && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>change not shown — method changed</div>
                )}
              />
              <Stat
                label={`${chart.completeCount}-week average`}
                value={fmtValue(chart.avg, unit)}
                sub={chart.avgSpansBreak && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>spans the method change</div>}
              />
            </div>

            <div>
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={chart.rows} margin={{ top: 14, right: 12, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" interval={1} tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} stroke="var(--border)" />
                  <YAxis
                    width={48}
                    tickFormatter={v => fmtValue(v, unit)}
                    domain={unit === 'count' || unit === 'currency' ? [0, 'auto'] : ['auto', 'auto']}
                    tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} stroke="var(--border)"
                  />
                  <Tooltip content={<TrendTooltip unit={unit} />} cursor={{ stroke: 'var(--border)' }} />
                  {chart.breakLabels.map(b => (
                    <ReferenceLine key={b.date} x={b.x} stroke="var(--text-muted)" strokeDasharray="4 3"
                      label={{ value: b.label, position: 'insideTopRight', fill: 'var(--text-muted)', fontSize: 10 }} />
                  ))}
                  <Line type="monotone" dataKey="solid" stroke="var(--accent-gold)" strokeWidth={2.5} dot={{ r: 3.5, fill: 'var(--accent-gold)', strokeWidth: 0 }} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="dashed" stroke="var(--accent-gold)" strokeWidth={2} strokeDasharray="4 4" dot={(props) => props.payload.partial
                    ? <circle key={props.index} cx={props.cx} cy={props.cy} r={4} fill="var(--bg-surface)" stroke="var(--accent-gold)" strokeWidth={2} />
                    : null}
                    activeDot={false} connectNulls={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
              {data.points[data.points.length - 1]?.partial && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  Dashed point = this week so far ({fmtDay(data.points[data.points.length - 1].week_start)} – {fmtDay(data.points[data.points.length - 1].week_end)}), not a full week.
                </div>
              )}
            </div>

            <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{data.about}</div>

            {chart.missingLeading > 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                History starts the week of <strong style={{ color: 'var(--text-secondary)' }}>{fmtDay(data.first_data_week)}</strong> — earlier weeks aren’t available for this metric.
              </div>
            )}

            {data.breaks?.map(b => (
              <div key={b.date} style={{ background: 'var(--bg-elevated)', borderRadius: 6, padding: '10px 12px', fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, borderLeft: '3px solid var(--accent-gold-dim)' }}>
                <strong style={{ color: 'var(--text-primary)' }}>{b.label} ({fmtDay(b.date)}).</strong> {b.note}
              </div>
            ))}

            {data.filters_ignored && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                This is site-wide — the section, type and user-need filters on the Overview don’t apply to this metric.
              </div>
            )}
            {data.scope === 'filtered' && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Filtered to the section / type / user need selected on the Overview.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
