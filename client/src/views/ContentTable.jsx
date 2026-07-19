import React, { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '../api/index.js';
import NeedBadge from '../components/NeedBadge.jsx';
import TrueValueBar from '../components/TrueValueBar.jsx';
import DatePresets, { resolveDates, DEFAULT_PRESET } from '../components/DatePresets.jsx';

// Maps column header label → API sort key
const COLUMNS = [
  { label: 'Title',         key: 'title' },
  { label: 'Type',          key: 'type' },
  { label: 'Section',       key: 'section' },
  { label: 'Published',     key: 'published_at' },
  { label: 'User Need',     key: 'need' },
  { label: 'Est. Value',    key: 'true_value' },
  { label: 'Users',         key: 'users' },
  { label: 'Loyal Users',   key: 'loyal_users' },
  { label: 'In-Market %',   key: 'inmarket' },
  { label: 'Sub Clicks',    key: 'subscribe_clicks' },
  { label: 'Newsletter',    key: 'newsletter' },
  { label: 'Eng. Time',     key: 'engagement' },
];

const USER_NEEDS = [
  'update_me', 'educate_me', 'give_perspective', 'divert_me',
  'inspire_me', 'help_me', 'connect_me', 'keep_me_engaged',
];

function fmt(n) {
  if (n === null || n === undefined) return '—';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(Math.round(n));
}

function SortArrow({ col, sortBy, order }) {
  if (sortBy !== col) {
    return <span style={{ opacity: 0.25, marginLeft: 4, fontSize: 10 }}>↕</span>;
  }
  return <span style={{ marginLeft: 4, fontSize: 10, color: 'var(--accent-gold)' }}>
    {order === 'desc' ? '↓' : '↑'}
  </span>;
}

const { from: initFrom, to: initTo } = resolveDates(DEFAULT_PRESET);

export default function ContentTable({ onSelect }) {
  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, total: 0, pages: 1 });
  const [loading, setLoading] = useState(false);
  const [types, setTypes] = useState([]);
  const [taxonomies, setTaxonomies] = useState({ sections: [], categories: [], tags: [] });
  const [writers, setWriters] = useState([]);

  const [issues, setIssues] = useState([]);
  const [filters, setFilters] = useState({
    type: '', section: '', category: '', need: '', writer: '', issue: '',
    datePreset: DEFAULT_PRESET, dateFrom: initFrom, dateTo: initTo,
    sortBy: 'published_at', order: 'desc', page: 1, limit: 50,
  });

  const filterRef = useRef(filters);
  filterRef.current = filters;

  const load = useCallback((f) => {
    setLoading(true);
    const params = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== ''));
    api.getContent(params)
      .then(res => {
        setRows(res.data);
        setPagination(res.pagination);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load(filters);
    api.getContentTypes().then(setTypes).catch(console.error);
    api.getTaxonomies().then(setTaxonomies).catch(console.error);
    api.getWriters().then(setWriters).catch(console.error);
    api.getByIssue().then(setIssues).catch(console.error);
  }, []);

  const setFilter = (key, value) => {
    const next = { ...filterRef.current, [key]: value, page: 1 };
    setFilters(next);
    load(next);
  };

  const handleHeaderClick = (colKey) => {
    const cur = filterRef.current;
    // Clicking the active sort column toggles direction; clicking a new column defaults to desc
    const newOrder = cur.sortBy === colKey && cur.order === 'desc' ? 'asc' : 'desc';
    const next = { ...cur, sortBy: colKey, order: newOrder, page: 1 };
    setFilters(next);
    load(next);
  };

  const setPage = (p) => {
    const next = { ...filterRef.current, page: p };
    setFilters(next);
    load(next);
  };

  const thStyle = (colKey) => ({
    padding: '10px 12px',
    textAlign: colKey === 'title' ? 'left' : 'left',
    fontSize: 11,
    fontWeight: 600,
    color: filters.sortBy === colKey ? 'var(--accent-gold)' : 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    userSelect: 'none',
    transition: 'color 0.1s',
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Filter bar */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 8,
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 8, padding: 12,
      }}>
        <select value={filters.type} onChange={e => setFilter('type', e.target.value)}>
          <option value="">All Types</option>
          {types.map(t => <option key={t.content_type} value={t.content_type}>{t.content_type} ({t.count})</option>)}
        </select>

        <select value={filters.section} onChange={e => setFilter('section', e.target.value)}>
          <option value="">All Sections</option>
          {taxonomies.sections.slice(0, 50).map(s => <option key={s.section} value={s.section}>{s.section} ({s.count})</option>)}
        </select>

        <select value={filters.category} onChange={e => setFilter('category', e.target.value)}>
          <option value="">All Categories</option>
          {taxonomies.categories.slice(0, 100).map(c => <option key={c.slug} value={c.slug}>{c.name} ({c.count})</option>)}
        </select>

        <select value={filters.need} onChange={e => setFilter('need', e.target.value)}>
          <option value="">All User Needs</option>
          {USER_NEEDS.map(n => <option key={n} value={n}>{n.replace(/_/g, ' ')}</option>)}
        </select>

        <select value={filters.writer} onChange={e => setFilter('writer', e.target.value)}>
          <option value="">All Writers</option>
          {writers.map(w => <option key={w.writer} value={w.writer}>{w.writer} ({w.count})</option>)}
        </select>

        {issues.length > 0 && (
          <select value={filters.issue} onChange={e => setFilter('issue', e.target.value)}>
            <option value="">All Issues</option>
            {['d-magazine', 'd-home', 'd-ceo'].map(pub => {
              const pubIssues = issues.filter(i => i.publication === pub);
              if (!pubIssues.length) return null;
              const label = { 'D Magazine': 'd-magazine', 'D Home': 'd-home', 'D CEO': 'd-ceo' };
              const display = Object.fromEntries(Object.entries(label).map(([k, v]) => [v, k]));
              return (
                <optgroup key={pub} label={display[pub] || pub}>
                  {pubIssues.map(i => (
                    <option key={`${i.publication}/${i.year}/${i.month}`} value={`${i.publication}/${i.year}/${i.month}`}>
                      {i.month.charAt(0).toUpperCase() + i.month.slice(1)} {i.year}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </select>
        )}

        <DatePresets
          value={filters.datePreset}
          from={filters.dateFrom}
          to={filters.dateTo}
          onChange={(datePreset, dateFrom, dateTo) => {
            const next = { ...filterRef.current, datePreset, dateFrom, dateTo, page: 1 };
            setFilters(next);
            load(next);
          }}
        />

        <div style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 12, display: 'flex', alignItems: 'center' }}>
          {loading ? 'Loading…' : `${pagination.total.toLocaleString()} items`}
        </div>
      </div>

      {/* Table */}
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--border)', background: 'var(--bg-elevated)' }}>
              {COLUMNS.map(col => (
                <th
                  key={col.key}
                  style={thStyle(col.key)}
                  onClick={() => handleHeaderClick(col.key)}
                  title={`Sort by ${col.label}`}
                >
                  {col.label}
                  <SortArrow col={col.key} sortBy={filters.sortBy} order={filters.order} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.wp_id}
                onClick={() => onSelect?.(row.wp_id)}
                style={{
                  borderBottom: '1px solid var(--border-subtle)',
                  cursor: 'pointer',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                onMouseLeave={e => e.currentTarget.style.background = ''}
              >
                <td style={{ padding: '9px 12px', maxWidth: 300 }}>
                  <div style={{ fontSize: 13, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {row.title}
                  </div>
                  {(row.writer || row.author) && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{row.writer || row.author}</div>}
                </td>
                <td style={{ padding: '9px 12px', fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{row.content_type}</td>
                <td style={{ padding: '9px 12px', fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>{row.section || '—'}</td>
                <td style={{ padding: '9px 12px', fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                  {row.published_at ? row.published_at.slice(0, 10) : '—'}
                </td>
                <td style={{ padding: '9px 12px' }}>
                  <NeedBadge need={row.user_need} />
                </td>
                <td style={{ padding: '9px 12px', minWidth: 120 }}>
                  <TrueValueBar value={row.true_value} max={100} />
                </td>
                <td style={{ padding: '9px 12px', fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {fmt(row.ga4_users)}
                </td>
                <td style={{ padding: '9px 12px', fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {fmt(row.ga4_loyal_users)}
                </td>
                <td style={{ padding: '9px 12px', fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {row.ga4_users > 0 && row.ga4_inmarket_pageviews != null
                    ? Math.min(100, Math.round(row.ga4_inmarket_pageviews / row.ga4_users * 100)) + '%'
                    : '—'}
                </td>
                <td style={{ padding: '9px 12px', fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {fmt(row.ga4_subscribe_clicks)}
                </td>
                <td style={{ padding: '9px 12px', fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {fmt(row.mf_newsletter_signups)}
                </td>
                <td style={{ padding: '9px 12px', fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {row.ga4_avg_engagement_time != null ? row.ga4_avg_engagement_time.toFixed(0) + 's' : '—'}
                </td>
              </tr>
            ))}
            {rows.length === 0 && !loading && (
              <tr>
                <td colSpan={12} style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
                  No content found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pagination.pages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, alignItems: 'center' }}>
          <button
            onClick={() => setPage(pagination.page - 1)}
            disabled={pagination.page <= 1}
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-secondary)', padding: '6px 12px', opacity: pagination.page <= 1 ? 0.4 : 1 }}
          >
            ← Prev
          </button>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            Page {pagination.page} of {pagination.pages}
          </span>
          <button
            onClick={() => setPage(pagination.page + 1)}
            disabled={pagination.page >= pagination.pages}
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-secondary)', padding: '6px 12px', opacity: pagination.page >= pagination.pages ? 0.4 : 1 }}
          >
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
