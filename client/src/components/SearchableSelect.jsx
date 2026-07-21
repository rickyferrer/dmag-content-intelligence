import React, { useState, useRef, useEffect } from 'react';

// A searchable dropdown ("combobox") — a drop-in replacement for a native
// <select> when the option list is long enough that scrolling through it is
// painful (e.g. 100+ writers). Options: [{ value, label }]. value is the
// currently selected option's value, or '' for "no filter".
export default function SearchableSelect({ value, onChange, options, placeholder = 'All', minWidth = 160 }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const selected = options.find(o => String(o.value) === String(value));

  useEffect(() => {
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
        setQuery('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filtered = query.trim()
    ? options.filter(o => o.label.toLowerCase().includes(query.trim().toLowerCase()))
    : options;

  const handleSelect = (opt) => {
    onChange(opt ? opt.value : '');
    setOpen(false);
    setQuery('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHighlighted(h => Math.min(h + 1, filtered.length));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted(h => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlighted === 0) handleSelect(null);
      else if (filtered[highlighted - 1]) handleSelect(filtered[highlighted - 1]);
    } else if (e.key === 'Escape') {
      setOpen(false);
      setQuery('');
      inputRef.current?.blur();
    }
  };

  // Keep the highlighted row scrolled into view during keyboard nav
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.children[highlighted];
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlighted, open]);

  return (
    <div ref={containerRef} style={{ position: 'relative', minWidth }}>
      <input
        ref={inputRef}
        type="text"
        value={open ? query : (selected ? selected.label : '')}
        placeholder={placeholder}
        onFocus={() => { setOpen(true); setQuery(''); setHighlighted(0); }}
        onChange={e => { setQuery(e.target.value); setHighlighted(0); setOpen(true); }}
        onKeyDown={handleKeyDown}
        style={{
          width: '100%',
          padding: '6px 26px 6px 10px',
          fontSize: 13,
          border: `1px solid ${value ? 'var(--accent-gold)' : 'var(--border)'}`,
          borderRadius: 4,
          background: 'var(--bg-surface)',
          color: 'var(--text-primary)',
        }}
      />
      <span style={{
        position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
        fontSize: 10, color: 'var(--text-muted)', pointerEvents: 'none',
      }}>
        {open ? '▲' : '▼'}
      </span>
      {open && (
        <div
          ref={listRef}
          style={{
            position: 'absolute', top: '100%', left: 0, minWidth: '100%', width: 'max-content', maxWidth: 360,
            marginTop: 2, background: 'var(--bg-surface)', border: '1px solid var(--border)',
            borderRadius: 6, boxShadow: '0 6px 16px rgba(0,0,0,0.12)',
            maxHeight: 280, overflowY: 'auto', zIndex: 100,
          }}
        >
          <div
            onMouseDown={(e) => { e.preventDefault(); handleSelect(null); }}
            onMouseEnter={() => setHighlighted(0)}
            style={{
              padding: '7px 10px', fontSize: 13, cursor: 'pointer',
              color: 'var(--text-muted)', fontStyle: 'italic',
              background: highlighted === 0 ? 'var(--bg-hover)' : 'transparent',
            }}
          >
            {placeholder}
          </div>
          {filtered.length === 0 && (
            <div style={{ padding: '7px 10px', fontSize: 12, color: 'var(--text-muted)' }}>No matches</div>
          )}
          {filtered.map((opt, i) => (
            <div
              key={opt.value}
              onMouseDown={(e) => { e.preventDefault(); handleSelect(opt); }}
              onMouseEnter={() => setHighlighted(i + 1)}
              style={{
                padding: '7px 10px', fontSize: 13, cursor: 'pointer',
                whiteSpace: 'nowrap',
                color: String(opt.value) === String(value) ? 'var(--accent-gold)' : 'var(--text-primary)',
                fontWeight: String(opt.value) === String(value) ? 600 : 400,
                background: highlighted === i + 1 ? 'var(--bg-hover)' : 'transparent',
              }}
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
