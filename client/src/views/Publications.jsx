import React, { useEffect, useState } from 'react';
import { api } from '../api/index.js';

const PUB_LABELS = {
  'D Magazine': 'd-magazine',
  'D Home': 'd-home',
  'D CEO': 'd-ceo',
};
const PUB_DISPLAY = Object.fromEntries(Object.entries(PUB_LABELS).map(([k, v]) => [v, k]));

const PUB_COLORS = {
  'd-magazine': '#c9a84c',
  'd-home': '#5b9bd5',
  'd-ceo': '#7c5cbf',
};

function fmt(n) {
  if (n === null || n === undefined) return '—';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(Math.round(n));
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

export default function Publications() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pubFilter, setPubFilter] = useState('');
  const [yearFilter, setYearFilter] = useState('');
  const [sort, setSort] = useState({ col: 'date', dir: 'desc' });

  const load = (pub, year) => {
    setLoading(true);
    const params = {};
    if (pub) params.publication = pub;
    if (year) params.year = year;
    api.getByIssue(params)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { load('', ''); }, []);

  const years = [...new Set(data.map(d => d.year))].sort((a, b) => b - a);

  const handlePub = (v) => { setPubFilter(v); load(v, yearFilter); };
  const handleYear = (v) => { setYearFilter(v); load(pubFilter, v); };

  const toggleSort = (col) => {
    setSort(s => s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'desc' });
  };

  const MONTH_ORDER = { january:1, february:2, march:3, april:4, may:5, june:6, july:7, august:8, september:9, october:10, november:11, december:12 };

  const sorted = [...data].sort((a, b) => {
    let av, bv;
    if (sort.col === 'date') {
      av = Number(a.year) * 100 + (MONTH_ORDER[a.month.toLowerCase()] || 0);
      bv = Number(b.year) * 100 + (MONTH_ORDER[b.month.toLowerCase()] || 0);
    } else if (sort.col === 'publication') {
      av = a.publication; bv = b.publication;
    } else {
      av = a[sort.col] || 0; bv = b[sort.col] || 0;
    }
    if (av < bv) return sort.dir === 'asc' ? -1 : 1;
    if (av > bv) return sort.dir === 'asc' ? 1 : -1;
    return 0;
  });

  const COLS = [
    { key: 'date',                    label: 'Issue' },
    { key: 'publication',             label: 'Publication' },
    { key: 'article_count',           label: 'Articles' },
    { key: 'total_true_value',        label: 'Total True Value' },
    { key: 'total_users',             label: 'Users' },
    { key: 'total_loyal_users',       label: 'Loyal' },
    { key: 'total_pageviews',         label: 'Pageviews' },
    { key: 'total_subscribe_clicks',  label: 'Sub Clicks' },
    { key: 'total_newsletter_signups',label: 'Newsletter' },
    { key: 'avg_engagement_time',     label: 'Avg Eng.' },
    { key: 'top_article',             label: 'Top Article' },
  ];

  const Th = ({ col }) => {
    const active = sort.col === col.key;
    return (
      <th
        onClick={() => toggleSort(col.key)}
        style={{
          padding: '10px 12px', textAlign: col.key === 'top_article' ? 'left' : 'left',
          fontSize: 11, fontWeight: 600, color: active ? 'var(--accent-gold)' : 'var(--text-muted)',
          textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap',
          cursor: 'pointer', userSelect: 'none',
        }}
      >
        {col.label}{active ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
      </th>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Filter bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <select value={pubFilter} onChange={e => handlePub(e.target.value)}>
          <option value="">All Publications</option>
          {Object.keys(PUB_LABELS).map(label => (
            <option key={label} value={PUB_LABELS[label]}>{label}</option>
          ))}
        </select>
        <select value={yearFilter} onChange={e => handleYear(e.target.value)}>
          <option value="">All Years</option>
          {years.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 4 }}>
          Last 2 years
        </span>
        {!loading && (
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>
            {sorted.length} issues
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
                {COLS.map(col => <Th key={col.key} col={col} />)}
              </tr>
            </thead>
            <tbody>
              {sorted.map(row => {
                const pubColor = PUB_COLORS[row.publication] || 'var(--accent-gold)';
                const pubName = PUB_DISPLAY[row.publication] || row.publication;
                return (
                  <tr key={`${row.publication}|${row.year}|${row.month}`}
                    style={{ borderBottom: '1px solid var(--border-subtle)' }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                    onMouseLeave={e => e.currentTarget.style.background = ''}
                  >
                    {/* Issue */}
                    <td style={{ padding: '10px 12px', fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                      {capitalize(row.month)} {row.year}
                    </td>
                    {/* Publication */}
                    <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                      <span style={{
                        fontSize: 11, fontWeight: 600, color: pubColor,
                        background: pubColor + '18', padding: '2px 7px', borderRadius: 4,
                      }}>
                        {pubName}
                      </span>
                    </td>
                    {/* Articles */}
                    <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-secondary)', textAlign: 'right' }}>
                      {row.article_count}
                    </td>
                    {/* Total True Value */}
                    <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--accent-gold)', textAlign: 'right', fontWeight: 600 }}>
                      {row.total_true_value != null ? Math.round(row.total_true_value) : '—'}
                    </td>
                    {/* Users */}
                    <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)', textAlign: 'right' }}>
                      {fmt(row.total_users)}
                    </td>
                    {/* Loyal */}
                    <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)', textAlign: 'right' }}>
                      {fmt(row.total_loyal_users)}
                    </td>
                    {/* Pageviews */}
                    <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)', textAlign: 'right' }}>
                      {fmt(row.total_pageviews)}
                    </td>
                    {/* Sub Clicks */}
                    <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)', textAlign: 'right' }}>
                      {fmt(row.total_subscribe_clicks)}
                    </td>
                    {/* Newsletter */}
                    <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)', textAlign: 'right' }}>
                      {fmt(row.total_newsletter_signups)}
                    </td>
                    {/* Avg Engagement */}
                    <td style={{ padding: '10px 12px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-secondary)', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {row.avg_engagement_time ? row.avg_engagement_time.toFixed(0) + 's' : '—'}
                    </td>
                    {/* Top Article */}
                    <td style={{ padding: '10px 12px', maxWidth: 260 }}>
                      {row.top_article ? (
                        <div>
                          <a href={row.top_article.url} target="_blank" rel="noopener noreferrer"
                            style={{ fontSize: 12, color: pubColor, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {row.top_article.title}
                          </a>
                          <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                            TV {row.top_article.true_value != null ? Math.round(row.top_article.true_value) : '—'}
                          </span>
                        </div>
                      ) : '—'}
                    </td>
                  </tr>
                );
              })}
              {sorted.length === 0 && (
                <tr>
                  <td colSpan={11} style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                    No publication issues found
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
