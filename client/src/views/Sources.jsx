import React, { useEffect, useState } from 'react';
import { api } from '../api/index.js';
import DatePresets, { resolveDates, DEFAULT_PRESET } from '../components/DatePresets.jsx';

function fmtSec(s) {
  if (!s) return '—';
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

// Channel groupings — maps Marfeel source names to a channel bucket
const CHANNELS = {
  search: {
    label: 'Organic Search',
    color: '#2474bb',
    sources: new Set(['Google', 'Bing', 'DuckDuckGo', 'Yahoo!', 'Ecosia', 'Google News',
                      'Yandex', 'Brave', 'Baidu']),
  },
  discover: {
    label: 'Google Discover',
    color: '#e67e22',
    sources: new Set(['Google Discover']),
  },
  dark_social: {
    label: 'Dark Social',
    color: '#8e44ad',
    sources: new Set(['dark social']),
  },
  direct: {
    label: 'Direct / Bookmark',
    color: '#27ae60',
    sources: new Set(['direct', 'bookmark']),
  },
  social: {
    label: 'Social Media',
    color: '#e74c3c',
    sources: new Set(['Facebook', 'Reddit', 'Twitter', 'Instagram', 'LinkedIn',
                      'Bluesky', 'Threads', 'Pinterest', 'Nextdoor', 'nextdoor.com',
                      'later-linkinbio', 'linkin.bio', 'ig', 'com.reddit.frontpage',
                      'old.reddit.com', 'linktr.ee']),
  },
  email: {
    label: 'Email',
    color: '#f39c12',
    sources: new Set(['hs_email', 'newsletter', 'omnisend', 'Gmail', 'WEBCTA',
                      'pushengage', 'hub.marfeel.com']),
  },
  ai: {
    label: 'AI Referral',
    color: '#1abc9c',
    sources: new Set(['ChatGPT', 'Claude', 'Perplexity', 'perplexity.ai']),
  },
  referral: {
    label: 'Referral',
    color: '#95a5a6',
    sources: new Set(), // catch-all for everything else
  },
};

function getChannel(source) {
  for (const [key, ch] of Object.entries(CHANNELS)) {
    if (key === 'referral') continue;
    if (ch.sources.has(source)) return key;
  }
  return 'referral';
}

function fmt(n) {
  if (!n) return '—';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(Math.round(n));
}

const { from: initFrom, to: initTo } = resolveDates(DEFAULT_PRESET);

const PERF_COLS = [
  { label: 'Channel',        key: 'channel',             align: 'left'  },
  { label: 'Users',          key: 'users',               align: 'right' },
  { label: 'Sub Clicks',     key: 'subscribe_clicks',    align: 'right' },
  { label: 'Subs / 1k',     key: 'sub_per_1k',          align: 'right' },
  { label: 'Avg Engagement', key: 'avg_engagement_time', align: 'right' },
  { label: 'Ad Rev / 1k',   key: 'rev_per_1k',          align: 'right' },
];

export default function Sources() {
  const [data, setData] = useState([]);
  const [perf, setPerf] = useState([]);
  const [perfSort, setPerfSort] = useState({ key: 'users', dir: 'desc' });
  const [loading, setLoading] = useState(true);
  const [types, setTypes] = useState([]);
  const [filters, setFilters] = useState({ from: initFrom, to: initTo, type: '' });
  const [expanded, setExpanded] = useState(null);

  const load = ({ from, to, type }) => {
    setLoading(true);
    const params = {};
    if (from) params.dateFrom = from;
    if (to)   params.dateTo = to;
    if (type) params.type = type;
    api.getByTrafficSource(params)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load({ from: initFrom, to: initTo, type: '' });
    api.getContentTypes().then(setTypes).catch(console.error);
    api.getSourcePerformance().then(setPerf).catch(console.error);
  }, []);

  const setFilter = (key, value) => {
    const next = { ...filters, [key]: value };
    setFilters(next);
    load(next);
  };

  // Aggregate rows into channels
  const channelTotals = {};
  const channelSources = {};
  const channelMeta = {};
  let grandTotal = 0;

  for (const row of data) {
    const ch = getChannel(row.source);
    if (!channelTotals[ch]) {
      channelTotals[ch] = 0;
      channelSources[ch] = [];
      channelMeta[ch] = { users: 0, loyal_users: 0, inmarket: 0, newsletter: 0 };
    }
    channelTotals[ch] += row.total_pageviews || 0;
    channelSources[ch].push(row);
    channelMeta[ch].users            += row.total_users || 0;
    channelMeta[ch].loyal_users      += row.total_loyal_users || 0;
    channelMeta[ch].inmarket         += row.total_inmarket || 0;
    channelMeta[ch].newsletter       += row.total_newsletter_signups || 0;
    grandTotal += row.total_pageviews || 0;
  }

  // Compute derived rates per channel
  const channelRates = {};
  for (const [ch, m] of Object.entries(channelMeta)) {
    const loyal_pct     = m.users > 0 ? (m.loyal_users / m.users) * 100 : 0;
    const inmarket_pct  = m.users > 0 ? (m.inmarket    / m.users) * 100 : 0;
    const news_per_1k   = m.users > 0 ? (m.newsletter  / m.users) * 1000 : 0;
    channelRates[ch] = { loyal_pct, inmarket_pct, news_per_1k, ...m };
  }

  // Compute score 0-100 — normalize each metric relative to best channel
  const maxLoyal  = Math.max(...Object.values(channelRates).map(r => r.loyal_pct), 0.01);
  const maxInmkt  = Math.max(...Object.values(channelRates).map(r => r.inmarket_pct), 0.01);
  const maxNews   = Math.max(...Object.values(channelRates).map(r => r.news_per_1k), 0.01);
  for (const ch of Object.keys(channelRates)) {
    const r = channelRates[ch];
    r.score = Math.round(
      (r.loyal_pct   / maxLoyal) * 35 +
      (r.inmarket_pct/ maxInmkt) * 30 +
      (r.news_per_1k / maxNews)  * 35
    );
  }

  // Sort channels by total pageviews
  const sortedChannels = Object.entries(channelTotals)
    .sort((a, b) => b[1] - a[1])
    .filter(([, pv]) => pv > 0);

  const barStyle = (color, pct) => ({
    display: 'inline-block',
    width: `${Math.max(2, pct)}%`,
    height: 8,
    background: color,
    borderRadius: 4,
    opacity: 0.85,
    verticalAlign: 'middle',
    marginRight: 8,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Published:</span>
        <DatePresets onChange={(from, to) => {
          const next = { ...filters, from, to };
          setFilters(next);
          load(next);
        }} />
        <select value={filters.type} onChange={e => setFilter('type', e.target.value)}>
          <option value="">All Types</option>
          {types.map(t => <option key={t.content_type} value={t.content_type}>{t.content_type} ({t.count})</option>)}
        </select>
        {!loading && grandTotal > 0 && (
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>
            {fmt(grandTotal)} total pageviews
          </span>
        )}
      </div>

      {/* Channel Performance — GA4 direct measurement */}
      {perf.length > 0 && (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 15, color: 'var(--text-primary)', margin: 0 }}>Channel Performance</h3>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '2px 0 0' }}>
                Direct GA4 measurement — actual conversions per channel, last 30 days
              </p>
            </div>
          </div>
          {(() => {
            const sortedPerf = [...perf].sort((a, b) => {
              const av = a[perfSort.key] ?? 0;
              const bv = b[perfSort.key] ?? 0;
              if (typeof av === 'string') return perfSort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
              return perfSort.dir === 'asc' ? av - bv : bv - av;
            });
            const maxSub = Math.max(...perf.map(r => r.sub_per_1k || 0), 0.01);
            const handleSort = (key) => setPerfSort(s =>
              s.key === key ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { key, dir: 'desc' }
            );
            return (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)' }}>
                    {PERF_COLS.map(col => (
                      <th key={col.key} onClick={() => handleSort(col.key)} style={{
                        padding: '9px 14px', textAlign: col.align, fontSize: 11, fontWeight: 600,
                        textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap',
                        cursor: 'pointer', userSelect: 'none',
                        color: perfSort.key === col.key ? 'var(--accent-gold)' : 'var(--text-muted)',
                      }}>
                        {col.label}
                        <span style={{ marginLeft: 4, opacity: perfSort.key === col.key ? 1 : 0.25 }}>
                          {perfSort.key === col.key ? (perfSort.dir === 'desc' ? '↓' : '↑') : '↕'}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedPerf.map(row => (
                    <tr key={row.channel} style={{ borderBottom: '1px solid var(--border-subtle)' }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                      onMouseLeave={e => e.currentTarget.style.background = ''}>
                      <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{row.channel}</td>
                      <td style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)', textAlign: 'right' }}>{fmt(row.users)}</td>
                      <td style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)', textAlign: 'right' }}>{fmt(row.subscribe_clicks)}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
                          <div style={{ width: 60, height: 4, background: 'var(--bg-elevated)', borderRadius: 2 }}>
                            <div style={{ height: '100%', borderRadius: 2, background: 'var(--accent-gold)', width: `${((row.sub_per_1k || 0) / maxSub) * 100}%` }} />
                          </div>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: (row.sub_per_1k || 0) > 0 ? 'var(--accent-gold)' : 'var(--text-muted)', minWidth: 36 }}>
                            {(row.sub_per_1k || 0).toFixed(2)}
                          </span>
                        </div>
                      </td>
                      <td style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)', textAlign: 'right' }}>{fmtSec(row.avg_engagement_time)}</td>
                      <td style={{ padding: '10px 14px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)', textAlign: 'right' }}>${(row.rev_per_1k || 0).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          })()}
          <div style={{ padding: '10px 16px', fontSize: 11, color: 'var(--text-muted)', borderTop: '1px solid var(--border-subtle)', fontStyle: 'italic' }}>
            Note: GA4 groups Google Discover and Google News into "Organic Search". "Direct" includes dark social. Use the volume breakdown below for finer distinctions.
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ padding: 40, color: 'var(--text-muted)' }}>Loading...</div>
      ) : grandTotal === 0 ? (
        <div style={{ padding: 40, color: 'var(--text-muted)', textAlign: 'center' }}>
          No source data yet — trigger an analytics sync to populate.
        </div>
      ) : (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          {/* Column headers */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '180px 1fr 90px 80px 80px 80px 60px 32px',
            padding: '8px 16px',
            borderBottom: '2px solid var(--border)',
            background: 'var(--bg-elevated)',
          }}>
            {['Channel', 'Traffic Share', 'Pageviews', 'Articles', 'Loyal %', 'In-Market %', 'Newsletter', 'Score', ''].map((h, i) => (
              <div key={i} style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: i > 1 ? 'right' : 'left' }}>
                {h}
              </div>
            ))}
          </div>
          {/* Channel summary rows */}
          {sortedChannels.map(([chKey, total]) => {
            const ch = CHANNELS[chKey];
            const pct = grandTotal > 0 ? (total / grandTotal) * 100 : 0;
            const isOpen = expanded === chKey;
            const sources = (channelSources[chKey] || []).sort((a, b) => b.total_pageviews - a.total_pageviews);

            return (
              <div key={chKey} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                {/* Channel header row */}
                <div
                  onClick={() => setExpanded(isOpen ? null : chKey)}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '180px 1fr 90px 80px 80px 80px 60px 32px',
                    alignItems: 'center',
                    padding: '14px 16px',
                    cursor: 'pointer',
                    background: isOpen ? 'var(--bg-elevated)' : 'transparent',
                    transition: 'background 0.1s',
                  }}
                  onMouseEnter={e => { if (!isOpen) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                  onMouseLeave={e => { if (!isOpen) e.currentTarget.style.background = 'transparent'; }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: ch.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>{ch.label}</span>
                  </div>
                  <div style={{ padding: '0 16px' }}>
                    <span style={barStyle(ch.color, pct)} />
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{pct.toFixed(1)}%</span>
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-primary)', textAlign: 'right' }}>
                    {fmt(total)}
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)', textAlign: 'right' }}>
                    {sources.reduce((s, r) => s + r.article_count, 0)} arts
                  </div>
                  {/* Loyal % */}
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)', textAlign: 'right' }}>
                    {channelRates[chKey]?.loyal_pct > 0 ? channelRates[chKey].loyal_pct.toFixed(1) + '%' : '—'}
                  </div>
                  {/* In-market % */}
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)', textAlign: 'right' }}>
                    {channelRates[chKey]?.inmarket_pct > 0 ? channelRates[chKey].inmarket_pct.toFixed(1) + '%' : '—'}
                  </div>
                  {/* Newsletter */}
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)', textAlign: 'right' }}>
                    {fmt(channelRates[chKey]?.newsletter)}
                  </div>
                  {/* Score */}
                  <div style={{ textAlign: 'right' }}>
                    {channelRates[chKey]?.score > 0 ? (
                      <span style={{
                        fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 600,
                        color: 'var(--accent-gold)',
                        background: 'var(--accent-gold-bg)',
                        padding: '2px 6px', borderRadius: 4,
                      }}>
                        {channelRates[chKey].score}
                      </span>
                    ) : '—'}
                  </div>
                  <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
                    {isOpen ? '▲' : '▼'}
                  </div>
                </div>

                {/* Expanded: individual sources within this channel */}
                {isOpen && (
                  <div style={{ background: 'var(--bg-elevated)', borderTop: '1px solid var(--border-subtle)' }}>
                    {sources.map(row => {
                      const sPct = total > 0 ? (row.total_pageviews / total) * 100 : 0;
                      return (
                        <div key={row.source} style={{
                          display: 'grid',
                          gridTemplateColumns: '180px 1fr 90px 80px 80px 80px 60px 32px',
                          alignItems: 'center',
                          padding: '10px 16px 10px 36px',
                          borderBottom: '1px solid var(--border-subtle)',
                        }}>
                          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{row.source}</span>
                          <div style={{ padding: '0 16px' }}>
                            <span style={{ ...barStyle(ch.color, sPct), opacity: 0.5 }} />
                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{sPct.toFixed(1)}% of channel</span>
                          </div>
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)', textAlign: 'right' }}>
                            {fmt(row.total_pageviews)}
                          </div>
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)', textAlign: 'right' }}>
                            {row.article_count} arts
                          </div>
                          <div /><div /><div /><div />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
