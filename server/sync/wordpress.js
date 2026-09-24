import { getDb, getSyncState, setSyncState } from '../db.js';
import { stripHtml } from '../utils/stripHtml.js';

const WP_BASE = process.env.WP_API_BASE || 'https://www.dmagazine.com/wp-json/wp/v2';
const USER_AGENT = process.env.WP_USER_AGENT || 'SEO DMAG Crawl';

const CONTENT_TYPES = ['posts', 'pages', 'micropost', 'tribe_events', 'video'];

// Limit initial (full) sync to content published within this window.
// Prevents pulling decades of historical archives on first run.
const FULL_SYNC_LOOKBACK_YEARS = 2;

// Pass 1: metadata per page — no content, no acf (acf can be enormous with nested custom fields)
const META_PER_PAGE = 50;
// acf.stream_video_id is the Cloudflare Stream UID for video posts (empty string
// on everything else) — the join key to Cloudflare's per-video minutes viewed.
// We request only the nested acf.writers array (not full ACF, which includes huge
// hero-image objects). acf.writers[] holds the editorial byline as writer_id refs.
const META_FIELDS = 'id,slug,link,title,date,modified,author,categories,tags,section,type,acf.writers,acf.stream_video_id,featured_media';

// Pass 2: fetch full content in small ID batches to avoid large responses
const CONTENT_BATCH_SIZE = 10;
const CONTENT_FIELDS = 'id,content';

const PAGE_DELAY_MS = 300; // be polite between requests

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function decodeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&apos;/g, "'")
    .replace(/&#8217;/g, '’')
    .replace(/&#8216;/g, '‘')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)));
}

async function wpFetch(url) {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) {
    const err = new Error(`WP fetch failed: ${res.status} ${url}`);
    err.status = res.status;
    throw err;
  }
  const totalPages = parseInt(res.headers.get('x-wp-totalpages') || '1', 10);
  const data = await res.json();
  return { data, totalPages };
}

// Pre-fetch category, tag, and user name caches
// Much lighter than _embed=author,wp:term on every post request
async function fetchTaxonomyCache() {
  const catCache = new Map();
  const tagCache = new Map();
  const userCache = new Map();
  const sectionCache = new Map();

  for (const [endpoint, cache] of [
    ['categories', catCache],
    ['tags',       tagCache],
    ['users',      userCache],
    ['section',    sectionCache],  // custom Section taxonomy (rest_base: section)
  ]) {
    let page = 1;
    while (true) {
      try {
        const url = `${WP_BASE}/${endpoint}?per_page=100&page=${page}&_fields=id,name,slug`;
        const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
        if (!res.ok) break;
        const totalPages = parseInt(res.headers.get('x-wp-totalpages') || '1', 10);
        const items = await res.json();
        if (!Array.isArray(items) || items.length === 0) break;
        for (const item of items) {
          cache.set(item.id, { id: item.id, slug: item.slug, name: decodeHtml(item.name) });
        }
        if (page >= totalPages) break;
        page++;
        await sleep(PAGE_DELAY_MS);
      } catch (err) {
        console.warn(`[WP] Could not fetch ${endpoint} page ${page}:`, err.message);
        break;
      }
    }
  }

  console.log(`[WP] Taxonomy cache: ${catCache.size} categories, ${tagCache.size} tags, ${userCache.size} authors, ${sectionCache.size} sections`);
  return { catCache, tagCache, userCache, sectionCache };
}

async function probeType(type) {
  try {
    const res = await fetch(`${WP_BASE}/${type}?per_page=1&status=publish`, {
      headers: { 'User-Agent': USER_AGENT },
    });
    return res.ok;
  } catch {
    return false;
  }
}

function parseAuthor(post, userCache) {
  const id = post.author;
  if (id && userCache.has(id)) return userCache.get(id).name || String(id);
  return String(id || '');
}

function parseSection(post, sectionCache) {
  // Use the dedicated Section taxonomy (rest_base: section), not WP categories
  const ids = post.section || [];
  if (ids.length > 0 && sectionCache.has(ids[0])) {
    const s = sectionCache.get(ids[0]);
    return s.name || s.slug || '';  // store human-readable name (already HTML-decoded)
  }
  return '';
}

function parseCategories(post, catCache) {
  const ids = post.categories || [];
  const resolved = ids.map(id => catCache.get(id)).filter(Boolean);
  if (resolved.length === 0 && ids.length > 0) return JSON.stringify(ids.map(id => ({ id })));
  return JSON.stringify(resolved);
}

