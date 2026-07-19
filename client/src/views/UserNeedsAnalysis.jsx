import React, { useEffect, useState } from 'react';
import { api } from '../api/index.js';
import { NEED_META } from '../components/NeedBadge.jsx';
import DatePresets, { resolveDates, DEFAULT_PRESET } from '../components/DatePresets.jsx';

const ALL_NEEDS = [
  'update_me', 'educate_me', 'give_perspective', 'divert_me',
  'inspire_me', 'help_me', 'connect_me', 'keep_me_engaged',
];

function fmt(n) {
  if (n === null || n === undefined) return '—';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(Math.round(n));
}

export default function UserNeedsAnalysis() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ from: '', to: '' });

  const load = ({ from, to }) => {
    setLoading(true);
    const params = {};
    if (from) params.dateFrom = from;
    if (to)   params.dateTo = to;
    api.getByNeed(params)
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { load({ from: '', to: '' }); }, []);

  const dataMap = Object.fromEntries(data.map(d => [d.user_need, d]));

  // Cards in total-value order; needs with no data go to the end
  const sortedNeeds = [...ALL_NEEDS].sort((a, b) => {
    const ta = dataMap[a]?.total_true_value || 0;
    const tb = dataMap[b]?.total_true_value || 0;
    return tb - ta;
  });

  const maxTotal = Math.max(...data.map(d => d.total_true_value || 0), 1);

  // Gap: needs with fewer than 5 articles (always across all needs)
  const gaps = ALL_NEEDS.filter(n => !dataMap[n] || dataMap[n].article_count < 5);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Date filter */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Published:</span>
        <DatePresets defaultValue="all" onChange={(from, to) => {
          const next = { from, to };
          setFilters(next);
          load(next);
        }} />
      </div>

      {/* Gap analysis */}
      {gaps.length > 0 && (
        <div style={{
          background: 'var(--accent-gold-bg)', border: '1px solid var(--accent-gold-dim)',
          borderRadius: 8, padding: '14px 18px',
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent-gold)', marginBottom: 6 }}>
            Gap Analysis — Underserved User Needs
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
            {gaps.map(n => {
              const meta = NEED_META[n];
              const count = dataMap[n]?.article_count || 0;
              return (
                <span key={n} style={{ display: 'inline-block', marginRight: 12 }}>
                  <span style={{ color: meta.color }}>{meta.label}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: 11 }}> ({count} articles)</span>
                </span>
              );
            })}
          </div>
        </div>
      )}

      {loading ? (
        <div style={{ padding: 40, color: 'var(--text-muted)' }}>Loading...</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
          {sortedNeeds.map(need => {
            const meta = NEED_META[need];
            const d = dataMap[need];
            const totalPct = d ? ((d.total_true_value || 0) / maxTotal) * 100 : 0;

            return (
              <div key={need} style={{
                background: 'var(--bg-surface)', border: `1px solid ${meta.color}33`,
                borderTop: `3px solid ${meta.color}`,
                borderRadius: 8, padding: 18,
                opacity: d ? 1 : 0.4,
              }}>
                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                  <div>
                    <div style={{ fontSize: 15, fontFamily: 'var(--font-display)', color: meta.color }}>{meta.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{d ? d.article_count : 0} articles</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 22, fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--accent-gold)', lineHeight: 1 }}>
                      {d?.total_true_value != null ? Math.round(d.total_true_value) : '—'}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>total value</div>
                  </div>
                </div>

                {/* Total value bar */}
                <div style={{ marginBottom: 14 }}>
                  <div style={{ height: 4, background: 'var(--bg-elevated)', borderRadius: 2 }}>
                    <div style={{ height: '100%', width: `${totalPct}%`, background: meta.fill, borderRadius: 2, opacity: 0.9 }} />
                  </div>
                </div>

                {/* Stats grid */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Subscribe Clicks</div>
                    <div style={{ fontSize: 14, fontFamily: 'var(--font-mono)', fontWeight: 500, color: 'var(--text-primary)' }}>
                      {d ? fmt(d.total_subscribe_clicks) : '—'}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Newsletter Signups</div>
                    <div style={{ fontSize: 14, fontFamily: 'var(--font-mono)', fontWeight: 500, color: 'var(--text-primary)' }}>
                      {d ? fmt(d.total_newsletter_signups) : '—'}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Avg True Value</div>
                    <div style={{ fontSize: 14, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                      {d?.avg_true_value != null ? d.avg_true_value.toFixed(1) : '—'}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>Avg Engagement</div>
                    <div style={{ fontSize: 14, fontFamily: 'var(--font-mono)', color: 'var(--text-secondary)' }}>
                      {d?.avg_engagement_time != null ? d.avg_engagement_time.toFixed(0) + 's' : '—'}
                    </div>
                  </div>
                </div>

                {/* Top article */}
                {d?.top_article && (
                  <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>Top Article</div>
                    <a href={d.top_article.url} target="_blank" rel="noopener noreferrer"
                      style={{ fontSize: 12, color: meta.color, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {d.top_article.title}
                    </a>
                    <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', marginTop: 2 }}>
                      Score: {d.top_article.true_value != null ? Math.round(d.top_article.true_value) : '—'}
                    </div>
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
