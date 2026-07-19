import React, { useEffect, useState } from 'react';
import { api } from '../api/index.js';
import TrueValueBar from '../components/TrueValueBar.jsx';
import DatePresets, { resolveDates, DEFAULT_PRESET } from '../components/DatePresets.jsx';

function fmt(n) {
  if (n === null || n === undefined) return '—';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(Math.round(n));
}

function YoY({ current, prior }) {
  if (!prior || prior === 0) return <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>—</span>;
  const pct = ((current - prior) / prior) * 100;
  const isPos = pct >= 0;
  const color = isPos ? '#4caf86' : '#e05c5c';
  const sign = isPos ? '+' : '';
  return (
    <span style={{
      fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 600,
      color, background: color + '18', padding: '2px 6px', borderRadius: 4,
    }}>
      {sign}{pct.toFixed(0)}%
    </span>
  );
}

const { from: initFrom, to: initTo } = resolveDates(DEFAULT_PRESET);

export default function Sections() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [types, setTypes] = useState([]);
  const [filters, setFilters] = useState({ from: initFrom, to: initTo, type: '', preset: DEFAULT_PRESET });

  const load = ({ from, to, type }) => {
    setLoading(true);
    const params = {};
    if (from) params.dateFrom = from;
    if (to) params.dateTo = to;
    if (type) params.type = type;
    api.getBySection(params)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load({ from: initFrom, to: initTo, type: '' });
    api.getContentTypes().then(setTypes).catch(console.error);
  }, []);

  const setFilter = (key, value) => {
    const next = { ...filters, [key]: value };
    setFilters(next);
    load(next);
  };

  const maxTv = Math.max(...data.map(d => d.avg_true_value || 0), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Filter bar */}
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
          {types.map(t => (
            <option key={t.content_type} value={t.content_type}>{t.content_type} ({t.count})</option>
          ))}
        </select>
        {!loading && (
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>
            {data.length} sections
          </span>
        )}
      </div>

      {loading ? (
        <div style={{ padding: 40, color: 'var(--text-muted)' }}>Loading...</div>
      ) : (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border)', background: 'var(--bg-elevated)' }}>
                {['Section', 'Articles', 'Total True Value', 'YOY', 'Users', 'Loyal Users', 'Pageviews', 'Sub Clicks', 'Newsletter', 'Avg Eng. Time', 'Top Article'].map(h => (
                  <th key={h} style={{
                    padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600,
                    color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em',
                    whiteSpace: 'nowrap',
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map(row => (
                <tr key={row.section}
                  style={{ borderBottom: '1px solid var(--border-subtle)' }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                  onMouseLeave={e => e.currentTarget.style.background = ''}
                >
                  <td style={{ padding: '10px 12px', fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                    {row.section}
                  </td>
                  <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-secondary)', textAlign: 'right' }}>
                    {row.article_count}
                  </td>
                  <td style={{ padding: '10px 12px', minWidth: 140 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, height: 6, background: 'var(--bg-elevated)', borderRadius: 3 }}>
                        <div style={{
                          height: '100%', borderRadius: 3,
                          width: `${((row.avg_true_value || 0) / maxTv) * 100}%`,
                          background: 'var(--accent-gold)', opacity: 0.8,
                        }} />
                      </div>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--accent-gold)', minWidth: 42, textAlign: 'right' }}>
                        {row.avg_true_value != null ? Math.round(row.avg_true_value) : '—'}
                      </span>
                    </div>
                  </td>
                  <td style={{ padding: '10px 12px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                    <YoY current={row.avg_true_value || 0} prior={row.py?.py_total_true_value} />
                  </td>
                  <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)', textAlign: 'right' }}>
                    {fmt(row.total_users)}
                  </td>
                  <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)', textAlign: 'right' }}>
                    {fmt(row.total_loyal_users)}
                  </td>
                  <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)', textAlign: 'right' }}>
                    {fmt(row.total_pageviews)}
                  </td>
                  <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)', textAlign: 'right' }}>
                    {fmt(row.total_subscribe_clicks)}
                  </td>
                  <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)', textAlign: 'right' }}>
                    {fmt(row.total_newsletter_signups)}
                  </td>
                  <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {row.avg_engagement_time != null ? row.avg_engagement_time.toFixed(0) + 's' : '—'}
                  </td>
                  <td style={{ padding: '10px 12px', maxWidth: 260 }}>
                    {row.top_article ? (
                      <div>
                        <a href={row.top_article.url} target="_blank" rel="noopener noreferrer"
                          style={{ fontSize: 12, color: 'var(--accent-gold)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {row.top_article.title}
                        </a>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                          TV {row.top_article.true_value?.toFixed(1)}
                        </span>
                      </div>
                    ) : '—'}
                  </td>
                </tr>
              ))}
              {data.length === 0 && (
                <tr>
                  <td colSpan={11} style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                    No section data found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
