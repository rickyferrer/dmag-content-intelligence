import React, { useState, useRef, useEffect } from 'react';
import { api } from '../api/index.js';
import Spinner from '../components/Spinner.jsx';

const EXAMPLE_QUESTIONS = [
  'Which sections have the highest content value?',
  'What content is most vulnerable to AI Overviews?',
  'Which writers produce the highest-value content?',
  'What user need converts best to newsletter signups?',
  'Which traffic channel drives the most subscribe clicks?',
];

// Render **bold** spans inline; everything else is plain text.
function InlineText({ text }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    const m = part.match(/^\*\*([^*]+)\*\*$/);
    return m ? <strong key={i}>{m[1]}</strong> : <React.Fragment key={i}>{part}</React.Fragment>;
  });
}

function AnswerText({ text }) {
  // Render simple markdown-ish formatting: paragraphs, "- " bullet lists, and **bold**
  const blocks = text.split(/\n{2,}/);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {blocks.map((block, i) => {
        const lines = block.split('\n').filter(Boolean);
        const isList = lines.length > 0 && lines.every(l => /^[-*]\s/.test(l.trim()));
        if (isList) {
          return (
            <ul key={i} style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {lines.map((l, j) => (
                <li key={j} style={{ fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.6 }}>
                  <InlineText text={l.replace(/^[-*]\s/, '')} />
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} style={{ margin: 0, fontSize: 14, color: 'var(--text-primary)', lineHeight: 1.6 }}>
            <InlineText text={block} />
          </p>
        );
      })}
    </div>
  );
}

// Flat, chronological role/content rows from the API → the {question, answer}
// pair shape the chat UI renders.
function messagesToHistory(messages) {
  const out = [];
  let current = null;
  for (const m of messages) {
    if (m.role === 'user') {
      current = { question: m.content, answer: null, loading: false, error: null, queries_run: [] };
      out.push(current);
    } else if (m.role === 'assistant' && current) {
      current.answer = m.content;
      current.queries_run = m.queries_run || [];
    }
  }
  return out;
}

// The view unmounts entirely when you switch to another tab and back (each
// tab is conditionally rendered, not just hidden), which would otherwise
// drop the in-progress conversation from memory even though it's already
// saved server-side — this is how we reopen it automatically on remount.
const ACTIVE_CONVERSATION_KEY = 'insights_active_conversation_id';

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// Two four-point stars, the "ask AI" sparkle mark.
function Sparkles({ size = 28 }) {
  const star = 'M12 2C12.7 7.6 16.4 11.3 22 12C16.4 12.7 12.7 16.4 12 22C11.3 16.4 7.6 12.7 2 12C7.6 11.3 11.3 7.6 12 2Z';
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="#fff" aria-hidden="true">
      <path d={star} transform="translate(0 2) scale(0.95)" />
      <path d={star} transform="translate(19.5 17.5) scale(0.5)" />
    </svg>
  );
}

const DRAWER_WIDTH = 480;

// Sticky bottom-left launcher + slide-out drawer, mounted once at the app root.
// The drawer stays mounted after its first open (just hidden) so an answer that
// is still loading isn't lost when it's closed, and the conversation is intact
// when it's reopened.
export default function Insights() {
  const [open, setOpen] = useState(false);
  const [everOpened, setEverOpened] = useState(false);

  const openDrawer = () => { setEverOpened(true); setOpen(true); };

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        onClick={openDrawer}
        aria-label="Ask a question about your content"
        title="Ask"
        style={{
          position: 'fixed', left: 24, bottom: 24, zIndex: 90,
          width: 60, height: 60, borderRadius: '50%', border: 'none', padding: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'linear-gradient(135deg, #ff4a3d 0%, #e0101f 55%, #a8001a 100%)',
          boxShadow: '0 8px 22px rgba(224, 16, 31, 0.45), 0 2px 6px rgba(0, 0, 0, 0.18)',
          cursor: 'pointer',
          opacity: open ? 0 : 1, pointerEvents: open ? 'none' : 'auto',
          transform: open ? 'scale(0.85)' : 'scale(1)',
          transition: 'opacity 0.15s ease, transform 0.15s ease',
        }}
        onMouseEnter={e => { if (!open) e.currentTarget.style.transform = 'scale(1.06)'; }}
        onMouseLeave={e => { if (!open) e.currentTarget.style.transform = 'scale(1)'; }}
      >
        <Sparkles />
      </button>

      {everOpened && <InsightsDrawer open={open} onClose={() => setOpen(false)} />}
    </>
  );
}

