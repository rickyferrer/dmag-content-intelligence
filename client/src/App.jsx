import React, { useState } from 'react';
import Overview from './views/Overview.jsx';
import ContentTable from './views/ContentTable.jsx';
import ContentDetail from './views/ContentDetail.jsx';
import UserNeedsAnalysis from './views/UserNeedsAnalysis.jsx';
import Sections from './views/Sections.jsx';
import Sources from './views/Sources.jsx';
import Publications from './views/Publications.jsx';
import Vulnerability from './views/Vulnerability.jsx';
import Settings from './views/Settings.jsx';

const NAV = [
  { id: 'overview',      label: 'Overview' },
  { id: 'content',       label: 'Content' },
  { id: 'sections',      label: 'Sections' },
  { id: 'publications',  label: 'Publications' },
  { id: 'sources',       label: 'Sources' },
  { id: 'needs',          label: 'User Needs' },
  { id: 'vulnerability',  label: 'AI Vulnerability' },
  { id: 'settings',       label: 'Settings' },
];

export default function App() {
  const [view, setView] = useState('overview');
  const [selectedId, setSelectedId] = useState(null);

  const handleSelect = (id) => {
    setSelectedId(id);
  };

  return (
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
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{
            fontFamily: 'var(--font-display)',
            fontSize: 17,
            color: 'var(--text-primary)',
            letterSpacing: '-0.01em',
          }}>
            D Magazine
          </span>
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
          {NAV.map(item => (
            <button
              key={item.id}
              onClick={() => { setView(item.id); setSelectedId(null); }}
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
      </header>

      {/* Main content */}
      <main style={{
        flex: 1,
        padding: '24px 28px',
        width: '100%',
        minWidth: 0,
        marginRight: selectedId ? 480 : 0,
        transition: 'margin-right 0.2s ease',
        boxSizing: 'border-box',
      }}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{
            fontFamily: 'var(--font-display)',
            fontSize: 24,
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
        {view === 'publications'  && <Publications />}
        {view === 'needs'          && <UserNeedsAnalysis />}
        {view === 'vulnerability'  && <Vulnerability />}
        {view === 'settings'  && <Settings />}
      </main>

      {/* Detail panel (content view) */}
      {view === 'content' && selectedId && (
        <ContentDetail
          wpId={selectedId}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
