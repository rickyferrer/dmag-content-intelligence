const BASE = '/api';

// A 401 from anywhere but the auth endpoints themselves means the session
// ended (expired, signed out elsewhere, account deactivated) — tell the app
// so it can drop back to the sign-in screen instead of every panel failing.
async function apiFetch(path, options = {}) {
  const res = await fetch(BASE + path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('auth:expired'));
    let message = null;
    try { message = JSON.parse(text)?.error; } catch { /* not JSON */ }
    const err = new Error(message || `API ${path} failed (${res.status}): ${text}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export const api = {
  // Auth & users
  me: () => apiFetch('/auth/me'),
  login: (username, password) => apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () => apiFetch('/auth/logout', { method: 'POST' }),
  changePassword: (current_password, new_password) => apiFetch('/auth/change-password', { method: 'POST', body: JSON.stringify({ current_password, new_password }) }),
  listUsers: () => apiFetch('/users'),
  listLogins: () => apiFetch('/users/logins?limit=50'),
  createUser: (body) => apiFetch('/users', { method: 'POST', body: JSON.stringify(body) }),
  updateUser: (id, body) => apiFetch(`/users/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  resetUserPassword: (id, password) => apiFetch(`/users/${id}/password`, { method: 'POST', body: JSON.stringify({ password }) }),
  deleteUser: (id) => apiFetch(`/users/${id}`, { method: 'DELETE' }),

  // Content
  getContent: (params = {}) => apiFetch('/content?' + new URLSearchParams(params)),
  getContentItem: (id) => apiFetch(`/content/${id}`),
  getContentTypes: () => apiFetch('/content/types'),
  getTaxonomies: () => apiFetch('/content/taxonomies'),
  getWriters: () => apiFetch('/content/writers'),
  getContentSummary: (params = {}) => apiFetch('/content/summary?' + new URLSearchParams(params)),
  reclassify: (id) => apiFetch(`/content/${id}/reclassify`, { method: 'POST' }),
  reclassifyCategories: (id) => apiFetch(`/content/${id}/reclassify-categories`, { method: 'POST' }),
  reclassifyVoice: (id) => apiFetch(`/content/${id}/reclassify-voice`, { method: 'POST' }),

  // Analytics
  getSummary: (params = {}) => apiFetch('/analytics/summary?' + new URLSearchParams(params)),
  getByNeed: (params = {}) => apiFetch('/analytics/by-need?' + new URLSearchParams(params)),
  getBySection: (params = {}) => apiFetch('/analytics/by-section?' + new URLSearchParams(params)),
  getByWriter: (params = {}) => apiFetch('/analytics/by-writer?' + new URLSearchParams(params)),
  getByIssue: (params = {}) => apiFetch('/analytics/by-issue?' + new URLSearchParams(params)),
  getVulnerability: (params = {}) => apiFetch('/analytics/vulnerability?' + new URLSearchParams(params)),

  // Insights
  askInsight: (question, conversationId) => apiFetch('/insights/ask', { method: 'POST', body: JSON.stringify({ question, conversation_id: conversationId }) }),
  getInsightConversations: () => apiFetch('/insights/conversations'),
  getInsightConversation: (id) => apiFetch(`/insights/conversations/${id}`),
  deleteInsightConversation: (id) => apiFetch(`/insights/conversations/${id}`, { method: 'DELETE' }),
  getChannels: (params = {}) => apiFetch('/analytics/channels?' + new URLSearchParams(params)),
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
  getBenchmarkChecks: () => apiFetch('/settings/benchmark-checks'),
  runBenchmarkCheck: () => apiFetch('/settings/benchmark-checks/run', { method: 'POST' }),
  applyBenchmarkCheck: (id) => apiFetch(`/settings/benchmark-checks/${id}/apply`, { method: 'POST' }),
  dismissBenchmarkCheck: (id) => apiFetch(`/settings/benchmark-checks/${id}/dismiss`, { method: 'POST' }),

  // Goals
  getGoalMetrics: () => apiFetch('/goals/metrics'),
  getGoals: (params = {}) => apiFetch('/goals?' + new URLSearchParams(params)),
  getGoal: (id) => apiFetch(`/goals/${id}`),
  createGoal: (body) => apiFetch('/goals', { method: 'POST', body: JSON.stringify(body) }),
  updateGoal: (id, body) => apiFetch(`/goals/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  archiveGoal: (id, archived = true) => apiFetch(`/goals/${id}/archive`, { method: 'POST', body: JSON.stringify({ archived }) }),
  deleteGoal: (id) => apiFetch(`/goals/${id}`, { method: 'DELETE' }),
};
