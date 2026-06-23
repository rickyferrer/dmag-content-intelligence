import React from 'react';
import {
  ScatterChart, Scatter, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, ZAxis,
} from 'recharts';
import { NEED_META } from './NeedBadge.jsx';

const CustomTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload;
  if (!d) return null;
  const meta = NEED_META[d.user_need] || { label: d.user_need, color: '#888' };
  return (
    <div style={{
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border)',
      borderRadius: 6,
      padding: '10px 14px',
      fontSize: 12,
      lineHeight: 1.8,
    }}>
      <div style={{ color: meta.color, fontWeight: 600, marginBottom: 4 }}>{meta.label}</div>
      <div style={{ color: 'var(--text-secondary)' }}>Articles: <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{d.article_count}</span></div>
      <div style={{ color: 'var(--text-secondary)' }}>Avg True Value: <span style={{ color: 'var(--accent-gold)', fontFamily: 'var(--font-mono)' }}>{d.avg_true_value?.toFixed(1)}</span></div>
      <div style={{ color: 'var(--text-secondary)' }}>Total Pageviews: <span style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{d.total_pageviews?.toLocaleString()}</span></div>
    </div>
  );
};

export default function ScatterPlot({ data }) {
  if (!data?.length) return (
    <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: 40 }}>No data</div>
  );

  const maxPv = Math.max(...data.map(d => d.total_pageviews || 0), 1);

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis
          dataKey="article_count"
          name="Articles Published"
          type="number"
          domain={[0, 'dataMax']}
          label={{ value: 'Articles Published', position: 'insideBottom', offset: -10, fill: 'var(--text-muted)', fontSize: 11 }}
          tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
          stroke="var(--border)"
        />
        <YAxis
          dataKey="avg_true_value"
          name="Avg True Value"
          label={{ value: 'Avg True Value', angle: -90, position: 'insideLeft', fill: 'var(--text-muted)', fontSize: 11 }}
          tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
          stroke="var(--border)"
        />
        <ZAxis dataKey="total_pageviews" range={[60, 600]} name="Total Pageviews" />
        <Tooltip content={<CustomTooltip />} />
        <Scatter data={data} isAnimationActive={false}>
          {data.map((entry, i) => {
            const meta = NEED_META[entry.user_need] || { color: '#888' };
            return <Cell key={i} fill={meta.color} fillOpacity={0.8} />;
          })}
        </Scatter>
      </ScatterChart>
    </ResponsiveContainer>
  );
}