function InsightsDrawer({ open, onClose }) {
  const [question, setQuestion] = useState('');
  const [history, setHistory] = useState([]); // [{ question, answer, loading, error, queries_run }]
  const [conversations, setConversations] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  const loadConversations = () => api.getInsightConversations().then(setConversations).catch(console.error);

  useEffect(() => {
    loadConversations();
    const savedId = localStorage.getItem(ACTIVE_CONVERSATION_KEY);
    if (savedId) openConversation(Number(savedId), { onMissing: () => localStorage.removeItem(ACTIVE_CONVERSATION_KEY) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  // Focus the box each time the drawer opens.
  useEffect(() => {
    if (open && !showHistory) setTimeout(() => inputRef.current?.focus(), 200);
  }, [open, showHistory]);

  const startNewChat = () => {
    setConversationId(null);
    setHistory([]);
    setQuestion('');
    setShowHistory(false);
    localStorage.removeItem(ACTIVE_CONVERSATION_KEY);
  };

  const openConversation = async (id, { onMissing } = {}) => {
    if (id === conversationId) { setShowHistory(false); return; }
    setLoadingConversation(true);
    try {
      const conv = await api.getInsightConversation(id);
      setConversationId(conv.id);
      setHistory(messagesToHistory(conv.messages));
      setShowHistory(false);
      localStorage.setItem(ACTIVE_CONVERSATION_KEY, String(conv.id));
    } catch (err) {
      console.error(err);
      onMissing?.(); // e.g. the conversation was deleted from another tab
    } finally {
      setLoadingConversation(false);
    }
  };

  const deleteConversation = async (id, e) => {
    e.stopPropagation();
    if (!window.confirm('Delete this conversation? This can\'t be undone.')) return;
    try {
      await api.deleteInsightConversation(id);
      setConversations(cs => cs.filter(c => c.id !== id));
      if (id === conversationId) startNewChat();
    } catch (err) {
      alert('Delete failed: ' + err.message);
    }
  };

  const ask = async (q) => {
    const text = (q ?? question).trim();
    if (!text) return;
    setQuestion('');

    const entry = { question: text, answer: null, loading: true, error: null, queries_run: [] };
    setHistory(h => [...h, entry]);

    try {
      const res = await api.askInsight(text, conversationId);
      setHistory(h => h.map(e => e === entry ? { ...e, answer: res.answer, queries_run: res.queries_run || [], loading: false } : e));
      if (res.conversation_id !== conversationId) setConversationId(res.conversation_id);
      localStorage.setItem(ACTIVE_CONVERSATION_KEY, String(res.conversation_id));
      loadConversations();
    } catch (err) {
      setHistory(h => h.map(e => e === entry ? { ...e, error: err.message, loading: false } : e));
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    ask();
  };

  const headerBtn = {
    background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)',
    fontSize: 12, padding: '5px 8px', borderRadius: 6,
  };
  const canAsk = !!question.trim();

  return (
    <>
      {/* Scrim */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 119, background: 'rgba(20, 20, 20, 0.28)',
          opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none', transition: 'opacity 0.2s ease',
        }}
      />

      <aside
        role="dialog"
        aria-label="Ask"
        aria-hidden={!open}
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 120,
          width: DRAWER_WIDTH, maxWidth: '100vw', background: 'var(--bg-base)',
          boxShadow: '-8px 0 32px rgba(0, 0, 0, 0.18)',
          display: 'flex', flexDirection: 'column',
          transform: open ? 'translateX(0)' : 'translateX(105%)',
          visibility: open ? 'visible' : 'hidden',
          transition: open ? 'transform 0.22s ease' : 'transform 0.22s ease, visibility 0s linear 0.22s',
        }}
      >
        {/* Header */}
        <div style={{
          background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-subtle)',
          padding: '18px 20px 14px 24px', display: 'flex', alignItems: 'flex-start', gap: 8, flexShrink: 0,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, color: 'var(--text-primary)', lineHeight: 1.2 }}>
              {showHistory ? 'Past chats' : 'Ask'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
              Reads your data, can't change anything.
            </div>
          </div>
          {!showHistory && history.length > 0 && (
            <button onClick={startNewChat} style={headerBtn}
              onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
              onMouseLeave={e => e.currentTarget.style.background = 'none'}>
              New chat
            </button>
          )}
          <button onClick={() => setShowHistory(v => !v)} style={headerBtn}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
            onMouseLeave={e => e.currentTarget.style.background = 'none'}>
            {showHistory ? 'Back' : `History${conversations.length ? ` (${conversations.length})` : ''}`}
          </button>
          <button onClick={onClose} aria-label="Close" style={{ ...headerBtn, fontSize: 20, lineHeight: 1, padding: '2px 8px', color: 'var(--text-primary)' }}
            onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
            onMouseLeave={e => e.currentTarget.style.background = 'none'}>
            ×
          </button>
        </div>

        {/* Past chats */}
        {showHistory ? (
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <button onClick={startNewChat} style={{
              padding: '10px 14px', borderRadius: 8, fontSize: 13, fontWeight: 500, marginBottom: 8,
              background: 'var(--accent-gold)', border: 'none', color: '#fff', cursor: 'pointer', textAlign: 'left',
            }}>
              + New chat
            </button>
            {conversations.map(c => (
              <div
                key={c.id}
                onClick={() => openConversation(c.id)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                  padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
                  background: c.id === conversationId ? 'var(--bg-elevated)' : 'transparent',
                }}
                onMouseEnter={e => { if (c.id !== conversationId) e.currentTarget.style.background = 'var(--bg-hover)'; }}
                onMouseLeave={e => { if (c.id !== conversationId) e.currentTarget.style.background = 'transparent'; }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {c.title || 'Untitled'}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{fmtDate(c.updated_at)}</div>
                </div>
                <button
                  onClick={e => deleteConversation(c.id, e)}
                  title="Delete conversation"
                  style={{ flexShrink: 0, fontSize: 12, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', lineHeight: 1 }}
                  onMouseEnter={e => e.currentTarget.style.color = '#c0392b'}
                  onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
                >
                  ✕
                </button>
              </div>
            ))}
            {conversations.length === 0 && (
              <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 4px' }}>No saved chats yet.</div>
            )}
          </div>
        ) : (
          <>
            {/* Conversation */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '20px 20px 8px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              {loadingConversation ? (
                <Spinner block label="Loading conversation…" />
              ) : history.length === 0 ? (
                <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 16, padding: '22px 22px 20px' }}>
                  <p style={{ fontSize: 15, color: 'var(--text-secondary)', lineHeight: 1.55, margin: '0 0 16px' }}>
                    Ask about your content, sections, writers, sources or search traffic, or why a number looks the way it does. Try:
                  </p>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
                    {EXAMPLE_QUESTIONS.map(q => (
                      <button
                        key={q}
                        onClick={() => ask(q)}
                        style={{
                          fontSize: 13, color: 'var(--text-secondary)', background: 'var(--bg-surface)', textAlign: 'left',
                          border: '1px solid var(--border)', borderRadius: 20, padding: '8px 16px', cursor: 'pointer',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent-gold-bg)'; e.currentTarget.style.borderColor = 'var(--accent-gold-dim)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'var(--bg-surface)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  {history.map((entry, i) => (
                    <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <div style={{ alignSelf: 'flex-end', maxWidth: '85%' }}>
                        <div style={{
                          background: 'var(--accent-gold)', color: '#fff',
                          borderRadius: '14px 14px 2px 14px', padding: '10px 14px', fontSize: 14,
                        }}>
                          {entry.question}
                        </div>
                      </div>

                      <div style={{ alignSelf: 'flex-start', maxWidth: '95%' }}>
                        <div style={{
                          background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
                          borderRadius: '14px 14px 14px 2px', padding: '14px 16px',
                        }}>
                          {entry.loading && (
                            <div style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                              <Spinner label="Querying the dashboard…" />
                            </div>
                          )}
                          {entry.error && (
                            <div style={{ fontSize: 13, color: '#e05c5c' }}>
                              Something went wrong: {entry.error}
                            </div>
                          )}
                          {entry.answer && <AnswerText text={entry.answer} />}
                          {entry.queries_run?.length > 0 && (
                            <details style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)' }}>
                              <summary style={{ cursor: 'pointer' }}>
                                {entry.queries_run.length} quer{entry.queries_run.length === 1 ? 'y' : 'ies'} run
                              </summary>
                              <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                {entry.queries_run.map((sql, j) => (
                                  <code key={j} style={{
                                    display: 'block', fontFamily: 'var(--font-mono)', fontSize: 10,
                                    background: 'var(--bg-elevated)', padding: '6px 8px', borderRadius: 4,
                                    overflowX: 'auto', whiteSpace: 'pre',
                                  }}>
                                    {sql}
                                  </code>
                                ))}
                              </div>
                            </details>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  <div ref={bottomRef} />
                </>
              )}
            </div>

            {/* Composer */}
            <form onSubmit={handleSubmit} style={{ padding: '10px 20px 20px', flexShrink: 0 }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)', borderRadius: 16, padding: '8px 8px 8px 18px',
                boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
              }}>
                <input
                  ref={inputRef}
                  type="text"
                  value={question}
                  onChange={e => setQuestion(e.target.value)}
                  placeholder={history.length > 0 ? 'Ask a follow-up…' : 'Ask a question…'}
                  style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', background: 'transparent', fontSize: 15, padding: '8px 0' }}
                />
                <button type="submit" disabled={!canAsk} style={{
                  padding: '10px 20px', borderRadius: 12, border: 'none', fontSize: 14, fontWeight: 600,
                  background: canAsk ? 'var(--accent-gold)' : 'var(--accent-gold-bg)',
                  color: canAsk ? '#fff' : 'var(--accent-gold-dim)',
                  cursor: canAsk ? 'pointer' : 'default',
                }}>
                  Ask
                </button>
              </div>
            </form>
          </>
        )}
      </aside>
    </>
  );
}
