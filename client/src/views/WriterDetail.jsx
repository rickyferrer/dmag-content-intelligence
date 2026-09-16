import React, { useEffect, useState } from 'react';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { api } from '../api/index.js';
import NeedBadge, { NEED_META } from '../components/NeedBadge.jsx';

function fmt(n) {
  if (n === null || n === undefined) return '—';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(Math.round(n));
}

function StatRow({ label, value, accent }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
      <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontSize: 14, fontFamily: 'var(--font-mono)', color: accent ? 'var(--accent-gold)' : 'var(--text-primary)' }}>{value}</span>
    </div>
  );
}

// `writer` is a row from Writers.jsx's by-writer data — already carries the
// aggregate stats for the currently active date range (avoids re-fetching
// them), so this only needs to fetch that writer's individual articles (for
// the pie chart + article list) via the same /api/content?writer= filter
// the Content tab's own Writer dropdown uses, scoped to the same date range
// so the panel always matches the row it was opened from.
export default function WriterDetail({ writer, dateFrom, dateTo, onClose }) {
  const [articles, setArticles] = useState([]);
  const [needCounts, setNeedCounts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!writer) return;
    setLoading(true);
    const contentParams = { writer: writer.writer, limit: 200, sortBy: 'lifetime_value', order: 'desc' };
    const needParams = { writer: writer.writer };
    if (dateFrom) { contentParams.dateFrom = dateFrom; needParams.dateFrom = dateFrom; }
    if (dateTo)   { contentParams.dateTo = dateTo;     needParams.dateTo = dateTo; }
    Promise.all([
      api.getContent(contentParams).then(res => setArticles(res.data || [])),
      // A prolific writer can have far more articles than the 200-row cap
      // on /api/content above, so the pie chart pulls counts from the
      // aggregate by-need endpoint instead of the (possibly truncated)
      // article list — otherwise a high-volume writer's breakdown would
      // silently reflect only their top 200 by Content Value.
      api.getByNeed(needParams).then(setNeedCounts),
    ])
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [writer?.writer, dateFrom, dateTo]);

  if (!writer) return null;

  const pieData = needCounts
    .map(d => ({
      need: d.user_need,
      label: NEED_META[d.user_need]?.label || 'Unclassified',
      color: NEED_META[d.user_need]?.color || '#888',
      count: d.article_count,
    }))
    .sort((a, b) => b.count - a.count);

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0,
      width: 480, background: 'var(--bg-surface)',
      borderLeft: '1px solid var(--border)',
      overflowY: 'auto', zIndex: 100,
      display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 20, lineHeight: 1.3, color: 'var(--text-primary)' }}>
            {writer.writer}
          </h2>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 22, lineHeight: 1, padding: 4, cursor: 'pointer' }}>×</button>
      </div>

      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* Summary stats — same numbers as the table row, just easier to read */}
        <div>
          <h3 style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
            Writer Summary
          </h3>
          <div style={{ background: 'var(--bg-elevated)', borderRadius: 6, padding: '4px 0' }}>
            <StatRow label="Articles" value={writer.article_count} />
            <StatRow label="Total Content Value" value={writer.total_true_value != null ? Math.round(writer.total_true_value) : '—'} accent />
            <StatRow label="Avg Content Value" value={writer.avg_true_value != null ? writer.avg_true_value.toFixed(1) : '—'} />
            <StatRow label="Users" value={fmt(writer.total_users)} />
            <StatRow label="Loyal Users" value={fmt(writer.total_loyal_users)} />
            <StatRow label="Pageviews" value={fmt(writer.total_pageviews)} />
            <StatRow label="Sub Clicks" value={fmt(writer.total_subscribe_clicks)} />
            <StatRow label="Newsletter Signups" value={fmt(writer.total_newsletter_signups)} />
            <StatRow label="Avg Engagement" value={writer.avg_engagement_time ? writer.avg_engagement_time.toFixed(0) + 's' : '—'} />
          </div>
        </div>

        {/* User Needs breakdown */}
        <div>
          <h3 style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
            Content by User Need
          </h3>
          {loading ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>Loading…</div>
          ) : pieData.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>No articles found for this writer.</div>
          ) : (
            <ResponsiveContainer width="100%" height={230}>
              <PieChart>
                <Pie data={pieData} dataKey="count" nameKey="label" cx="38%" cy="50%" innerRadius={42} outerRadius={78} paddingAngle={2} isAnimationActive={false}>
                  {pieData.map((d, i) => <Cell key={i} fill={d.color} stroke="var(--bg-elevated)" strokeWidth={2} />)}
                </Pie>
                <Tooltip
                  contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 }}
                  formatter={(value, name) => [`${value} article${value === 1 ? '' : 's'}`, name]}
                />
                <Legend
                  layout="vertical" align="right" verticalAlign="middle"
                  formatter={(value, entry) => (
                    <span style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{value} ({entry.payload.count})</span>
                  )}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Article list */}
        <div>
          <h3 style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
            Articles {!loading && `(${articles.length})`}
          </h3>
          {loading ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
          ) : articles.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>No articles found for this writer.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {articles.map(a => (
                <a key={a.wp_id} href={a.url} target="_blank" rel="noopener noreferrer"
                  style={{ display: 'block', padding: '10px 0', borderBottom: '1px solid var(--border-subtle)', textDecoration: 'none' }}
                >
                  <div style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 5, lineHeight: 1.4 }}>{a.title}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <NeedBadge need={a.user_need} />
                    <span style={{ fontSize: 12, color: 'var(--accent-gold)', fontFamily: 'var(--font-mono)' }}>
                      LTV {a.lifetime_value != null ? Math.round(a.lifetime_value) : '—'}
                    </span>
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