function parseTags(post, tagCache) {
  const ids = post.tags || [];
  return JSON.stringify(ids.map(id => tagCache.get(id)).filter(Boolean));
}

// The editorial "writer" byline lives in ACF as acf.writers[] — an array of
// { writer_id } references to the 'writers' custom post type. (This is distinct
// from `author`, the WP user who hit Publish.) Returns the list of writer IDs;
// names are resolved separately via the /wp/v2/writers endpoint.
function parseWriterIds(post) {
  const arr = post.acf?.writers;
  if (!Array.isArray(arr)) return [];
  return arr.map(w => w?.writer_id).filter(Boolean);
}

// Resolve writer post-type IDs to display names, batched via ?include=.
// 3,300+ writers exist, so we only fetch the ones actually referenced.
async function fetchWriterNames(ids) {
  const cache = new Map();
  const unique = [...new Set(ids)].filter(Boolean);
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const url = `${WP_BASE}/writers?include=${chunk.join(',')}&per_page=100&_fields=id,title`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (!res.ok) continue;
      const items = await res.json();
      for (const it of items) {
        cache.set(it.id, decodeHtml(it.title?.rendered || ''));
      }
      if (i + 100 < unique.length) await sleep(PAGE_DELAY_MS);
    } catch (err) {
      console.warn(`[WP] Writer name fetch failed for chunk:`, err.message);
    }
  }
  return cache;
}

// featured_media is a plain attachment-post ID (0 when no featured image is
// set) — cheap to request alongside the rest of META_FIELDS. The actual
// image URL isn't in this response; it's resolved separately below.
function parseFeaturedMediaId(post) {
  return post.featured_media || 0;
}

// Resolve featured-media attachment IDs to a display-size image URL,
// batched via ?include= same as fetchWriterNames. Prefers a mid-size
// rendition (medium_large, then medium) over the full original — a cover
// thumbnail doesn't need a multi-MB source image — falling back to
// source_url only if WordPress hasn't generated those sizes for this
// attachment (e.g. an image smaller than the medium_large threshold).
async function fetchMediaUrls(ids) {
  const cache = new Map();
  const unique = [...new Set(ids)].filter(Boolean);
  const fields = 'id,source_url,media_details.sizes.medium_large.source_url,media_details.sizes.medium.source_url';
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const url = `${WP_BASE}/media?include=${chunk.join(',')}&per_page=100&_fields=${fields}`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (!res.ok) continue;
      const items = await res.json();
      for (const it of items) {
        const sizes = it.media_details?.sizes;
        const src = sizes?.medium_large?.source_url || sizes?.medium?.source_url || it.source_url;
        if (src) cache.set(it.id, src);
      }
      if (i + 100 < unique.length) await sleep(PAGE_DELAY_MS);
    } catch (err) {
      console.warn(`[WP] Media fetch failed for chunk:`, err.message);
    }
  }
  return cache;
}

// Cloudflare Stream video UID (32-char hex), or null when the post has none.
// COALESCE in the upsert means a null here never wipes an already-stored ID.
function parseStreamVideoId(post) {
  const id = post.acf?.stream_video_id;
  return typeof id === 'string' && id.trim() ? id.trim() : null;
}

function parseSubscriptionRequired(post) {
  // acf removed from meta fields to avoid massive response sizes;
  // subscription_required defaults to 0 — update via separate ACF pass if needed
  const val = post.acf?.subscription_required;
  return (val === true || val === 'true' || val === 1 || val === '1') ? 1 : 0;
}

// Pass 2: fetch content for a batch of known IDs on a given type endpoint
async function fetchContentBatch(type, ids) {
  const url = `${WP_BASE}/${type}?include=${ids.join(',')}&per_page=${ids.length}&_fields=${CONTENT_FIELDS}`;
  try {
    const { data } = await wpFetch(url);
    const map = new Map();
    for (const post of data) {
      map.set(post.id, stripHtml(post.content?.rendered || ''));
    }
    return map;
  } catch (err) {
    console.error(`[WP] Content batch error for ${type} [${ids.join(',')}]:`, err.message);
    return new Map();
  }
}

