import React, { useEffect, useState } from 'react';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { api } from '../api/index.js';
import NeedBadge, { NEED_META } from '../components/NeedBadge.jsx';

const PUB_DISPLAY = { 'd-magazine': 'D Magazine', 'd-home': 'D Home', 'd-ceo': 'D CEO', 'd-weddings': 'D Weddings' };
const PUB_COLORS = { 'd-magazine': '#c9a84c', 'd-home': '#5b9bd5', 'd-ceo': '#7c5cbf', 'd-weddings': '#c2679e' };

function fmt(n) {
  if (n === null || n === undefined) return '—';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(Math.round(n));
}

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

function StatRow({ label, value, accent }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: accent ? 'var(--accent-gold)' : 'var(--text-primary)' }}>{value}</span>
    </div>
  );
}

// `issue` is a row from Publications.jsx's by-issue data — already carries
// the aggregate stats (avoids re-fetching them), so this only needs to fetch
// the issue's individual articles (for the pie chart + article list) via the
// same /api/content?issue= filter the Content tab's own Issue dropdown uses.
export default function PublicationDetail({ issue, onClose }) {
  const [articles, setArticles] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!issue) return;
    setLoading(true);
    api.getContent({
      issue: `${issue.publication}/${issue.year}/${issue.month}`,
      limit: 200,
      sortBy: 'lifetime_value',
      order: 'desc',
    })
      .then(res => setArticles(res.data || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [issue?.publication, issue?.year, issue?.month]);

  if (!issue) return null;

  const pubColor = PUB_COLORS[issue.publication] || 'var(--accent-gold)';
  const pubName = PUB_DISPLAY[issue.publication] || issue.publication;

  // Share of ARTICLES per user need (a count, not value-weighted) — matches
  // "how all the content is split between user needs" literally.
  const needCounts = {};
  for (const a of articles) {
    const need = a.user_need || 'unclassified';
    needCounts[need] = (needCounts[need] || 0) + 1;
  }
  const pieData = Object.entries(needCounts)
    .map(([need, count]) => ({
      need,
      label: NEED_META[need]?.label || 'Unclassified',
      color: NEED_META[need]?.color || '#888',
      count,
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
      {/* Cover */}
      {issue.cover_image_url && (
        <img src={issue.cover_image_url} alt=""
          style={{ width: '100%', height: 200, objectFit: 'cover', display: 'block', borderBottom: '1px solid var(--border)' }}
        />
      )}

      {/* Header */}
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ flex: 1 }}>
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, lineHeight: 1.3, color: 'var(--text-primary)', marginBottom: 8 }}>
            {capitalize(issue.month)} {issue.year}
          </h2>
          <span style={{
            fontSize: 11, fontWeight: 600, color: pubColor,
            background: pubColor + '18', padding: '2px 7px', borderRadius: 4,
          }}>
            {pubName}
          </span>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 20, lineHeight: 1, padding: 4, cursor: 'pointer' }}>×</button>
      </div>

      <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* Summary stats — same numbers as the table row, just easier to read */}
        <div>
          <h3 style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
            Issue Summary
          </h3>
          <div style={{ background: 'var(--bg-elevated)', borderRadius: 6, padding: '4px 0' }}>
            <StatRow label="Articles" value={issue.article_count} />
            <StatRow label="Total Content Value" value={issue.total_true_value != null ? Math.round(issue.total_true_value) : '—'} accent />
            <StatRow label="Avg Content Value" value={issue.avg_true_value != null ? issue.avg_true_value.toFixed(1) : '—'} />
            <StatRow label="Users" value={fmt(issue.total_users)} />
            <StatRow label="Loyal Users" value={fmt(issue.total_loyal_users)} />
            <StatRow label="Pageviews" value={fmt(issue.total_pageviews)} />
            <StatRow label="Sub Clicks" value={fmt(issue.total_subscribe_clicks)} />
            <StatRow label="Newsletter Signups" value={fmt(issue.total_newsletter_signups)} />
            <StatRow label="Avg Engagement" value={issue.avg_engagement_time ? issue.avg_engagement_time.toFixed(0) + 's' : '—'} />
          </div>
        </div>

        {/* User Needs breakdown */}
        <div>
          <h3 style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
            Content by User Need
          </h3>
          {loading ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '20px 0', textAlign: 'center' }}>Loading…</div>
          ) : pieData.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 12, padding: '20px 0', textAlign: 'center' }}>No articles found for this issue.</div>
          ) : (
            <ResponsiveContainer width="100%" height={230}>
              <PieChart>
                <Pie data={pieData} dataKey="count" nameKey="label" cx="38%" cy="50%" innerRadius={42} outerRadius={78} paddingAngle={2} isAnimationActive={false}>
                  {pieData.map((d, i) => <Cell key={i} fill={d.color} stroke="var(--bg-elevated)" strokeWidth={2} />)}
                </Pie>
                <Tooltip
                  contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }}
                  formatter={(value, name) => [`${value} article${value === 1 ? '' : 's'}`, name]}
                />
                <Legend
                  layout="vertical" align="right" verticalAlign="middle"
                  formatter={(value, entry) => (
                    <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>{value} ({entry.payload.count})</span>
                  )}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Article list */}
        <div>
          <h3 style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
            Articles {!loading && `(${articles.length})`}
          </h3>
          {loading ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Loading…</div>
          ) : articles.length === 0 ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>No articles found for this issue.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {articles.map(a => (
                <a key={a.wp_id} href={a.url} target="_blank" rel="noopener noreferrer"
                  style={{ display: 'flex', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border-subtle)', textDecoration: 'none' }}
                >
                  {a.cover_image_url ? (
                    <img src={a.cover_image_url} alt=""
                      style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 4, flexShrink: 0, border: '1px solid var(--border)' }}
                    />
                  ) : (
                    <div style={{ width: 44, height: 44, borderRadius: 4, background: 'var(--bg-elevated)', flexShrink: 0, border: '1px solid var(--border)' }} />
                  )}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: 'var(--text-primary)', marginBottom: 5, lineHeight: 1.4 }}>{a.title}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <NeedBadge need={a.user_need} />
                      <span style={{ fontSize: 11, color: 'var(--accent-gold)', fontFamily: 'var(--font-mono)' }}>
                        LTV {a.lifetime_value != null ? Math.round(a.lifetime_value) : '—'}
                      </span>
                    </div>
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
