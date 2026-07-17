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

export default function Insights() {
  const [question, setQuestion] = useState('');
  const [history, setHistory] = useState([]); // [{ question, answer, loading, error, queries_run }]
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  const ask = async (q) => {
    const text = (q ?? question).trim();
    if (!text) return;
    setQuestion('');

    const entry = { question: text, answer: null, loading: true, error: null, queries_run: [] };
    setHistory(h => [...h, entry]);
    const idx_marker = entry;

    try {
      const res = await api.askInsight(text);
      setHistory(h => h.map(e => e === idx_marker ? { ...e, answer: res.answer, queries_run: res.queries_run || [], loading: false } : e));
    } catch (err) {
      setHistory(h => h.map(e => e === idx_marker ? { ...e, error: err.message, loading: false } : e));
    }
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    ask();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20, height: '100%' }}>

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
            GA4, Marfeel, Search Console) to answer with real numbers.
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
          placeholder="Ask a question about your content…"
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
  );
}
