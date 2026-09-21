import React, { useState, useEffect } from 'react';
import Overview from './views/Overview.jsx';
import ContentTable from './views/ContentTable.jsx';
import ContentDetail from './views/ContentDetail.jsx';
import UserNeedsAnalysis from './views/UserNeedsAnalysis.jsx';
import Sections from './views/Sections.jsx';
import Sources from './views/Sources.jsx';
import Publications from './views/Publications.jsx';
import PublicationDetail from './views/PublicationDetail.jsx';
import Writers from './views/Writers.jsx';
import WriterDetail from './views/WriterDetail.jsx';
import Vulnerability from './views/Vulnerability.jsx';
import Goals from './views/Goals.jsx';
import Insights from './views/Insights.jsx';
import Settings from './views/Settings.jsx';
import { ComparisonProvider } from './context/ComparisonContext.jsx';
import ComparisonToggle from './components/ComparisonToggle.jsx';
import Login from './views/Login.jsx';
import AccountMenu from './components/AccountMenu.jsx';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { api } from './api/index.js';

const NAV = [
  { id: 'overview',      label: 'Overview' },
  { id: 'content',       label: 'Content' },
  { id: 'sections',      label: 'Sections' },
  { id: 'publications',  label: 'Publications' },
  { id: 'writers',       label: 'Writers' },
  { id: 'sources',       label: 'Sources' },
  { id: 'needs',          label: 'User Needs' },
  { id: 'vulnerability',  label: 'AI Vulnerability' },
  { id: 'goals',          label: 'Goals' },
  { id: 'insights',       label: 'Insights' },
  { id: 'settings',       label: 'Settings' },
];

// Sync watermarks worth surfacing when they go stale — labels shown in the banner.
const SYNC_LABELS = {
  last_wp_sync: 'WordPress content sync',
  last_analytics_sync: 'Analytics sync',
  last_gsc_sync: 'Search Console sync',
};
const SYNC_HEALTH_POLL_MS = 10 * 60 * 1000; // 10 min — cheap, and this only needs to catch multi-day staleness

// Auth gate: nothing else mounts (and no data request fires) until there's a
// signed-in user, so a signed-out visitor only ever sees the sign-in form.
export default function App() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  );
}

function AuthGate() {
  const { user } = useAuth();
  if (user === undefined) return null; // first session check still in flight
  if (user === null) return <Login />;
  return <Dashboard />;
}

