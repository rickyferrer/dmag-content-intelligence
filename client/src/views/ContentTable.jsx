import React, { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '../api/index.js';
import NeedBadge from '../components/NeedBadge.jsx';
import TrueValueBar from '../components/TrueValueBar.jsx';
import DatePresets, { resolveDates, DEFAULT_PRESET } from '../components/DatePresets.jsx';
import SearchableSelect from '../components/SearchableSelect.jsx';

const PUB_DISPLAY = { 'd-magazine': 'D Magazine', 'd-home': 'D Home', 'd-ceo': 'D CEO' };

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
    type: '', section: '', category: '', need: '', writer: '', issue: '', search: '',
    datePreset: DEFAULT_PRESET, dateFrom: initFrom, dateTo: initTo,
    sortBy: 'published_at', order: 'desc', page: 1, limit: 50,
  });
  const [searchInput, setSearchInput] = useState('');

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

  // Debounce the title/URL search input so we're not firing a request on
  // every keystroke.
  useEffect(() => {
    const t = setTimeout(() => {
      if (searchInput !== filterRef.current.search) {
        setFilter('search', searchInput);
      }
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const clearFilter = (key) => {
    if (key === 'search') setSearchInput('');
    setFilter(key, '');
  };

  const clearAll = () => {
    setSearchInput('');
    const next = {
      ...filterRef.current,
      type: '', section: '', category: '', need: '', writer: '', issue: '', search: '',
      datePreset: DEFAULT_PRESET, dateFrom: initFrom, dateTo: initTo,
      page: 1,
    };
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

  const typeOptions = types.map(t => ({ value: t.content_type, label: `${t.content_type} (${t.count})` }));
  const sectionOptions = taxonomies.sections.slice(0, 50).map(s => ({ value: s.section, label: `${s.section} (${s.count})` }));
  const categoryOptions = taxonomies.categories.slice(0, 100).map(c => ({ value: c.slug, label: `${c.name} (${c.count})` }));
  const needOptions = USER_NEEDS.map(n => ({ value: n, label: n.replace(/_/g, ' ') }));
  const writerOptions = writers.map(w => ({ value: w.writer, label: `${w.writer} (${w.count})` }));
  const issueOptions = issues.map(i => ({
    value: `${i.publication}/${i.year}/${i.month}`,
    label: `${PUB_DISPLAY[i.publication] || i.publication} — ${i.month.charAt(0).toUpperCase() + i.month.slice(1)} ${i.year}`,
  }));

  // Active-filter chips — everything except sort/page/limit, which aren't "filters"
  const activeFilters = [];
  if (filters.search) activeFilters.push({ key: 'search', label: `Search: "${filters.search}"` });
  if (filters.type) activeFilters.push({ key: 'type', label: `Type: ${filters.type}` });
  if (filters.section) activeFilters.push({ key: 'section', label: `Section: ${filters.section}` });
  if (filters.category) {
    const cat = taxonomies.categories.find(c => c.slug === filters.category);
    activeFilters.push({ key: 'category', label: `Category: ${cat?.name || filters.category}` });
  }
  if (filters.need) activeFilters.push({ key: 'need', label: `Need: ${filters.need.replace(/_/g, ' ')}` });
  if (filters.writer) activeFilters.push({ key: 'writer', label: `Writer: ${filters.writer}` });
  if (filters.issue) {
    const opt = issueOptions.find(o => o.value === filters.issue);
    activeFilters.push({ key: 'issue', label: `Issue: ${opt?.label || filters.issue}` });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Filter bar */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'flex-start',
        background: 'var(--bg-surface)', border: '1px solid var(--border)',
        borderRadius: 8, padding: 12,
      }}>
        <input
          type="text"
          value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          placeholder="Search title or URL…"
          style={{
            padding: '6px 10px', fontSize: 13, minWidth: 200,
            border: `1px solid ${filters.search ? 'var(--accent-gold)' : 'var(--border)'}`,
            borderRadius: 4, background: 'var(--bg-surface)', color: 'var(--text-primary)',
          }}
        />

        <SearchableSelect value={filters.type} onChange={v => setFilter('type', v)} options={typeOptions} placeholder="All Types" />
        <SearchableSelect value={filters.section} onChange={v => setFilter('section', v)} options={sectionOptions} placeholder="All Sections" />
        <SearchableSelect value={filters.category} onChange={v => setFilter('category', v)} options={categoryOptions} placeholder="All Categories" />
        <SearchableSelect value={filters.need} onChange={v => setFilter('need', v)} options={needOptions} placeholder="All User Needs" />
        <SearchableSelect value={filters.writer} onChange={v => setFilter('writer', v)} options={writerOptions} placeholder="All Writers" minWidth={180} />
        {issues.length > 0 && (
          <SearchableSelect value={filters.issue} onChange={v => setFilter('issue', v)} options={issueOptions} placeholder="All Issues" minWidth={190} />
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

        <div style={{ marginLeft: 'auto', color: 'var(--text-muted)', fontSize: 12, display: 'flex', alignItems: 'center', height: 30 }}>
          {loading ? 'Loading…' : `${pagination.total.toLocaleString()} items`}
        </div>
      </div>

      {/* Active filter chips */}
      {activeFilters.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          {activeFilters.map(f => (
            <span key={f.key} style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: 12, color: 'var(--accent-gold)', background: 'var(--accent-gold-bg)',
              border: '1px solid var(--accent-gold)', borderRadius: 20, padding: '3px 6px 3px 10px',
            }}>
              {f.label}
              <button
                onClick={() => clearFilter(f.key)}
                aria-label={`Remove ${f.key} filter`}
                style={{
                  border: 'none', background: 'transparent', color: 'inherit',
                  cursor: 'pointer', fontSize: 13, lineHeight: 1, padding: '2px 4px',
                }}
              >
                ×
              </button>
            </span>
          ))}
          <button
            onClick={clearAll}
            style={{
              fontSize: 12, color: 'var(--text-muted)', background: 'transparent',
              border: 'none', textDecoration: 'underline', cursor: 'pointer', padding: '3px 4px',
            }}
          >
            Clear all
          </button>
        </div>
      )}

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
