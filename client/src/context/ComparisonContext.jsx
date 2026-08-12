import React, { createContext, useContext, useState, useEffect } from 'react';

// Global, persisted on/off switch for the period-over-period "+/-%" badges
// and "vs. previous period" captions shown on Overview, Content, Sections,
// Writers, and Sources. One flag for the whole app (not per-tab) so a
// user's preference doesn't reset every time they switch views.
const STORAGE_KEY = 'dmag_show_comparisons';

const ComparisonContext = createContext(undefined);

export function ComparisonProvider({ children }) {
  const [showComparisons, setShowComparisons] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored === null ? true : stored === 'true';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(showComparisons));
    } catch {
      // localStorage unavailable (private mode, etc.) — preference just
      // won't persist across reloads, not worth surfacing an error for.
    }
  }, [showComparisons]);

  return (
    <ComparisonContext.Provider value={{ showComparisons, setShowComparisons }}>
      {children}
    </ComparisonContext.Provider>
  );
}

export function useComparisons() {
  const ctx = useContext(ComparisonContext);
  if (!ctx) throw new Error('useComparisons() must be called within a ComparisonProvider');
  return ctx;
}
