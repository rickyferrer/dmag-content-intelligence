// Custom channel taxonomy — buckets raw Marfeel `source` values (see
// sync/marfeel.js) into the groups shown in the Sources tab (routes/
// analytics.js's /channels) and, since goals can be scoped by traffic
// source, in utils/goals.js too. One definition, shared, so the two never
// drift: a goal for "Search Engines" traffic means the same set of raw
// sources as the Sources tab's "Search Engines" row.
//
// This exists because source_daily's raw `source` column is hundreds of
// literal referrer values (domains, app names, internal analytics IDs,
// stray query-param artifacts) — meaningful for debugging, but not
// something anyone should have to pick out of a 400-item dropdown to set a
// goal against. Bucketing into a handful of named channels is what makes
// "traffic source" a usable goal scope at all.
export const CUSTOM_CHANNELS = {
  search: {
    label: 'Search Engines',
    color: '#2474bb',
    sources: new Set(['Google', 'Bing', 'DuckDuckGo', 'Yahoo!', 'Ecosia', 'Google News',
                      'Yandex', 'Brave', 'Baidu']),
  },
  discover: {
    label: 'Google Discover',
    color: '#e67e22',
    sources: new Set(['Google Discover']),
  },
  dark_social: {
    label: 'Dark Social',
    color: '#8e44ad',
    sources: new Set(['dark social']),
  },
  direct: {
    label: 'Direct / Bookmark',
    color: '#27ae60',
    sources: new Set(['direct', 'bookmark']),
  },
  social: {
    label: 'Social Media',
    color: '#e74c3c',
    sources: new Set(['Facebook', 'Reddit', 'Twitter', 'Instagram', 'LinkedIn',
                      'Bluesky', 'Threads', 'Pinterest', 'Nextdoor', 'nextdoor.com',
                      'later-linkinbio', 'linkin.bio', 'ig', 'com.reddit.frontpage',
                      'old.reddit.com', 'linktr.ee']),
  },
  email: {
    label: 'Email',
    color: '#f39c12',
    sources: new Set(['hs_email', 'newsletter', 'omnisend', 'Gmail', 'WEBCTA',
                      'pushengage', 'hub.marfeel.com']),
  },
  ai: {
    label: 'AI Referral',
    color: '#1abc9c',
    sources: new Set(['ChatGPT', 'Claude', 'Perplexity', 'perplexity.ai']),
  },
  referral: {
    label: 'Referral',
    color: '#95a5a6',
    sources: new Set(), // catch-all for everything else
  },
};

export function customChannelFor(source) {
  for (const [key, ch] of Object.entries(CUSTOM_CHANNELS)) {
    if (key === 'referral') continue;
    if (ch.sources.has(source)) return key;
  }
  return 'referral';
}
