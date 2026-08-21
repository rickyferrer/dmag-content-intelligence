import React, { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line,
} from 'recharts';
import { api } from '../api/index.js';
import KPICard from '../components/KPICard.jsx';
import ScatterPlot from '../components/ScatterPlot.jsx';
import { NEED_META } from '../components/NeedBadge.jsx';
import DatePresets, { resolveDates, DEFAULT_PRESET } from '../components/DatePresets.jsx';
import { useComparisons } from '../context/ComparisonContext.jsx';

function fmt(n) {
  if (n === null || n === undefined) return '—';
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return String(Math.round(n));
}

const NeedTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  const meta = NEED_META[d?.user_need] || { label: d?.user_need };
  return (
    <div style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px', fontSize: 13 }}>
      <div style={{ color: meta.color, fontWeight: 600 }}>{meta.label}</div>
      <div style={{ color: 'var(--text-secondary)' }}>Total Content Value: <b style={{ color: 'var(--accent-gold)' }}>{Math.round(d.total_true_value)}</b></div>
      <div style={{ color: 'var(--text-secondary)' }}>Articles: <b style={{ color: 'var(--text-primary)' }}>{d.article_count}</b></div>
    </div>
  );
};

const { from: initFrom, to: initTo } = resolveDates(DEFAULT_PRESET);

export default function Overview() {
  const { showComparisons } = useComparisons();
  const [summary, setSummary] = useState(null);
  const [byNeed, setByNeed] = useState([]);
  const [scatter, setScatter] = useState([]);
  const [trend, setTrend] = useState([]);
  const [loading, setLoading] = useState(true);
  const [types, setTypes] = useState([]);
  const [sections, setSections] = useState([]);
  const [filters, setFilters] = useState({ from: initFrom, to: initTo, section: '', type: '', preset: DEFAULT_PRESET });

  const load = ({ from, to, section, type }) => {
    setLoading(true);
    const params = {};
    if (from) params.dateFrom = from;
    if (to) params.dateTo = to;
    if (section) params.section = section;
    if (type) params.type = type;
    Promise.all([
      api.getSummary(params),
      api.getByNeed(params),
      api.getScatter(params),
      api.getTrend(30),
    ]).then(([s, bn, sc, tr]) => {
      setSummary(s);
      setByNeed(bn);
      setScatter(sc);
      setTrend(tr);
    }).catch(console.error).finally(() => setLoading(false));
  };

  useEffect(() => {
    load({ from: initFrom, to: initTo, section: '', type: '' });
    api.getContentTypes().then(setTypes).catch(console.error);
    api.getTaxonomies().then(t => setSections(t.sections || [])).catch(console.error);
  }, []);

  const setFilter = (key, value) => {
    const next = { ...filters, [key]: value };
    setFilters(next);
    load(next);
  };

  const barData = byNeed.map(d => ({
    ...d,
    name: NEED_META[d.user_need]?.label || d.user_need,
    fill: NEED_META[d.user_need]?.color || '#888',
  }));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      {/* Filter bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Published:</span>
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

        <select value={filters.section} onChange={e => setFilter('section', e.target.value)}>
          <option value="">All Sections</option>
          {sections.slice(0, 50).map(s => (
            <option key={s.section} value={s.section}>{s.section} ({s.count})</option>
          ))}
        </select>

        <select value={filters.type} onChange={e => setFilter('type', e.target.value)}>
          <option value="">All Types</option>
          {types.map(t => (
            <option key={t.content_type} value={t.content_type}>{t.content_type} ({t.count})</option>
          ))}
        </select>

        {loading && <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading…</span>}
      </div>

      {/* Comparison caption — the % badges below are relative to this window,
          which is otherwise invisible. Only appears when the current date
          filter actually resolves to a concrete range ("All time" has no
          meaningful "previous period" to compare against). */}
      {showComparisons && summary?.previous_period && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -12 }}>
          <span style={{ color: '#4caf86', fontFamily: 'var(--font-mono)', fontWeight: 600 }}>+/-%</span> badges below compare
          to the previous period: <strong style={{ color: 'var(--text-secondary)' }}>{summary.previous_period.from}</strong> to{' '}
          <strong style={{ color: 'var(--text-secondary)' }}>{summary.previous_period.to}</strong>
        </div>
      )}

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
        <KPICard label="Total Content Items" value={fmt(summary?.total_content)} />
        <KPICard label="Avg Content Value" value={summary?.avg_true_value != null ? Math.round(summary.avg_true_value).toString() : '—'} gold change={summary?.changes?.avg_true_value} />
        <KPICard label="Total Users" value={fmt(summary?.total_users)} change={summary?.changes?.total_users} />
        <KPICard label="Loyal Users" value={fmt(summary?.total_loyal_users)} change={summary?.changes?.total_loyal_users} />
        <KPICard
          label="In-Market %"
          value={summary?.inmarket_pct != null ? summary.inmarket_pct.toFixed(1) + '%' : '—'}
          change={summary?.changes?.inmarket_pct}
          sub="Share of readers located in the DFW area"
        />
        <KPICard label="Subscribe Clicks" value={fmt(summary?.total_subscribe_clicks)} change={summary?.changes?.total_subscribe_clicks} />
        <KPICard
          label="Newsletter Signups"
          value={fmt(summary?.total_newsletter_signups)}
          change={summary?.changes?.total_newsletter_signups}
          sub="Tracking began Jul 21, 2026 — longer ranges won't grow until real history catches up"
        />
        <KPICard
          label="Ad Revenue (30d)"
          value={summary?.total_ad_revenue != null ? '$' + summary.total_ad_revenue.toFixed(0) : '—'}
          change={summary?.changes?.total_ad_revenue}
          sub="Potential value — ad impressions × $10 CPM, not real tracked revenue"
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        {/* Content by User Need */}
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 20 }}>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 18, marginBottom: 16, color: 'var(--text-primary)' }}>
            Content by User Need
          </h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={barData} layout="vertical" margin={{ left: 10, right: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
              <XAxis type="number" tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} stroke="var(--border)" />
              <YAxis dataKey="name" type="category" width={90} tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} stroke="var(--border)" />
              <Tooltip content={<NeedTooltip />} />
              <Bar dataKey="total_true_value" radius={[0, 3, 3, 0]} isAnimationActive={false}>
                {barData.map((d, i) => (
                  <React.Fragment key={i}>
                    <rect fill={d.fill} fillOpacity={0.9} />
                  </React.Fragment>
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Scatter Plot */}
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 20 }}>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 18, marginBottom: 4, color: 'var(--text-primary)' }}>
            Output vs. Content Value
          </h3>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
            X = articles published · Y = avg Content Value · bubble size = total pageviews
          </p>
          <ScatterPlot data={scatter} />
        </div>
      </div>

      {/* Trend Line */}
      {trend.length > 0 && (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 20 }}>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 18, marginBottom: 16, color: 'var(--text-primary)' }}>
            Content Value Trend (30 days)
          </h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={trend} margin={{ left: 0, right: 20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="date" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} stroke="var(--border)" />
              <YAxis tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} stroke="var(--border)" />
              <Tooltip
                contentStyle={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 }}
                labelStyle={{ color: 'var(--text-secondary)' }}
                itemStyle={{ color: 'var(--accent-gold)' }}
              />
              <Line type="monotone" dataKey="avg_true_value" stroke="var(--accent-gold)"
                strokeWidth={2} dot={false} name="Avg Content Value" isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
