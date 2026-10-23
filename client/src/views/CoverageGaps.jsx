import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api/index.js';
import { useAuth } from '../context/AuthContext.jsx';
import Spinner from '../components/Spinner.jsx';

const POLL_MS = 3000;

const URGENCY = {
  high:   { label: 'High',   color: '#c0392b', bg: '#fdecea' },
  medium: { label: 'Medium', color: '#9a6f00', bg: '#fbf3dc' },
  low:    { label: 'Low',    color: '#58585a', bg: 'var(--bg-elevated)' },
};

const GAP_TYPE = {
  competitor_covered:   'Competitors covered it',
  upcoming_unscheduled: 'Upcoming, nothing scheduled',
};

const KIND_LABEL = {
  original_story: 'Story',
  event_coverage: 'Event',
  recirculation: 'Recirc',
  print_or_admin: 'Admin',
  roundup_or_recurring: 'Recurring',
  unclassified: '—',
};

// YYYY-MM-DD → local Date without the UTC shift new Date('YYYY-MM-DD') causes.
function parseDay(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function addDays(s, n) {
  const d = parseDay(s);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const fmtDay = (s) => parseDay(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const fmtWeek = (s) => `${fmtDay(s)} – ${fmtDay(addDays(s, 6))}`;
const fmtShort = (iso) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—');

function Pill({ children, color, bg, title }) {
  return (
    <span title={title} style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 500, color, background: bg, whiteSpace: 'nowrap' }}>
      {children}
    </span>
  );
}

function SectionTitle({ children, count, note }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, margin: '28px 0 12px' }}>
      <h2 style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{children}</h2>
      {count != null && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{count}</span>}
      {note && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>· {note}</span>}
    </div>
  );
}

const linkStyle = { color: 'var(--text-primary)', textDecoration: 'underline', textDecorationColor: 'var(--border)', textUnderlineOffset: 2 };

