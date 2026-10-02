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
// `color` is a chart FILL from the shared Mixpanel palette — the same hexes as
// client/src/constants/palette.js (the server sends these down with
// /api/analytics/channels, so they're mirrored here rather than imported).
// 'referral' stays a neutral gray on purpose: it's the catch-all for
// everything not named above, not a category of its own. Same hue families
// as before (search = blue, social = red, email = amber, ...) so the Sources
// tab doesn't need relearning. The client darkens these via readableInk()
// wherever one is used as text.
export const CUSTOM_CHANNELS = {
  search: {
    label: 'Search Engines',
    color: '#72bef4',
    sources: new Set(['Google', 'Bing', 'DuckDuckGo', 'Yahoo!', 'Ecosia', 'Google News',
                      'Yandex', 'Brave', 'Baidu']),
  },
  discover: {
    label: 'Google Discover',
    color: '#ffb27a',
    sources: new Set(['Google Discover']),
  },
  dark_social: {
    label: 'Dark Social',
    color: '#7856ff',
    sources: new Set(['dark social']),
  },
  direct: {
    label: 'Direct / Bookmark',
    color: '#3ca975',
    sources: new Set(['direct', 'bookmark']),
  },
  social: {
    label: 'Social Media',
    color: '#ff7558',
    sources: new Set(['Facebook', 'Reddit', 'Twitter', 'Instagram', 'LinkedIn',
                      'Bluesky', 'Threads', 'Pinterest', 'Nextdoor', 'nextdoor.com',
                      'later-linkinbio', 'linkin.bio', 'ig', 'com.reddit.frontpage',
                      'old.reddit.com', 'linktr.ee']),
  },
  email: {
    label: 'Email',
    color: '#f9bd3c',
    sources: new Set(['hs_email', 'newsletter', 'omnisend', 'Gmail', 'WEBCTA',
                      'pushengage', 'hub.marfeel.com']),
  },
  ai: {
    label: 'AI Referral',
    color: '#5cb7af',
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