function Dashboard() {
  const { isAdmin } = useAuth();
  const [view, setView] = useState('overview');
  const [selectedId, setSelectedId] = useState(null);
  const [selectedIssue, setSelectedIssue] = useState(null);
  const [selectedWriter, setSelectedWriter] = useState(null);
  const [staleSyncs, setStaleSyncs] = useState([]);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const handleSelect = (id) => {
    setSelectedId(id);
  };

  // Poll sync status for staleness so a silently-frozen sync (see server/sync/
  // wordpress.js — a mid-run crash can leave last_wp_sync stuck for weeks
  // without ever logging an error) surfaces here instead of going unnoticed.
  useEffect(() => {
    const checkSyncHealth = () => {
      api.getSyncStatus()
        .then(status => {
          const stale = Object.entries(SYNC_LABELS)
            .filter(([key]) => status[key]?.stale)
            .map(([key, label]) => ({ key, label, staleHours: status[key].staleHours ?? null }));
          setStaleSyncs(stale);
        })
        .catch(() => {}); // health check is best-effort — never block the app on it
    };
    checkSyncHealth();
    const interval = setInterval(checkSyncHealth, SYNC_HEALTH_POLL_MS);
    return () => clearInterval(interval);
  }, []);

  return (
    <ComparisonProvider>
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {/* Top bar */}
      <header style={{
        height: 52,
        background: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 24px',
        gap: 32,
        position: 'sticky',
        top: 0,
        zIndex: 50,
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src="/logo/d-logo.png" alt="D Magazine" style={{ height: 32, width: 32, borderRadius: 4 }} />
          <span style={{
            fontSize: 11,
            color: 'var(--accent-gold)',
            fontWeight: 500,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
          }}>
            Content Intelligence
          </span>
        </div>

        <nav style={{ display: 'flex', gap: 4 }}>
          {NAV.filter(item => item.id !== 'settings' || isAdmin).map(item => (
            <button
              key={item.id}
              onClick={() => { setView(item.id); setSelectedId(null); setSelectedIssue(null); setSelectedWriter(null); }}
              style={{
                padding: '5px 14px',
                border: 'none',
                borderRadius: 4,
                fontSize: 13,
                fontWeight: view === item.id ? 500 : 400,
                background: view === item.id ? 'var(--bg-elevated)' : 'transparent',
                color: view === item.id ? 'var(--text-primary)' : 'var(--text-muted)',
                transition: 'all 0.1s',
              }}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 20 }}>
          <ComparisonToggle />
          <AccountMenu />
        </div>
      </header>

      {/* Stale-sync warning banner */}
      {staleSyncs.length > 0 && !bannerDismissed && (
        <div style={{
          background: '#4a2a0a',
          borderBottom: '1px solid #8a5a1a',
          color: '#ffd699',
          fontSize: 12,
          padding: '8px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          flexShrink: 0,
        }}>
          <span>
            ⚠ {staleSyncs.map(s => s.staleHours == null ? `${s.label} has never completed` : `${s.label} hasn't updated in ${s.staleHours}h`).join(' · ')} — data may be missing or out of date.
          </span>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexShrink: 0 }}>
            {isAdmin && (
              <button
                onClick={() => { setView('settings'); setSelectedId(null); }}
                style={{ background: 'transparent', border: '1px solid #8a5a1a', color: '#ffd699', borderRadius: 4, padding: '3px 10px', fontSize: 11 }}
              >
                View Sync Status
              </button>
            )}
            <button
              onClick={() => setBannerDismissed(true)}
              aria-label="Dismiss"
              style={{ background: 'transparent', border: 'none', color: '#ffd699', fontSize: 14, lineHeight: 1, padding: 0 }}
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Main content */}
      <main style={{
        flex: 1,
        padding: '24px 28px',
        width: '100%',
        minWidth: 0,
        marginRight: (selectedId || selectedIssue || selectedWriter) ? 480 : 0,
        transition: 'margin-right 0.2s ease',
        boxSizing: 'border-box',
      }}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{
            fontFamily: 'var(--font-display)',
            fontSize: 23,
            color: 'var(--text-primary)',
            fontWeight: 400,
          }}>
            {NAV.find(n => n.id === view)?.label}
          </h1>
        </div>

        {view === 'overview'  && <Overview />}
        {view === 'content'   && <ContentTable onSelect={handleSelect} />}
        {view === 'sections'  && <Sections />}
        {view === 'sources'       && <Sources />}
        {view === 'publications'  && <Publications onSelect={setSelectedIssue} />}
        {view === 'writers'        && <Writers onSelect={setSelectedWriter} />}
        {view === 'needs'          && <UserNeedsAnalysis />}
        {view === 'vulnerability'  && <Vulnerability />}
        {view === 'goals'          && <Goals />}
        {view === 'insights'       && <Insights />}
        {view === 'settings'  && isAdmin && <Settings />}
      </main>

      {/* Detail panel (content view) */}
      {view === 'content' && selectedId && (
        <ContentDetail
          wpId={selectedId}
          onClose={() => setSelectedId(null)}
        />
      )}

      {/* Detail panel (publications view) */}
      {view === 'publications' && selectedIssue && (
        <PublicationDetail
          issue={selectedIssue}
          onClose={() => setSelectedIssue(null)}
        />
      )}

      {/* Detail panel (writers view) */}
      {view === 'writers' && selectedWriter && (
        <WriterDetail
          writer={selectedWriter.writer}
          dateFrom={selectedWriter.dateFrom}
          dateTo={selectedWriter.dateTo}
          onClose={() => setSelectedWriter(null)}
        />
      )}
    </div>
    </ComparisonProvider>
  );
}
