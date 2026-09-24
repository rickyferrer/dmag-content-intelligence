// Cloudflare Stream sync — pulls minutes viewed per video per day from
// Cloudflare's GraphQL Analytics API into video_minutes_daily. Videos are
// paired to content via content.stream_video_id (the post's
// acf.stream_video_id, captured by the WordPress sync), so this module never
// has to search WordPress for a video's UID.
//
// Needs CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN — an Account API Token
// with the "Stream:Read" permission (Cloudflare dashboard → Manage Account →
// API Tokens).
import { getDb, setSyncState } from '../db.js';

const GRAPHQL_URL = 'https://api.cloudflare.com/client/v4/graphql';

// Rows in video_minutes_daily are never pruned — every synced day is kept
// permanently, so history keeps accumulating past what Cloudflare itself will
// serve (it rejects queries for data older than 13 weeks + 1 day, ~92 days).
//
// First run (nothing stored yet) backfills as far as Cloudflare allows.
// After that each run resumes from the latest stored day, re-fetching a
// trailing overlap because the most recent days can still be revised as
// Cloudflare finishes processing them. Resuming from the latest stored day
// (rather than a fixed window) means an outage of a few days or weeks doesn't
// leave a permanent gap — capped at the backfill limit, beyond which the data
// is no longer retrievable.
const MAX_LOOKBACK_DAYS = 90;
const OVERLAP_DAYS = 14;
// One request per window keeps every response well under the row limit
// (~85 videos × 30 days) and inside Cloudflare's per-query date-range caps.
const WINDOW_DAYS = 30;
const ROW_LIMIT = 10000;

const QUERY = `
  query StreamMinutesByVideoDay($accountTag: string!, $start: Date!, $end: Date!, $limit: uint64!) {
    viewer {
      accounts(filter: { accountTag: $accountTag }) {
        streamMinutesViewedAdaptiveGroups(
          filter: { date_geq: $start, date_leq: $end }
          orderBy: [date_ASC]
          limit: $limit
        ) {
          sum { minutesViewed }
          dimensions { uid date }
        }
      }
    }
  }
`;

function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}

function addDays(d, n) {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

async function fetchWindow(accountId, token, start, end) {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: QUERY,
      variables: { accountTag: accountId, start, end, limit: ROW_LIMIT },
    }),
  });
  if (!res.ok) throw new Error(`Cloudflare GraphQL HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(`Cloudflare GraphQL error: ${json.errors.map(e => e.message).join('; ')}`);
  }
  const groups = json.data?.viewer?.accounts?.[0]?.streamMinutesViewedAdaptiveGroups || [];
  if (groups.length >= ROW_LIMIT) {
    console.warn(`[Cloudflare] ${start}→${end} returned ${groups.length} rows (the limit) — results may be truncated`);
  }
  return groups.map(g => ({
    uid: g.dimensions.uid,
    date: g.dimensions.date,
    minutes: g.sum?.minutesViewed || 0,
  }));
}

export async function syncCloudflareStream({ lookbackDays } = {}) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !token) {
    throw new Error('CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN must both be set');
  }

  const db = getDb();
  const today = new Date();
  const latest = db.prepare('SELECT MAX(date) AS d FROM video_minutes_daily').get().d;
  let from;
  if (lookbackDays != null) {
    from = addDays(today, -lookbackDays);
  } else if (latest) {
    const resume = addDays(new Date(latest + 'T00:00:00Z'), -OVERLAP_DAYS);
    from = new Date(Math.max(addDays(today, -MAX_LOOKBACK_DAYS).getTime(), Math.min(resume.getTime(), addDays(today, -OVERLAP_DAYS).getTime())));
  } else {
    from = addDays(today, -MAX_LOOKBACK_DAYS);
  }
  console.log(`[Cloudflare] Syncing Stream minutes viewed ${fmtDate(from)} → ${fmtDate(today)}`);

  // Upsert — re-fetched days overwrite what's stored, so revisions are picked up.
  const upsert = db.prepare(`
    INSERT INTO video_minutes_daily (stream_video_id, date, minutes_viewed)
    VALUES (@uid, @date, @minutes)
    ON CONFLICT(stream_video_id, date) DO UPDATE SET minutes_viewed = excluded.minutes_viewed
  `);

  let rows = 0;
  for (let start = from; start <= today; start = addDays(start, WINDOW_DAYS)) {
    const end = new Date(Math.min(addDays(start, WINDOW_DAYS - 1).getTime(), today.getTime()));
    const groups = await fetchWindow(accountId, token, fmtDate(start), fmtDate(end));
    db.transaction(() => { for (const g of groups) upsert.run(g); })();
    rows += groups.length;
  }

  setSyncState('last_cloudflare_sync', new Date().toISOString());

  // Videos Cloudflare reports on that no post points at — usually deleted or
  // unpublished posts, or a UID that was replaced on its post.
  const unmatched = db.prepare(`
    SELECT COUNT(DISTINCT v.stream_video_id) AS n
    FROM video_minutes_daily v
    LEFT JOIN content c ON c.stream_video_id = v.stream_video_id
    WHERE c.wp_id IS NULL
  `).get().n;
  console.log(`[Cloudflare] Sync complete. ${rows} video-day rows; ${unmatched} video(s) with no matching post.`);
  return { synced: rows, unmatchedVideos: unmatched };
}
