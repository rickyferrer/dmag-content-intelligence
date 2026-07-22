const BASE = '/api';

async function apiFetch(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${path} failed (${res.status}): ${text}`);
  }
  return res.json();
}

export const api = {
  // Content
  getContent: (params = {}) => apiFetch('/content?' + new URLSearchParams(params)),
  getContentItem: (id) => apiFetch(`/content/${id}`),
  getContentTypes: () => apiFetch('/content/types'),
  getTaxonomies: () => apiFetch('/content/taxonomies'),
  getWriters: () => apiFetch('/content/writers'),
  reclassify: (id) => apiFetch(`/content/${id}/reclassify`, { method: 'POST' }),

  // Analytics
  getSummary: (params = {}) => apiFetch('/analytics/summary?' + new URLSearchParams(params)),
  getByNeed: (params = {}) => apiFetch('/analytics/by-need?' + new URLSearchParams(params)),
  getBySection: (params = {}) => apiFetch('/analytics/by-section?' + new URLSearchParams(params)),
  getByIssue: (params = {}) => apiFetch('/analytics/by-issue?' + new URLSearchParams(params)),
  getVulnerability: () => apiFetch('/analytics/vulnerability'),

  // Insights
  askInsight: (question) => apiFetch('/insights/ask', { method: 'POST', body: JSON.stringify({ question }) }),
  getByTrafficSource: (params = {}) => apiFetch('/analytics/by-traffic-source?' + new URLSearchParams(params)),
  getSourcePerformance: () => apiFetch('/analytics/source-performance'),
  getScatter: (params = {}) => apiFetch('/analytics/scatter?' + new URLSearchParams(params)),
  getTrend: (days = 30) => apiFetch(`/analytics/trend?days=${days}`),

  // Sync
  getSyncStatus: () => apiFetch('/sync/status'),
  triggerSync: (type = 'all') => apiFetch('/sync/trigger', { method: 'POST', body: JSON.stringify({ type }) }),

  // Settings
  getSettings: () => apiFetch('/settings'),
  updateSettings: (body) => apiFetch('/settings', { method: 'PUT', body: JSON.stringify(body) }),
  recalculateScores: () => apiFetch('/settings/recalculate', { method: 'POST' }),
  cleanupData: (years = 2) => apiFetch('/settings/cleanup', { method: 'POST', body: JSON.stringify({ years, confirm: 'DELETE' }) }),
  getExclusions: () => apiFetch('/settings/exclusions'),
  setExclusions: (urls) => apiFetch('/settings/exclusions', { method: 'POST', body: JSON.stringify({ urls }) }),
  getAuditLog: () => apiFetch('/settings/audit-log'),
};