function Stat({ label, value }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
      <span style={{ fontSize: 18, fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>{value ?? '—'}</span>
    </div>
  );
}

function GapCard({ gap }) {
  const u = URGENCY[gap.urgency] || URGENCY.low;
  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '16px 18px', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <Pill color={u.color} bg={u.bg}>{u.label}</Pill>
        <Pill color="var(--text-secondary)" bg="var(--bg-elevated)">{GAP_TYPE[gap.gapType] || gap.gapType}</Pill>
        {gap.sectionHint && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{gap.sectionHint}</span>}
      </div>
      <div style={{ fontSize: 16, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 6 }}>{gap.topic}</div>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 8 }}>{gap.whyItMatters}</div>
      <div style={{ fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.5, marginBottom: 12 }}>
        <span style={{ color: 'var(--accent-gold)', fontWeight: 500 }}>Angle: </span>{gap.suggestedAngle}
      </div>

      {gap.related.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          {gap.related.map((r, i) => (
            <div key={i} style={{
              fontSize: 12, padding: '6px 10px', borderRadius: 4, marginBottom: 4,
              background: r.likelyDuplicate ? '#fbf3dc' : 'var(--bg-elevated)',
              color: r.likelyDuplicate ? '#7a5800' : 'var(--text-secondary)',
            }}>
              <strong style={{ fontWeight: 500 }}>
                {r.likelyDuplicate ? 'D may already have this' : 'Adjacent D coverage'}
                {r.kind === 'agenda' ? ' (on the agenda)' : ' (published)'}:
              </strong>{' '}
              {r.url ? <a href={r.url} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>{r.title}</a> : r.title}
              {r.date && <span style={{ opacity: 0.7 }}> · {fmtDay(r.date.slice(0, 10))}</span>}
            </div>
          ))}
        </div>
      )}

      <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 10 }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
          Competitor coverage ({gap.evidence.length})
        </div>
        {gap.evidence.map((e, i) => (
          <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', padding: '2px 0', display: 'flex', gap: 8 }}>
            <span style={{ whiteSpace: 'nowrap', minWidth: 150, color: 'var(--text-muted)' }}>{e.source} · {fmtShort(e.date)}</span>
            <a href={e.url} target="_blank" rel="noopener noreferrer" style={linkStyle}>{e.title}</a>
            {e.titleFromUrl && <span title="This outlet's feed has no headlines; the title is rewritten from the URL" style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>(from URL)</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

const th = { padding: '9px 12px', textAlign: 'left', fontSize: 11, fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' };
const td = { padding: '8px 12px', fontSize: 12, color: 'var(--text-secondary)', borderTop: '1px solid var(--border-subtle)', verticalAlign: 'top' };

function Panel({ children }) {
  return <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>{children}</div>;
}

export default function CoverageGaps() {
  const { isAdmin } = useAuth();
  const [data, setData] = useState(null);
  const [week, setWeek] = useState(null); // null → server's default pick
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [starting, setStarting] = useState(false);
  const [typeFilter, setTypeFilter] = useState('all');
  const pollRef = useRef(null);

  const load = (w) => {
    return api.getCoverage(w)
      .then(res => { setData(res); setError(null); return res; })
      .catch(err => { setError(err.message); return null; })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(week); /* eslint-disable-next-line */ }, [week]);

  const running = data?.run?.state === 'running';

  // While a run is in flight, poll until it finishes, then reload the report.
  useEffect(() => {
    if (!running) return undefined;
    pollRef.current = setInterval(() => { load(week); }, POLL_MS);
    return () => clearInterval(pollRef.current);
    // eslint-disable-next-line
  }, [running, week]);

  const thisWeek = data?.thisWeek;
  const report = data?.report;
  // The week being shown/run: an explicit pick, else whatever the server chose.
  const shownWeek = week || report?.weekStart || thisWeek;

  const weekOptions = (() => {
    if (!thisWeek) return [];
    const set = new Set([addDays(thisWeek, 7), thisWeek, ...(data.weeks || []).map(w => w.weekStart)]);
    return [...set].sort().reverse();
  })();
  const weekLabel = (w) => `${fmtWeek(w)}${w === thisWeek ? ' (this week)' : w === addDays(thisWeek, 7) ? ' (next week)' : ''}${data.weeks.some(x => x.weekStart === w) ? '' : ' — no report'}`;

  const run = async () => {
    setStarting(true);
    setError(null);
    try {
      await api.runCoverage(shownWeek);
      await load(shownWeek);
    } catch (err) {
      setError(err.message);
    } finally {
      setStarting(false);
    }
  };

  if (loading && !data) return <Spinner block label="Loading coverage report…" />;
  if (!data) return <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{error || 'Could not load the coverage report.'}</div>;

  const { configured, run: runState } = data;
  const gaps = (report?.gaps || []).filter(g => typeFilter === 'all' || g.gapType === typeFilter);
  const staleSources = (report?.sources || []).filter(s => s.articles === 0);

  return (
    <div style={{ maxWidth: 1100 }}>
      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
        <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Week of</label>
        <select
          value={shownWeek || ''}
          onChange={e => setWeek(e.target.value)}
          style={{ padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--bg-surface)', fontSize: 13, color: 'var(--text-primary)' }}
        >
          {weekOptions.map(w => <option key={w} value={w}>{weekLabel(w)}</option>)}
        </select>
        {isAdmin && (
          <button
            onClick={run}
            disabled={running || starting || !configured.monday}
            style={{
              padding: '7px 14px', border: '1px solid var(--accent-gold)', borderRadius: 4, fontSize: 13, fontWeight: 500,
              background: running || starting ? 'var(--bg-elevated)' : 'var(--accent-gold)',
              color: running || starting ? 'var(--text-muted)' : '#fff',
              cursor: running || starting || !configured.monday ? 'default' : 'pointer',
              opacity: configured.monday ? 1 : 0.5,
            }}
          >
            {running ? 'Generating…' : report && report.weekStart === shownWeek ? 'Regenerate report' : 'Generate report'}
          </button>
        )}
        {running && <Spinner size={14} label={`Reading the ${fmtWeek(runState.weekStart)} agenda and comparing competitors (about a minute)`} />}
        {report && !running && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 'auto' }}>
            Generated {new Date(report.generatedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
          </span>
        )}
      </div>

      {error && <div style={{ fontSize: 13, color: '#c0392b', margin: '10px 0' }}>{error}</div>}
      {runState?.state === 'error' && !running && (
        <div style={{ fontSize: 13, color: '#c0392b', background: '#fdecea', borderRadius: 6, padding: '10px 14px', margin: '10px 0' }}>
          The last run for {fmtWeek(runState.weekStart)} failed: {runState.error}
        </div>
      )}

      {/* Not set up */}
      {!configured.monday && (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 20, marginTop: 14, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 6 }}>Monday.com isn't connected yet</div>
          This report reads each week's agenda from the <a href={configured.boardUrl} target="_blank" rel="noopener noreferrer" style={linkStyle}>editorial board on Monday.com</a> and
          compares it with what competitors are publishing. {isAdmin
            ? <>Add a <code>MONDAY_API_TOKEN</code> to the server's environment (a personal API token from monday.com → profile picture → Developers → My access tokens), then restart.</>
            : 'Ask an admin to finish the setup.'}
        </div>
      )}

      {configured.monday && !report && !running && (
        <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 20, marginTop: 14, fontSize: 13, color: 'var(--text-secondary)' }}>
          No report for {shownWeek ? fmtWeek(shownWeek) : 'this week'} yet.
          {isAdmin ? ' Use "Generate report" — it also runs automatically every Monday at 7:00am Central.' : ' Reports are generated automatically every Monday at 7:00am Central.'}
        </div>
      )}

      {report && (
        <>
          <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '14px 18px', margin: '14px 0 0' }}>
            <Stat label="Agenda items" value={report.stats.agendaItems} />
            <Stat label="Competitor headlines" value={report.stats.competitorHeadlines} />
            <Stat label="Gaps" value={report.stats.gaps} />
            <Stat label="Exclusives" value={report.stats.exclusives} />
          </div>

          {/* Gaps */}
          <SectionTitle count={report.gaps.length} note="what competitors are covering that D isn't">Coverage gaps</SectionTitle>
          {report.gaps.length > 0 && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              {[['all', 'All'], ...Object.entries(GAP_TYPE)].map(([key, label]) => (
                <button key={key} onClick={() => setTypeFilter(key)} style={{
                  padding: '4px 12px', borderRadius: 14, fontSize: 12, cursor: 'pointer',
                  border: '1px solid ' + (typeFilter === key ? 'var(--accent-gold)' : 'var(--border)'),
                  background: typeFilter === key ? 'var(--accent-gold-bg)' : 'var(--bg-surface)',
                  color: typeFilter === key ? 'var(--accent-gold)' : 'var(--text-secondary)',
                }}>{label}</button>
              ))}
            </div>
          )}
          {gaps.map((g, i) => <GapCard key={i} gap={g} />)}
          {report.gaps.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>No gaps found — nothing competitors covered this week is missing from D's coverage.</div>}

          {/* Exclusives */}
          <SectionTitle count={report.exclusives.length} note="agenda items no tracked outlet is covering">Our exclusives</SectionTitle>
          {report.exclusives.length > 0 ? (
            <Panel>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  {report.exclusives.map((x, i) => (
                    <tr key={i}>
                      <td style={{ ...td, borderTop: i === 0 ? 'none' : td.borderTop, width: '34%', color: 'var(--text-primary)' }}>
                        {x.url ? <a href={x.url} target="_blank" rel="noopener noreferrer" style={linkStyle}>{x.title}</a> : x.title}
                        <div style={{ color: 'var(--text-muted)', marginTop: 2 }}>{fmtDay(x.date)}{x.pub ? ` · ${x.pub}` : ''}</div>
                      </td>
                      <td style={{ ...td, borderTop: i === 0 ? 'none' : td.borderTop }}>{x.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Panel>
          ) : <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>None this week.</div>}
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
            "Exclusive" only means none of the tracked outlets below covered it in the last 7 days — it isn't proof no one else did.
          </div>

          {/* Agenda as read */}
          <SectionTitle count={report.agenda.length} note="as read from Monday.com">The week's agenda</SectionTitle>
          <Panel>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-elevated)' }}>
                  <th style={th}>Date</th><th style={th}>Item</th><th style={th}>Pub</th><th style={th}>Status</th><th style={th}>Kind</th><th style={th}>Competitor overlap</th>
                </tr>
              </thead>
              <tbody>
                {report.agenda.map((a, i) => (
                  <tr key={i}>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{fmtDay(a.date)}</td>
                    <td style={{ ...td, color: 'var(--text-primary)' }}>
                      {a.url ? <a href={a.url} target="_blank" rel="noopener noreferrer" style={linkStyle}>{a.title}</a> : a.title}
                      {a.theme && a.theme.toLowerCase() !== a.title.toLowerCase() && <div style={{ color: 'var(--text-muted)' }}>{a.theme}</div>}
                    </td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{a.pub || '—'}</td>
                    <td style={{ ...td, whiteSpace: 'nowrap' }}>{a.status || '—'}</td>
                    <td style={td}>{KIND_LABEL[a.kind] || a.kind}</td>
                    <td style={td}>
                      {a.overlap.length === 0 ? <span style={{ color: 'var(--text-muted)' }}>—</span> : a.overlap.map((o, j) => (
                        <div key={j}><a href={o.url} target="_blank" rel="noopener noreferrer" style={linkStyle}>{o.source}</a>: {o.title.length > 60 ? o.title.slice(0, 60) + '…' : o.title}</div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          {/* Source health */}
          <SectionTitle note="headlines collected in the last 7 days">Competitors tracked</SectionTitle>
          {staleSources.length > 0 && (
            <div style={{ fontSize: 12, color: '#7a5800', background: '#fbf3dc', borderRadius: 6, padding: '8px 12px', marginBottom: 10 }}>
              No recent headlines from {staleSources.map(s => s.name).join(', ')} — if that persists, its feed may have changed. Gaps and exclusives assume these outlets published nothing.
            </div>
          )}
          <Panel>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'var(--bg-elevated)' }}><th style={th}>Outlet</th><th style={th}>Headlines (7 days)</th><th style={th}>Newest</th><th style={th}>Notes</th></tr>
              </thead>
              <tbody>
                {report.sources.map((s, i) => (
                  <tr key={i}>
                    <td style={{ ...td, color: 'var(--text-primary)' }}>{s.name}</td>
                    <td style={{ ...td, fontFamily: 'var(--font-mono)', color: s.articles === 0 ? '#c0392b' : undefined }}>{s.articles}</td>
                    <td style={td}>{s.newest ? new Date(s.newest).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'}</td>
                    <td style={td}>{s.titleFromUrl ? 'No headlines in its feed — titles are rewritten from URLs' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '6px 0 24px' }}>
            Not tracked (they block automated access): Dallas Business Journal, KERA News, Axios Dallas. Sports and Spanish-language Dallas Morning News sections are excluded.
          </div>
        </>
      )}
    </div>
  );
}
