import React, { useState, useRef, useEffect } from 'react';
import { api } from '../api/index.js';

const EXAMPLE_QUESTIONS = [
  'Which sections have the highest true value?',
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

export default function Insights() {
  const [question, setQuestion] = useState('');
  const [history, setHistory] = useState([]); // [{ question, answer, loading, error, queries_run }]
  const [conversations, setConversations] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const bottomRef = useRef(null);

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

  const startNewChat = () => {
    setConversationId(null);
    setHistory([]);
    setQuestion('');
    localStorage.removeItem(ACTIVE_CONVERSATION_KEY);
  };

  const openConversation = async (id, { onMissing } = {}) => {
    if (id === conversationId) return;
    setLoadingConversation(true);
    try {
      const conv = await api.getInsightConversation(id);
      setConversationId(conv.id);
      setHistory(messagesToHistory(conv.messages));
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

  return (
    <div style={{ display: 'flex', gap: 20, height: '100%' }}>
      {/* Conversation sidebar */}
      <div style={{
        width: 220, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        <button
          onClick={startNewChat}
          style={{
            padding: '9px 14px', borderRadius: 6, fontSize: 13, fontWeight: 500,
            background: 'var(--accent-gold)', border: 'none', color: '#fff', cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          + New chat
        </button>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto' }}>
          {conversations.map(c => (
            <div
              key={c.id}
              onClick={() => openConversation(c.id)}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6,
                padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
                background: c.id === conversationId ? 'var(--bg-elevated)' : 'transparent',
              }}
              onMouseEnter={e => { if (c.id !== conversationId) e.currentTarget.style.background = 'var(--bg-hover)'; }}
              onMouseLeave={e => { if (c.id !== conversationId) e.currentTarget.style.background = 'transparent'; }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{
                  fontSize: 12.5, color: c.id === conversationId ? 'var(--text-primary)' : 'var(--text-secondary)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }}>
                  {c.title || 'Untitled'}
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>{fmtDate(c.updated_at)}</div>
              </div>
              <button
                onClick={e => deleteConversation(c.id, e)}
                title="Delete conversation"
                style={{
                  flexShrink: 0, fontSize: 12, color: 'var(--text-muted)', background: 'none', border: 'none',
                  cursor: 'pointer', padding: '2px 4px', borderRadius: 4, lineHeight: 1,
                }}
                onMouseEnter={e => e.currentTarget.style.color = '#c0392b'}
                onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
              >
                ✕
              </button>
            </div>
          ))}
          {conversations.length === 0 && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '8px 10px' }}>
              No saved chats yet.
            </div>
          )}
        </div>
      </div>

      {/* Chat column */}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 20 }}>
        {loadingConversation ? (
          <div style={{ padding: 40, color: 'var(--text-muted)' }}>Loading conversation…</div>
        ) : (
          <>
            {/* Intro / empty state */}
            {history.length === 0 && (
              <div style={{
                background: 'var(--bg-surface)', border: '1px solid var(--border)',
                borderRadius: 8, padding: 24, textAlign: 'center',
              }}>
                <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--text-primary)', margin: '0 0 8px' }}>
                  Ask about your content
                </h3>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 18px', maxWidth: 520, marginLeft: 'auto', marginRight: 'auto' }}>
                  Ask a question in plain English — Claude queries the live dashboard data (True Value scores,
                  GA4, Marfeel, Search Console) to answer with real numbers. Chats are saved automatically, and
                  you can ask follow-up questions in the same conversation.
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
                  {EXAMPLE_QUESTIONS.map(q => (
                    <button
                      key={q}
                      onClick={() => ask(q)}
                      style={{
                        fontSize: 12, color: 'var(--text-secondary)', background: 'var(--bg-elevated)',
                        border: '1px solid var(--border)', borderRadius: 20, padding: '7px 14px',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-elevated)'}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Conversation history */}
            {history.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {history.map((entry, i) => (
                  <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {/* Question */}
                    <div style={{ alignSelf: 'flex-end', maxWidth: '75%' }}>
                      <div style={{
                        background: 'var(--accent-gold)', color: '#fff',
                        borderRadius: '12px 12px 2px 12px', padding: '10px 14px',
                        fontSize: 14,
                      }}>
                        {entry.question}
                      </div>
                    </div>

                    {/* Answer */}
                    <div style={{ alignSelf: 'flex-start', maxWidth: '85%' }}>
                      <div style={{
                        background: 'var(--bg-surface)', border: '1px solid var(--border)',
                        borderRadius: '12px 12px 12px 2px', padding: '14px 16px',
                      }}>
                        {entry.loading && (
                          <div style={{ fontSize: 13, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                            Querying the dashboard…
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
              </div>
            )}
          </>
        )}

        {/* Search bar */}
        <form onSubmit={handleSubmit} style={{
          position: 'sticky', bottom: 0,
          display: 'flex', gap: 8,
          background: 'var(--bg-base)', paddingTop: 8,
        }}>
          <input
            type="text"
            value={question}
            onChange={e => setQuestion(e.target.value)}
            placeholder={history.length > 0 ? 'Ask a follow-up question…' : 'Ask a question about your content…'}
            style={{
              flex: 1, padding: '12px 16px', fontSize: 14,
              border: '1px solid var(--border)', borderRadius: 24,
              background: 'var(--bg-surface)',
            }}
          />
          <button type="submit" disabled={!question.trim()} style={{
            padding: '0 22px', borderRadius: 24, border: 'none',
            background: question.trim() ? 'var(--accent-gold)' : 'var(--bg-elevated)',
            color: question.trim() ? '#fff' : 'var(--text-muted)',
            fontSize: 14, fontWeight: 500,
          }}>
            Ask
          </button>
        </form>
      </div>
    </div>
  );
}
