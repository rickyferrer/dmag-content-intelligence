import React, { useEffect, useState } from 'react';
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, ZAxis,
} from 'recharts';
import { api } from '../api/index.js';
import DatePresets, { resolveDates, DEFAULT_PRESET } from '../components/DatePresets.jsx';

function fmt(n) {
  if (!n) return '—';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(Math.round(n));
}

const { from: initFrom, to: initTo } = resolveDates(DEFAULT_PRESET);

// Volume: what happened (traffic, reach, output) — fully date-scoped from
// Marfeel-sourced, article-level data. Efficiency: how well it converted —
// sourced from GA4's channel-level rollup, which is always a trailing 30
// days and uses a different taxonomy (see GA4_UNAVAILABLE_NOTES server-side),
// so those columns get an "≈" and a tooltip rather than blending silently.
const VOLUME_COLS = [
  { key: 'pageviews',           label: 'Traffic',            align: 'right' },
  { key: 'users',                label: 'Users',              align: 'right' },
  { key: 'article_count',        label: 'Articles',           align: 'right' },
  { key: 'ga4_subscribe_clicks', label: 'Subscribe Clicks',   align: 'right' },
  { key: 'newsletter_signups',   label: 'Newsletter Signups', align: 'right' },
];

const EFFICIENCY_COLS = [
  { key: 'ga4_sub_per_1k', label: 'Clicks / 1K',  align: 'right' },
  { key: 'loyal_pct',      label: 'Loyal %',       align: 'right' },
  { key: 'inmarket_pct',   label: 'In-Market %',   align: 'right' },
  { key: 'ga4_rev_per_1k', label: 'Rev / 1K',      align: 'right' },
  { key: 'score',          label: 'Score',         align: 'right' },
];

function getSortValue(row, key) {
  switch (key) {
    case 'channel':               return row.label;
    case 'pageviews':              return row.pageviews;
    case 'users':                  return row.users;
    case 'article_count':          return row.article_count;
    case 'newsletter_signups':     return row.newsletter_signups;
    case 'loyal_pct':              return row.loyal_pct;
    case 'inmarket_pct':           return row.inmarket_pct;
    case 'score':                  return row.score;
    case 'ga4_subscribe_clicks':   return row.ga4?.status !== 'unavailable' ? row.ga4.subscribe_clicks : null;
    case 'ga4_sub_per_1k':         return row.ga4?.status !== 'unavailable' ? row.ga4.sub_per_1k : null;
    case 'ga4_rev_per_1k':         return row.ga4?.status !== 'unavailable' ? row.ga4.rev_per_1k : null;
    default:                       return 0;
  }
}

// Renders a GA4-sourced cell: "—" with an explanatory tooltip when the
// mapping is unavailable, "≈value" with a confidence/CI tooltip otherwise.
// This is the one place that's allowed to show a GA4 number next to a
// custom-taxonomy channel — everywhere else we just say we can't.
function Ga4Cell({ row, metric, format }) {
  const g = row.ga4;
  if (!g || g.status === 'unavailable') {
    return <span title={g?.note} style={{ color: 'var(--text-muted)', cursor: 'help' }}>—</span>;
  }
  const ciNote = metric === 'sub_per_1k'
    ? ` 95% CI: ${g.opportunity_per_1k.toFixed(2)} – ${g.sub_ci_upper_per_1k.toFixed(2)} per 1k.`
    : '';
  const title = `${g.low_confidence ? 'Low confidence — ' : ''}based on ${fmt(g.users)} GA4 users, ${fmt(g.subscribe_clicks)} subscribe clicks.${ciNote} ${g.note}`;
  return (
    <span title={title} style={{ cursor: 'help', color: g.low_confidence ? '#c0392b' : 'var(--text-secondary)' }}>
      ≈{format(g[metric])}
      {g.low_confidence && <sup style={{ marginLeft: 2 }}>low n</sup>}
    </span>
  );
}

