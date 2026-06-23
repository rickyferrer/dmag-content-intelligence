import React, { useEffect, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '../api/index.js';
import NeedBadge from '../components/NeedBadge.jsx';

function fmt(n) {
  if (n === null || n === undefined) return '—';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(Math.round(n));
}

function StatRow({ label, value, accent }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border-subtle)' }}>
      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{label}</span>
      <span style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: accent ? 'var(--accent-gold)' : 'var(--text-primary)' }}>{value}</span>
    </div>
  );
}

export default function ContentDetail({ wpId, onClose }) {
  const [item, setItem] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reclassifying, setReclassifying] = useState(false);

  useEffect(() => {
    if (!wpId) return;
    setLoading(true);
    api.getContentItem(wpId)
      .then(setItem)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [wpId]);

  const handleReclassify = async () => {
    setReclassifying(true);
    try {
      await api.reclassify(wpId);
      const updated = await api.getContentItem(wpId);
      setItem(updated);
    } catch (err) {
      alert('Reclassification error: ' + err.message);
    } finally {
      setReclassifying(false);
    }
  };

  if (!wpId) return null;

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
          {loading ? (
            <div style={{ color: 'var(--text-muted)' }}>Loading...</div>
          ) : (
            <>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 18, lineHeight: 1.3, color: 'var(--text-primary)', marginBottom: 8 }}>
                {item?.title}
              </h2>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <NeedBadge need={item?.user_need} size="lg" />
                {item?.user_need_secondary && <NeedBadge need={item.user_need_secondary} />}
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  Confidence: {item?.user_need_confidence != null ? (item.user_need_confidence * 100).toFixed(0) + '%' : '—'}
                </span>
              </div>
            </>
          )}
        </div>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 20, lineHeight: 1, padding: 4 }}>×</button>
      </div>

      {item && (
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Rationale */}
          {item.user_need_rationale && (
            <div style={{ background: 'var(--bg-elevated)', borderRadius: 6, padding: '12px 14px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, borderLeft: '3px solid var(--accent-gold-dim)' }}>
              {item.user_need_rationale}
            </div>
          )}

          {/* Links */}
          <div style={{ display: 'flex', gap: 8 }}>
            {item.url && (
              <a href={item.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, padding: '5px 10px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 4, color: 'var(--text-secondary)' }}>
                View Article ↗
              </a>
            )}
            <button
              onClick={handleReclassify}
              disabled={reclassifying}
              style={{
                fontSize: 12, padding: '5px 10px', background: 'var(--accent-gold-bg)',
                border: '1px solid var(--accent-gold-dim)', borderRadius: 4,
                color: 'var(--accent-gold)', opacity: reclassifying ? 0.6 : 1,
              }}
            >
              {reclassifying ? 'Classifying...' : 'Re-classify'}
            </button>
          </div>

          {/* True Value Breakdown */}
          {item.trueValueBreakdown && (() => {
            const bd = item.trueValueBreakdown;
            const DIMS = [
              { key: 'subscription', label: 'Subscriptions' },
              { key: 'loyal',        label: 'Loyal In-Market' },
              { key: 'newsletter',   label: 'Newsletter' },
              { key: 'engagement',   label: 'Engagement' },
              { key: 'ad',           label: 'Ad Revenue' },
            ];
            return (
              <div>
                <h3 style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>True Value Breakdown</h3>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 12 }}>
                  <div style={{ fontSize: 34, fontFamily: 'var(--font-mono)', fontWeight: 600, color: 'var(--accent-gold)', lineHeight: 1 }}>
                    {bd.score}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>/ 100</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {DIMS.map(({ key, label }) => {
                    const sub = Math.round(bd.dimensions[key] || 0);
                    const w = bd.weights[key] || 0;
                    return (
                      <div key={key}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
                          <span style={{ color: 'var(--text-secondary)' }}>{label} <span style={{ color: 'var(--text-muted)' }}>· {w}% weight</span></span>
                          <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{sub}</span>
                        </div>
                        <div style={{ height: 4, background: 'var(--bg-elevated)', borderRadius: 2 }}>
                          <div style={{ height: '100%', width: `${sub}%`, background: 'var(--accent-gold)', opacity: 0.8, borderRadius: 2 }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8, fontStyle: 'italic' }}>
                  Weighted blend = {bd.composite}/100, × {(bd.confidence * 100).toFixed(0)}% traffic confidence = {bd.score}.
                </div>
              </div>
            );
          })()}

          {/* Analytics */}
          <div>
            <h3 style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Analytics (30-day)</h3>
            <div style={{ background: 'var(--bg-elevated)', borderRadius: 6, padding: '4px 0' }}>
              <StatRow label="Pageviews" value={fmt(item.ga4_pageviews)} />
              <StatRow label="Active Users" value={fmt(item.ga4_users)} />
              <StatRow label="Loyal Users" value={fmt(item.ga4_loyal_users)} />
              <StatRow label="In-Market Pageviews" value={fmt(item.ga4_inmarket_pageviews)} />
              <StatRow label="Loyal In-Market PVs" value={fmt(item.ga4_loyal_inmarket_pv)} />
              <StatRow label="Avg Engagement Time" value={item.ga4_avg_engagement_time != null ? item.ga4_avg_engagement_time.toFixed(0) + 's' : '—'} />
              <StatRow label="Sessions" value={fmt(item.ga4_sessions)} />
              <StatRow label="Subscribe Clicks" value={fmt(item.ga4_subscribe_clicks)} />
              <StatRow label="Newsletter Signups" value={fmt(item.mf_newsletter_signups)} />
              <StatRow label="Ad Revenue" value={item.ga4_ad_revenue != null ? '$' + item.ga4_ad_revenue.toFixed(2) : '—'} />
              <StatRow label="Marfeel Unique Users" value={fmt(item.mf_unique_users)} />
              <StatRow label="Marfeel Loyal Users" value={fmt(item.mf_loyal_users)} />
              <StatRow label="Scroll Depth" value={item.mf_scroll_depth != null ? item.mf_scroll_depth.toFixed(0) + '%' : '—'} />
            </div>
          </div>

          {/* Traffic Sources */}
          {item.sources?.length > 0 && (
            <div>
              <h3 style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Traffic Sources</h3>
              <div style={{ background: 'var(--bg-elevated)', borderRadius: 6, padding: '4px 0' }}>
                {(() => {
                  const total = item.sources.reduce((s, r) => s + (r.pageviews || 0), 0);
                  return item.sources.map(row => (
                    <div key={row.source} style={{ padding: '8px 14px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 130 }}>{row.source}</span>
                      <div style={{ flex: 1, height: 4, background: 'var(--border)', borderRadius: 2 }}>
                        <div style={{ height: '100%', borderRadius: 2, background: 'var(--accent-gold)', opacity: 0.7, width: `${total > 0 ? (row.pageviews / total) * 100 : 0}%` }} />
                      </div>
                      <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)', minWidth: 48, textAlign: 'right' }}>{fmt(row.pageviews)}</span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', minWidth: 38, textAlign: 'right' }}>{total > 0 ? ((row.pageviews / total) * 100).toFixed(0) + '%' : '—'}</span>
                    </div>
                  ));
                })()}
              </div>
            </div>
          )}

          {/* History chart */}
          {item.history?.length > 1 && (
            <div>
              <h3 style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>True Value History</h3>
              <ResponsiveContainer width="100%" height={160}>
                <LineChart data={item.history} margin={{ left: 0, right: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="snapshot_at" tickFormatter={v => v?.slice(5, 10)} tick={{ fill: 'var(--text-muted)', fontSize: 10 }} stroke="var(--border)" />
                  <YAxis tick={{ fill: 'var(--text-muted)', fontSize: 10 }} stroke="var(--border)" />
                  <Tooltip
                    contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11 }}
                    labelStyle={{ color: 'var(--text-secondary)' }}
                  />
                  <Line type="monotone" dataKey="true_value" stroke="var(--accent-gold)" strokeWidth={2} dot={false} name="True Value" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Metadata */}
          <div>
            <h3 style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Metadata</h3>
            <div style={{ background: 'var(--bg-elevated)', borderRadius: 6, padding: '4px 0' }}>
              <StatRow label="Type" value={item.content_type} />
              <StatRow label="Section" value={item.section || '—'} />
              <StatRow label="Writer" value={item.writer || item.author || '—'} />
              <StatRow label="Published" value={item.published_at?.slice(0, 10) || '—'} />
              <StatRow label="Subscription Required" value={item.subscription_required ? 'Yes' : 'No'} />
              <StatRow label="WP ID" value={String(item.wp_id)} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
