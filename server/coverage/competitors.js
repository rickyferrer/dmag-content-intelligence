// Competitor headline ingest for the Coverage Gaps report.
//
// Reads each competitor's public RSS feed (or, for the Dallas Morning News,
// its monthly sitemap) and accumulates headlines in competitor_articles. The
// busiest sites' feeds only reach back about a day, so this runs every few
// hours — the weekly report then reads a 7-day window out of the table rather
// than trying to fetch a week of history on demand.
//
// Only titles, links, a short snippet and dates are stored — never article
// bodies. To add or drop a competitor, edit COMPETITORS below.
import { getDb, setSyncState } from '../db.js';
import { stripHtml } from '../utils/stripHtml.js';

const USER_AGENT = process.env.COMPETITOR_USER_AGENT || 'DMag-ContentIntel/1.0 (+https://www.dmagazine.com)';
const REQUEST_TIMEOUT_MS = 20000;
const REQUEST_DELAY_MS = 300;        // be polite between requests
const LOOKBACK_DAYS = 7;             // how far back one run tries to reach
const RETENTION_DAYS = 45;           // how long rows are kept
const MAX_FEED_PAGES = 5;            // ?paged=N depth for WordPress feeds
const SNIPPET_CHARS = 220;

// kind 'rss'     — RSS/Atom feed. `paged: true` means a WordPress feed that
//                  accepts ?paged=N, so a first run can reach back a full week.
// kind 'sitemap' — monthly XML sitemap with no headlines (see syncSitemap).
//
// Not included: Dallas Business Journal, KERA News and Axios Dallas refuse
// server requests (HTTP 403); Eater Dallas's feed is evergreen guides only.
export const COMPETITORS = [
  { id: 'dallas-morning-news', name: 'The Dallas Morning News', kind: 'sitemap',
    sitemapUrl: (y, m) => `https://www.dallasnews.com/sitemap/web-${y}-${m}.xml`,
    // Sections that are noise for a city-magazine comparison (volume, not
    // relevance: sports alone is ~500 URLs a month). Matched against the
    // URL path.
    skipPath: /\/(espanol|news\/weather|sports|high-school-sports|horoscopes|letters-to-the-editor|obituaries|tv-radio-listings|lottery|crossword|puzzles|comics)\//i },
  { id: 'dallas-observer', name: 'Dallas Observer', kind: 'rss', url: 'https://www.dallasobserver.com/dallas/Rss.xml' },
  { id: 'dallas-express', name: 'The Dallas Express', kind: 'rss', url: 'https://dallasexpress.com/feed/', paged: true },
  { id: 'culturemap', name: 'CultureMap Dallas', kind: 'rss', url: 'https://dallas.culturemap.com/feeds/feed.rss' },
  { id: 'candys-dirt', name: "Candy's Dirt", kind: 'rss', url: 'https://candysdirt.com/feed/', paged: true },
  { id: 'dallas-innovates', name: 'Dallas Innovates', kind: 'rss', url: 'https://dallasinnovates.com/feed/', paged: true },
  { id: 'fort-worth-report', name: 'Fort Worth Report', kind: 'rss', url: 'https://fortworthreport.org/feed/', paged: true },
  { id: 'texas-monthly', name: 'Texas Monthly', kind: 'rss', url: 'https://www.texasmonthly.com/feed/', paged: true },
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchText(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// ── Tiny RSS/Atom parsing ────────────────────────────────────────────────────
// Feeds are regular enough that a few regexes beat adding an XML dependency;
// every field is optional and a malformed item is skipped, never fatal.

function decodeEntities(str) {
  return str
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&apos;/g, "'").replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function tagText(block, tag) {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!m) return '';
  return m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1').trim();
}

// Atom puts the URL in <link href="…">; RSS in <link>…</link>.
function itemLink(block) {
  const rss = tagText(block, 'link');
  if (rss) return rss;
  const alt = block.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i)
    || block.match(/<link[^>]*href=["']([^"']+)["']/i);
  return alt ? decodeEntities(alt[1]) : '';
}

function toIso(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function parseFeed(xml) {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  const items = [];
  for (const b of blocks) {
    const title = stripHtml(decodeEntities(tagText(b, 'title'))).replace(/\s+/g, ' ');
    const url = itemLink(b);
    if (!title || !url) continue;
    const published = toIso(tagText(b, 'pubDate') || tagText(b, 'published') || tagText(b, 'dc:date') || tagText(b, 'updated'));
    const rawSummary = tagText(b, 'description') || tagText(b, 'summary');
    const summary = rawSummary ? stripHtml(decodeEntities(rawSummary)).replace(/\s+/g, ' ').slice(0, SNIPPET_CHARS) : '';
    const section = stripHtml(decodeEntities(tagText(b, 'category'))) || null;
    items.push({ title, url: url.split('#')[0], published_at: published, summary, section, title_from_url: 0 });
  }
  return items;
}

// ── Sitemap source (Dallas Morning News) ─────────────────────────────────────
// DMN has no RSS feed and its news sitemap went stale (newest entry days old),
// but the monthly sitemap is current. It carries no headlines, so the title is
// rewritten from the URL slug — flagged title_from_url so the report knows
// it's approximate. lastmod can be an edit time, not a publish time, so old
// stories that were merely updated are filtered out by article ID: IDs are
// assigned sequentially across the site (~1,500/day measured), so anything
// far below the newest ID was created long before the lookback window.
const DMN_IDS_PER_DAY = 1800; // deliberately above the measured ~1,500

function slugToTitle(url) {
  const last = new URL(url).pathname.split('/').filter(Boolean).pop() || '';
  return last.replace(/\.php$/i, '').replace(/-\d{6,}$/, '').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
}

function parseSitemapUrls(xml) {
  return (xml.match(/<url>[\s\S]*?<\/url>/gi) || []).map(block => ({
    url: tagText(block, 'loc'),
    lastmod: toIso(tagText(block, 'lastmod')),
  })).filter(e => e.url);
}

async function fetchSitemapItems(source, cutoffIso) {
  const now = new Date();
  const months = new Set([`${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`]);
  const back = new Date(cutoffIso);
  months.add(`${back.getUTCFullYear()}-${String(back.getUTCMonth() + 1).padStart(2, '0')}`);

  const entries = [];
  for (const ym of months) {
    const [y, m] = ym.split('-');
    try {
      entries.push(...parseSitemapUrls(await fetchText(source.sitemapUrl(y, m))));
    } catch (err) {
      // The previous month's sitemap may not exist yet/anymore — only the
      // current month's failure is worth reporting.
      if (ym === [...months][0]) throw err;
    }
    await sleep(REQUEST_DELAY_MS);
  }

  const articles = entries.filter(e => /\/article\//.test(e.url) && !source.skipPath.test(e.url) && e.lastmod && e.lastmod >= cutoffIso);
  const idOf = (u) => parseInt((u.match(/-(\d{6,})\.php/) || [])[1] || '0', 10);
  const maxId = Math.max(0, ...articles.map(e => idOf(e.url)));
  const floor = maxId - DMN_IDS_PER_DAY * LOOKBACK_DAYS;

  return articles
    .filter(e => idOf(e.url) >= floor)
    .map(e => ({
      title: slugToTitle(e.url),
      url: e.url,
      published_at: e.lastmod,
      summary: '',
      section: new URL(e.url).pathname.split('/').filter(Boolean).slice(0, 2).join('/'),
      title_from_url: 1,
    }))
    .filter(a => a.title);
}

// ── Ingest ───────────────────────────────────────────────────────────────────

async function fetchRssItems(source, isKnown, cutoffIso) {
  const items = [];
  const maxPages = source.paged ? MAX_FEED_PAGES : 1;
  for (let page = 1; page <= maxPages; page++) {
    const url = page === 1 ? source.url : `${source.url}${source.url.includes('?') ? '&' : '?'}paged=${page}`;
    let pageItems;
    try {
      pageItems = parseFeed(await fetchText(url));
    } catch (err) {
      if (page === 1) throw err; // a missing deeper page just ends the walk
      break;
    }
    if (pageItems.length === 0) break;
    items.push(...pageItems);
    // Keep walking only while this page was entirely new and still inside the
    // lookback window — i.e. a first run, or a gap since the last run.
    const allNew = pageItems.every(i => !isKnown(i.url));
    const oldest = pageItems.map(i => i.published_at).filter(Boolean).sort()[0];
    if (!allNew || (oldest && oldest < cutoffIso)) break;
    await sleep(REQUEST_DELAY_MS);
  }
  return items;
}

export async function syncCompetitors() {
  const db = getDb();
  const cutoffIso = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString();
  const isKnown = (() => {
    const stmt = db.prepare('SELECT 1 FROM competitor_articles WHERE url = ?');
    return (url) => !!stmt.get(url);
  })();
  const insert = db.prepare(`
    INSERT INTO competitor_articles (source, url, title, title_from_url, summary, section, published_at)
    VALUES (@source, @url, @title, @title_from_url, @summary, @section, @published_at)
    ON CONFLICT(url) DO NOTHING
  `);

  const results = [];
  for (const source of COMPETITORS) {
    const result = { id: source.id, name: source.name, ok: true, fetched: 0, added: 0, error: null };
    try {
      const items = source.kind === 'sitemap'
        ? await fetchSitemapItems(source, cutoffIso)
        : await fetchRssItems(source, isKnown, cutoffIso);
      result.fetched = items.length;
      db.transaction(() => {
        for (const item of items) {
          // Undated items can't be placed in a week — skip rather than guess.
          if (!item.published_at) continue;
          result.added += insert.run({ source: source.name, ...item }).changes;
        }
      })();
    } catch (err) {
      result.ok = false;
      result.error = err.message;
      console.warn(`[Competitors] ${source.name}: ${err.message}`);
    }
    results.push(result);
    await sleep(REQUEST_DELAY_MS);
  }

  db.prepare("DELETE FROM competitor_articles WHERE first_seen_at < datetime('now', ?)").run(`-${RETENTION_DAYS} days`);

  const added = results.reduce((n, r) => n + r.added, 0);
  const failed = results.filter(r => !r.ok).length;
  setSyncState('last_competitor_sync', new Date().toISOString());
  setSyncState('competitor_sync_status', JSON.stringify({ at: new Date().toISOString(), added, failed, sources: results }));
  console.log(`[Competitors] Sync complete — ${added} new headlines, ${failed}/${results.length} sources failed`);
  return { added, failed, sources: results };
}

// Per-source health for the report page: how much each source contributed in
// the window and how fresh its newest item is, so a silently-dead feed (as DMN's
// news sitemap turned out to be) shows up as zero instead of looking like
// "no competitor coverage".
export function competitorHealth(sinceIso) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT source, COUNT(*) AS articles, MAX(published_at) AS newest, MAX(title_from_url) AS title_from_url
    FROM competitor_articles WHERE published_at >= ? GROUP BY source
  `).all(sinceIso);
  const bySource = new Map(rows.map(r => [r.source, r]));
  return COMPETITORS.map(c => {
    const r = bySource.get(c.name);
    return { name: c.name, articles: r?.articles || 0, newest: r?.newest || null, titleFromUrl: !!r?.title_from_url || c.kind === 'sitemap' };
  });
}