function ChannelScatter({ channels }) {
  const points = channels.filter(c => c.ga4 && c.ga4.status !== 'unavailable');
  if (points.length < 2) return (
    <div style={{ padding: 30, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
      Not enough channels with GA4 conversion data to plot.
    </div>
  );
  const maxRevenue = Math.max(...points.map(c => c.ga4.ad_revenue || 0), 1);

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.length) return null;
    const d = payload[0]?.payload;
    if (!d) return null;
    return (
      <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, padding: '10px 14px', fontSize: 12, lineHeight: 1.8 }}>
        <div style={{ color: d.color, fontWeight: 600, marginBottom: 4 }}>{d.label}</div>
        <div style={{ color: 'var(--text-secondary)' }}>Traffic: <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{fmt(d.pageviews)}</span></div>
        <div style={{ color: 'var(--text-secondary)' }}>Opportunity: <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{d.ga4.opportunity_per_1k.toFixed(2)}/1k</span></div>
        <div style={{ color: 'var(--text-secondary)' }}>Ad Revenue: <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>${Math.round(d.ga4.ad_revenue).toLocaleString()}</span></div>
        {d.ga4.low_confidence && <div style={{ color: '#c0392b', marginTop: 4 }}>Low confidence — small GA4 sample</div>}
      </div>
    );
  };

  return (
    <ResponsiveContainer width="100%" height={320}>
      <ScatterChart margin={{ top: 20, right: 30, bottom: 20, left: 20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis
          dataKey="pageviews"
          name="Traffic"
          type="number"
          domain={[0, 'dataMax']}
          tickFormatter={fmt}
          label={{ value: 'Traffic (pageviews)', position: 'insideBottom', offset: -10, fill: 'var(--text-muted)', fontSize: 11 }}
          tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
          stroke="var(--border)"
        />
        <YAxis
          dataKey={(d) => d.ga4.opportunity_per_1k}
          name="Conversion Efficiency"
          label={{ value: 'Conversion Efficiency (Opportunity/1k)', angle: -90, position: 'insideLeft', fill: 'var(--text-muted)', fontSize: 11 }}
          tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
          stroke="var(--border)"
        />
        <ZAxis dataKey={(d) => d.ga4.ad_revenue} domain={[0, maxRevenue]} range={[80, 700]} name="Ad Revenue" />
        <Tooltip content={<CustomTooltip />} />
        <Scatter data={points} isAnimationActive={false}>
          {points.map((entry, i) => (
            <Cell
              key={i}
              fill={entry.color}
              fillOpacity={entry.ga4.low_confidence ? 0.35 : 0.85}
              stroke={entry.ga4.low_confidence ? entry.color : 'none'}
              strokeDasharray={entry.ga4.low_confidence ? '3 3' : undefined}
            />
          ))}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}

export default function Sources() {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [types, setTypes] = useState([]);
  const [filters, setFilters] = useState({ from: initFrom, to: initTo, type: '', preset: DEFAULT_PRESET });
  const [viewMode, setViewMode] = useState('volume');
  const [expanded, setExpanded] = useState(null);
  const [sort, setSort] = useState({ key: 'pageviews', dir: 'desc' });
  const [showScatter, setShowScatter] = useState(true);
  const [lastAnalyticsSync, setLastAnalyticsSync] = useState(null);

  const load = ({ from, to, type }) => {
    setLoading(true);
    const params = {};
    if (from) params.dateFrom = from;
    if (to)   params.dateTo = to;
    if (type) params.type = type;
    api.getChannels(params)
      .then(setResult)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load({ from: initFrom, to: initTo, type: '' });
    api.getContentTypes().then(setTypes).catch(console.error);
    api.getSyncStatus()
      .then(status => setLastAnalyticsSync(status?.last_analytics_sync?.updated_at || null))
      .catch(console.error);
  }, []);

  const setFilter = (key, value) => {
    const next = { ...filters, [key]: value };
    setFilters(next);
    load(next);
  };

  const isDefaultFilters = filters.preset === DEFAULT_PRESET && filters.type === '';

  const clearFilters = () => {
    const next = { from: initFrom, to: initTo, type: '', preset: DEFAULT_PRESET };
    setFilters(next);
    load(next);
  };

  const channels = result?.channels || [];
  const unmapped = result?.unmapped_ga4;
  const grandTotal = channels.reduce((s, c) => s + (c.pageviews || 0), 0);

  const cols = viewMode === 'volume' ? VOLUME_COLS : EFFICIENCY_COLS;
  const sortedChannels = [...channels].sort((a, b) => {
    const av = getSortValue(a, sort.key);
    const bv = getSortValue(b, sort.key);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;  // unavailable GA4 metrics always sort last
    if (bv == null) return -1;
    if (typeof av === 'string') return sort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
    return sort.dir === 'asc' ? av - bv : bv - av;
  });
  const handleSort = (key) => setSort(s =>
    s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }
  );

  const gridCols = '200px repeat(5, 1fr) 32px';

  const cellValue = (row, col) => {
    switch (col.key) {
      case 'pageviews':
        return (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
            <div style={{ width: 48, height: 4, background: 'var(--bg-elevated)', borderRadius: 2 }}>
              <div style={{ height: '100%', borderRadius: 2, background: row.color, width: `${Math.max(2, grandTotal > 0 ? (row.pageviews / grandTotal) * 100 : 0)}%` }} />
            </div>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-primary)', minWidth: 40 }}>{fmt(row.pageviews)}</span>
          </div>
        );
      case 'users':            return fmt(row.users);
      case 'article_count':    return fmt(row.article_count);
      case 'newsletter_signups': return fmt(row.newsletter_signups);
      case 'loyal_pct':        return row.loyal_pct > 0 ? row.loyal_pct.toFixed(1) + '%' : '—';
      case 'inmarket_pct':     return row.inmarket_pct > 0 ? row.inmarket_pct.toFixed(1) + '%' : '—';
      case 'score':
        return row.score > 0 ? (
          <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--accent-gold)', background: 'var(--accent-gold-bg)', padding: '2px 6px', borderRadius: 4 }}>
            {row.score}
          </span>
        ) : '—';
      case 'ga4_subscribe_clicks': return <Ga4Cell row={row} metric="subscribe_clicks" format={fmt} />;
      case 'ga4_sub_per_1k':       return <Ga4Cell row={row} metric="sub_per_1k" format={v => v.toFixed(2)} />;
      case 'ga4_rev_per_1k':       return <Ga4Cell row={row} metric="rev_per_1k" format={v => '$' + v.toFixed(2)} />;
      default: return null;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Published:</span>
        <DatePresets
          value={filters.preset}
          from={filters.from}
          to={filters.to}
          onChange={(preset, from, to) => {
            const next = { ...filters, preset, from, to };
            setFilters(next);
            load(next);
          }}
        />
        <select value={filters.type} onChange={e => setFilter('type', e.target.value)}>
          <option value="">All Types</option>
          {types.map(t => <option key={t.content_type} value={t.content_type}>{t.content_type} ({t.count})</option>)}
        </select>

        <div style={{ display: 'flex', marginLeft: 'auto', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
          {['volume', 'efficiency'].map(mode => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              style={{
                padding: '6px 14px', fontSize: 12, fontWeight: 500, border: 'none', cursor: 'pointer',
                background: viewMode === mode ? 'var(--accent-gold)' : 'var(--bg-elevated)',
                color: viewMode === mode ? '#0f0f0f' : 'var(--text-secondary)',
                textTransform: 'capitalize',
              }}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ padding: 40, color: 'var(--text-muted)' }}>Loading...</div>
      ) : channels.length === 0 ? (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ color: 'var(--text-muted)' }}>
            No source data matches these filters.
          </div>
          {!isDefaultFilters && (
            <button
              onClick={clearFilters}
              style={{
                marginTop: 12, padding: '6px 14px', borderRadius: 4, fontSize: 12,
                background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)',
                cursor: 'pointer',
              }}
            >
              Clear filters
            </button>
          )}
          <div style={{ marginTop: 16, fontSize: 11, color: 'var(--text-muted)' }}>
            Last successful analytics sync:{' '}
            {lastAnalyticsSync ? lastAnalyticsSync.slice(0, 19).replace('T', ' ') : 'never'}
          </div>
        </div>
      ) : (
        <>
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 15, color: 'var(--text-primary)', margin: 0 }}>Channels</h3>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 0' }}>
                {fmt(grandTotal)} total pageviews{filters.from && filters.to ? `, ${filters.from} – ${filters.to}` : ''}.{' '}
                {viewMode === 'efficiency' && (
                  <>Columns marked <strong>≈</strong> come from GA4's channel taxonomy (always trailing 30 days, regardless of the date filter above) — hover a value for its source and confidence.</>
                )}
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: gridCols, padding: '8px 16px', borderBottom: '2px solid var(--border)', background: 'var(--bg-elevated)' }}>
              <div
                onClick={() => handleSort('channel')}
                style={{ fontSize: 10, fontWeight: 600, color: sort.key === 'channel' ? 'var(--accent-gold)' : 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', cursor: 'pointer', userSelect: 'none' }}
              >
                Channel <span style={{ opacity: sort.key === 'channel' ? 1 : 0.25 }}>{sort.key === 'channel' ? (sort.dir === 'desc' ? '↓' : '↑') : '↕'}</span>
              </div>
              {cols.map(col => (
                <div
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  style={{ fontSize: 10, fontWeight: 600, color: sort.key === col.key ? 'var(--accent-gold)' : 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'right', cursor: 'pointer', userSelect: 'none' }}
                >
                  {col.label} <span style={{ opacity: sort.key === col.key ? 1 : 0.25 }}>{sort.key === col.key ? (sort.dir === 'desc' ? '↓' : '↑') : '↕'}</span>
                </div>
              ))}
              <div />
            </div>

            {sortedChannels.map(row => {
              const isOpen = expanded === row.key;
              return (
                <div key={row.key} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  <div
                    onClick={() => setExpanded(isOpen ? null : row.key)}
                    style={{
                      display: 'grid', gridTemplateColumns: gridCols, alignItems: 'center',
                      padding: '12px 16px', cursor: 'pointer',
                      background: isOpen ? 'var(--bg-elevated)' : 'transparent',
                    }}
                    onMouseEnter={e => { if (!isOpen) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                    onMouseLeave={e => { if (!isOpen) e.currentTarget.style.background = 'transparent'; }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 10, height: 10, borderRadius: '50%', background: row.color, flexShrink: 0 }} />
                      <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>{row.label}</span>
                    </div>
                    {cols.map(col => (
                      <div key={col.key} style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)', textAlign: 'right' }}>
                        {cellValue(row, col)}
                      </div>
                    ))}
                    <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>{isOpen ? '▲' : '▼'}</div>
                  </div>

                  {isOpen && (
                    <div style={{ background: 'var(--bg-elevated)', borderTop: '1px solid var(--border-subtle)' }}>
                      {row.sources.map(src => {
                        const srcLoyalPct = src.users > 0 ? (src.loyal_users / src.users) * 100 : 0;
                        const srcInmarketPct = src.users > 0 ? (src.inmarket_pv / src.users) * 100 : 0;
                        const srcPct = row.pageviews > 0 ? (src.pageviews / row.pageviews) * 100 : 0;
                        return (
                          <div key={src.source} style={{ display: 'grid', gridTemplateColumns: gridCols, alignItems: 'center', padding: '9px 16px 9px 36px', borderBottom: '1px solid var(--border-subtle)' }}>
                            <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{src.source}</span>
                            {viewMode === 'volume' ? (
                              <>
                                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)', textAlign: 'right' }}>{fmt(src.pageviews)} ({srcPct.toFixed(0)}%)</div>
                                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)', textAlign: 'right' }}>{fmt(src.users)}</div>
                                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)', textAlign: 'right' }}>{fmt(src.article_count)}</div>
                                <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }} title="GA4 doesn't break subscribe clicks down by individual source, only by channel.">—</div>
                                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)', textAlign: 'right' }}>{fmt(src.newsletter_signups)}</div>
                              </>
                            ) : (
                              <>
                                <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }} title="GA4 doesn't break conversion rates down by individual source, only by channel.">—</div>
                                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)', textAlign: 'right' }}>{srcLoyalPct > 0 ? srcLoyalPct.toFixed(1) + '%' : '—'}</div>
                                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)', textAlign: 'right' }}>{srcInmarketPct > 0 ? srcInmarketPct.toFixed(1) + '%' : '—'}</div>
                                <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }} title="GA4 doesn't break revenue down by individual source, only by channel.">—</div>
                                <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>—</div>
                              </>
                            )}
                            <div />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {unmapped?.channels?.length > 0 && (
              <div style={{ padding: '10px 16px', fontSize: 11, color: 'var(--text-muted)', borderTop: '1px solid var(--border-subtle)' }}>
                GA4 also recorded {fmt(unmapped.subscribe_clicks)} subscribe clicks from {fmt(unmapped.users)} users on channels with no
                equivalent in this taxonomy ({unmapped.channels.join(', ')}) — not reflected in any row above.
              </div>
            )}
            <div style={{ padding: '10px 16px', fontSize: 11, color: 'var(--text-muted)', borderTop: '1px solid var(--border-subtle)', fontStyle: 'italic' }}>
              Direct / Bookmark and Dark Social conversion metrics are unavailable — GA4's "Direct" channel can't distinguish the two, so we don't
              guess a split. Google Discover's conversions are folded into Search Engines by GA4 and can't be isolated.
            </div>
          </div>

          {/* Opportunity scatter — supplements the table, doesn't replace it */}
          <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px', borderBottom: showScatter ? '1px solid var(--border)' : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 15, color: 'var(--text-primary)', margin: 0 }}>Opportunity Map</h3>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 0' }}>
                  Traffic vs. conversion efficiency. Bubble size = ad revenue, color = channel. Dashed/faint bubbles are low-confidence (small GA4 sample).
                </p>
              </div>
              <button
                onClick={() => setShowScatter(s => !s)}
                style={{ padding: '6px 12px', borderRadius: 4, fontSize: 12, background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer' }}
              >
                {showScatter ? 'Hide' : 'Show'}
              </button>
            </div>
            {showScatter && <ChannelScatter channels={channels} />}
          </div>
        </>
      )}
    </div>
  );
}