// Options (used for one-off backfills of newly added types):
//   types — restrict the run to these REST bases (default: all CONTENT_TYPES)
//   full  — ignore the incremental watermark and pull the full lookback window;
//           the watermark is left untouched so regular syncs are unaffected
export async function syncWordPress({ types = CONTENT_TYPES, full = false } = {}) {
  const db = getDb();
  const lastSync = full ? null : getSyncState('last_wp_sync');
  const now = new Date().toISOString();

  // Incremental: use modified_after so we only fetch changed/new posts since last sync.
  // First run: no lastSync — use a published-date `after` cutoff to avoid pulling decades
  //   of archives (dmagazine.com has 100K+ historical posts going back years).
  const modifiedAfter = lastSync || null;
  const fullSyncAfter = (() => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - FULL_SYNC_LOOKBACK_YEARS);
    return d.toISOString(); // ISO 8601, WP `after` param accepts this format
  })();

  console.log(modifiedAfter
    ? `[WP] Incremental sync — modified after ${modifiedAfter}`
    : `[WP] Full sync — fetching content published after ${fullSyncAfter.slice(0, 10)} (last ${FULL_SYNC_LOOKBACK_YEARS} years)`);

  const { catCache, tagCache, userCache, sectionCache } = await fetchTaxonomyCache();

  // PASS 1: upsert metadata only (no content_text yet) — fast, small responses
  // Note: `writer` is intentionally NOT set here — it's resolved and updated in a
  // dedicated pass after metadata, so a failed writer fetch never wipes existing names.
  const upsertMeta = db.prepare(`
    INSERT INTO content (
      wp_id, slug, url, title, content_text, content_type,
      author, published_at, modified_at, section, categories, tags,
      subscription_required, stream_video_id, updated_at
    ) VALUES (
      @wp_id, @slug, @url, @title, '', @content_type,
      @author, @published_at, @modified_at, @section, @categories, @tags,
      @subscription_required, @stream_video_id, datetime('now')
    )
    ON CONFLICT(wp_id) DO UPDATE SET
      slug            = excluded.slug,
      url             = excluded.url,
      title           = excluded.title,
      content_type    = excluded.content_type,
      author          = excluded.author,
      published_at    = excluded.published_at,
      modified_at     = excluded.modified_at,
      section         = excluded.section,
      categories      = excluded.categories,
      tags            = excluded.tags,
      subscription_required = excluded.subscription_required,
      stream_video_id = COALESCE(excluded.stream_video_id, content.stream_video_id),
      updated_at      = datetime('now')
  `);

  // Track which IDs came in from this sync run, keyed by type (needed for pass 2)
  const typeToIds = new Map(); // type → [wp_id, ...]
  // Track writer-id references per post for the writer-resolution pass
  const writerIdsByPost = new Map(); // wp_id → [writer_id, ...]
  // Track featured-media attachment IDs per post for the cover-image pass
  const featuredMediaByPost = new Map(); // wp_id → media_id

  let totalMeta = 0;
  const errors = [];

  for (const type of types) {
    const exists = await probeType(type);
    if (!exists) {
      console.log(`[WP] Type '${type}' not available — skipping`);
      continue;
    }

    const ids = [];
    let page = 1;
    let totalPages = 1;

    while (page <= totalPages) {
      // No _embed at all — author resolved from userCache, categories/tags from taxonomy caches
      // This keeps each response under ~15KB even for 50 posts
      const dateFilter = modifiedAfter
        ? `&modified_after=${encodeURIComponent(modifiedAfter)}&before=${encodeURIComponent(now)}`
        : `&after=${encodeURIComponent(fullSyncAfter)}`;
      const url = `${WP_BASE}/${type}?per_page=${META_PER_PAGE}&status=publish` +
        `&_fields=${META_FIELDS}${dateFilter}&page=${page}`;

      try {
        const { data: posts, totalPages: tp } = await wpFetch(url);
        totalPages = tp;

        db.transaction(() => {
          for (const post of posts) {
            const contentType = type === 'posts' ? 'post' : type.replace('tribe_', '');
            // Microposts don't carry their own Section taxonomy in WordPress —
            // they all belong to FrontBurner editorially.
            const section = contentType === 'micropost' ? 'FrontBurner' : parseSection(post, sectionCache);
            upsertMeta.run({
              wp_id: post.id,
              slug: post.slug || '',
              url: post.link || '',
              title: stripHtml(post.title?.rendered || ''),
              content_type: contentType,
              author: parseAuthor(post, userCache),
              published_at: post.date || '',
              modified_at: post.modified || '',
              section,
              categories: parseCategories(post, catCache),
              tags: parseTags(post, tagCache),
              subscription_required: parseSubscriptionRequired(post),
              stream_video_id: parseStreamVideoId(post),
            });
            ids.push(post.id);
            const wIds = parseWriterIds(post);
            if (wIds.length > 0) writerIdsByPost.set(post.id, wIds);
            const mediaId = parseFeaturedMediaId(post);
            if (mediaId) featuredMediaByPost.set(post.id, mediaId);
          }
        })();

        totalMeta += posts.length;
        console.log(`[WP] ${type} metadata page ${page}/${totalPages}: ${posts.length} items`);
        page++;
        if (page <= totalPages) await sleep(PAGE_DELAY_MS);
      } catch (err) {
        console.error(`[WP] Error fetching ${type} metadata page ${page}:`, err.message);
        errors.push({ type, page, error: err.message });
        break;
      }
    }

    if (ids.length > 0) typeToIds.set(type, ids);
  }

  console.log(`[WP] Pass 1 complete: ${totalMeta} metadata records.`);

  // PASS 1.5: resolve writer (byline) names and update content rows.
  // Done separately so the small acf.writers payload stays light and a failed
  // writer fetch never overwrites existing names.
  if (writerIdsByPost.size > 0) {
    const allIds = [];
    for (const ids of writerIdsByPost.values()) allIds.push(...ids);
    const writerCache = await fetchWriterNames(allIds);
    const updateWriter = db.prepare('UPDATE content SET writer = ? WHERE wp_id = ?');
    let writerUpdates = 0;
    db.transaction(() => {
      for (const [wpId, ids] of writerIdsByPost) {
        const names = ids.map(id => writerCache.get(id)).filter(Boolean).join(', ');
        if (names) { updateWriter.run(names, wpId); writerUpdates++; }
      }
    })();
    console.log(`[WP] Resolved writers for ${writerUpdates} posts (${writerCache.size} unique names).`);
  }

  // PASS 1.6: resolve featured-image URLs and update content rows. Same
  // isolated-pass reasoning as writers above — a failed media fetch never
  // wipes an existing cover_image_url.
  if (featuredMediaByPost.size > 0) {
    const mediaCache = await fetchMediaUrls([...featuredMediaByPost.values()]);
    const updateCover = db.prepare('UPDATE content SET cover_image_url = ? WHERE wp_id = ?');
    let coverUpdates = 0;
    db.transaction(() => {
      for (const [wpId, mediaId] of featuredMediaByPost) {
        const src = mediaCache.get(mediaId);
        if (src) { updateCover.run(src, wpId); coverUpdates++; }
      }
    })();
    console.log(`[WP] Resolved cover images for ${coverUpdates} posts (${mediaCache.size} unique images).`);
  }

  console.log('[WP] Starting content fetch...');

  // PASS 2: fetch content for all synced IDs in small batches
  // Small batches (10) keep each response under ~220KB even for long-form articles
  const updateContent = db.prepare(`
    UPDATE content SET content_text = ? WHERE wp_id = ?
  `);

  let totalContent = 0;

  for (const [type, ids] of typeToIds) {
    for (let i = 0; i < ids.length; i += CONTENT_BATCH_SIZE) {
      const batch = ids.slice(i, i + CONTENT_BATCH_SIZE);
      const contentMap = await fetchContentBatch(type, batch);

      db.transaction(() => {
        for (const [wpId, text] of contentMap) {
          updateContent.run(text, wpId);
          totalContent++;
        }
      })();

      const done = Math.min(i + CONTENT_BATCH_SIZE, ids.length);
      console.log(`[WP] ${type} content: ${done}/${ids.length}`);
      if (i + CONTENT_BATCH_SIZE < ids.length) await sleep(PAGE_DELAY_MS);
    }
  }

  // Only advance the incremental-sync watermark on a clean run. If any content
  // type errored out mid-pagination, its unfetched pages must not be permanently
  // skipped — leaving `last_wp_sync` unchanged means the next run retries the
  // same modified_after window instead of silently moving past the gap.
  if (full) {
    console.log('[WP] Full/typed backfill — leaving last_wp_sync unchanged.');
  } else if (errors.length === 0) {
    setSyncState('last_wp_sync', now);
  } else {
    console.warn(`[WP] ${errors.length} error(s) during sync — leaving last_wp_sync at ${lastSync || '(none)'} so the next run retries this window.`);
  }
  console.log(`[WP] Sync complete. ${totalMeta} metadata, ${totalContent} content bodies. ${errors.length} errors.`);
  return { synced: totalMeta, errors };
}
