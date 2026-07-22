import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'content.db');

let db;

export function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initSchema();
  }
  return db;
}

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS content (
      id INTEGER PRIMARY KEY,
      wp_id INTEGER UNIQUE,
      slug TEXT,
      url TEXT,
      title TEXT,
      content_text TEXT,
      content_type TEXT,
      author TEXT,
      published_at TEXT,
      modified_at TEXT,
      section TEXT,
      categories TEXT,
      tags TEXT,
      subscription_required INTEGER DEFAULT 0,
      user_need TEXT,
      user_need_secondary TEXT,
      user_need_confidence REAL,
      user_need_rationale TEXT,
      classified_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS analytics_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      wp_id INTEGER,
      snapshot_at TEXT,
      ga4_pageviews INTEGER,
      ga4_users INTEGER,
      ga4_loyal_users INTEGER,
      ga4_inmarket_pageviews INTEGER,
      ga4_loyal_inmarket_pv INTEGER,
      ga4_avg_engagement_time REAL,
      ga4_sessions INTEGER,
      ga4_subscribe_clicks INTEGER,
      ga4_email_signups INTEGER,
      ga4_ad_revenue REAL,
      mf_unique_users INTEGER,
      mf_pageviews INTEGER,
      mf_loyal_users INTEGER,
      mf_scroll_depth REAL,
      mf_recirculation_rate REAL,
      true_value REAL,
      FOREIGN KEY (wp_id) REFERENCES content(wp_id)
    );

    CREATE TABLE IF NOT EXISTS sync_state (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_content_wp_id ON content(wp_id);
    CREATE INDEX IF NOT EXISTS idx_content_type ON content(content_type);
    CREATE INDEX IF NOT EXISTS idx_content_section ON content(section);
    CREATE INDEX IF NOT EXISTS idx_content_user_need ON content(user_need);
    CREATE INDEX IF NOT EXISTS idx_content_published ON content(published_at);
    CREATE INDEX IF NOT EXISTS idx_snapshots_wp_id ON analytics_snapshots(wp_id);
    CREATE INDEX IF NOT EXISTS idx_snapshots_at ON analytics_snapshots(snapshot_at);

    CREATE TABLE IF NOT EXISTS content_sources (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      wp_id       INTEGER,
      snapshot_at TEXT,
      source      TEXT,
      pageviews   INTEGER DEFAULT 0,
      FOREIGN KEY (wp_id) REFERENCES content(wp_id)
    );
    CREATE INDEX IF NOT EXISTS idx_sources_wp_snap ON content_sources(wp_id, snapshot_at);
    CREATE INDEX IF NOT EXISTS idx_sources_snap     ON content_sources(snapshot_at);
    CREATE INDEX IF NOT EXISTS idx_sources_source   ON content_sources(source);

    CREATE TABLE IF NOT EXISTS source_performance (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_at         TEXT,
      channel             TEXT,
      users               INTEGER DEFAULT 0,
      sessions            INTEGER DEFAULT 0,
      subscribe_clicks    INTEGER DEFAULT 0,
      avg_engagement_time REAL    DEFAULT 0,
      ad_revenue          REAL    DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_srcperf_snap ON source_performance(snapshot_at);

    CREATE TABLE IF NOT EXISTS gsc_queries (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      wp_id       INTEGER,
      snapshot_at TEXT,
      query       TEXT,
      clicks      INTEGER DEFAULT 0,
      impressions INTEGER DEFAULT 0,
      ctr         REAL    DEFAULT 0,
      position    REAL    DEFAULT 0,
      FOREIGN KEY (wp_id) REFERENCES content(wp_id)
    );
    CREATE INDEX IF NOT EXISTS idx_gsc_wp_snap ON gsc_queries(wp_id, snapshot_at);
    CREATE INDEX IF NOT EXISTS idx_gsc_snap     ON gsc_queries(snapshot_at);

    -- Site-wide GA4 traffic by calendar date, independent of which articles
    -- were published that day. Lets date-range filters answer "how much
    -- traffic did the site get in this window" rather than only "how did
    -- articles published in this window perform" (the per-article/
    -- analytics_snapshots approach, which returns 0 for any range with no
    -- new publishes — e.g. a weekend — even though the site still had readers).
    CREATE TABLE IF NOT EXISTS site_daily_metrics (
      date                TEXT PRIMARY KEY,
      users               INTEGER DEFAULT 0,
      loyal_users         INTEGER DEFAULT 0,
      pageviews           INTEGER DEFAULT 0,
      sessions            INTEGER DEFAULT 0,
      subscribe_clicks    INTEGER DEFAULT 0,
      ad_revenue          REAL    DEFAULT 0,
      newsletter_signups  INTEGER DEFAULT 0,
      avg_engagement_time REAL    DEFAULT 0,
      updated_at          TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Records every admin-gated mutation (sync triggers, score recalculation,
    -- scoring exclusion changes, destructive data cleanup, weight edits) —
    -- who (the admin Basic Auth username), what, and when.
    CREATE TABLE IF NOT EXISTS audit_log (
      id      INTEGER PRIMARY KEY AUTOINCREMENT,
      ts      TEXT DEFAULT CURRENT_TIMESTAMP,
      actor   TEXT,
      action  TEXT,
      details TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts);
  `);

  // Schema migrations — safe to run on every startup
  try { db.exec('ALTER TABLE analytics_snapshots ADD COLUMN mf_newsletter_signups INTEGER DEFAULT 0'); } catch {}
  try { db.exec("ALTER TABLE content ADD COLUMN writer TEXT DEFAULT ''"); } catch {}
  try { db.exec('ALTER TABLE content ADD COLUMN excluded_from_scoring INTEGER DEFAULT 0'); } catch {}
  try { db.exec('ALTER TABLE site_daily_metrics ADD COLUMN newsletter_signups INTEGER DEFAULT 0'); } catch {}

  // Seed default scoring weights if not present.
  // The True Value score blends per-reader conversion/quality rates, weighted by
  // strategic priority. Subscriptions matter most; ad revenue (≈ traffic) is minor.
  const weights = {
    score_w_subscription: '40',  // subscribe-click rate per reader (the goal)
    score_w_loyal:        '25',  // loyal in-market share of audience
    score_w_newsletter:   '15',  // newsletter signup rate per reader
    score_w_engagement:   '15',  // reading depth / attention
    score_w_ad_revenue:   '5',   // ad revenue per reader (minor — avoids "just pageviews")
    score_confidence_k:   '100', // readers needed before an article earns full confidence
  };

  const upsertSetting = db.prepare(`
    INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)
  `);
  for (const [key, value] of Object.entries(weights)) {
    upsertSetting.run(key, value);
  }
}

// actor: the admin Basic Auth username (req.auth.user), or 'system' for
// scheduled/cron-triggered actions. details: any JSON-serializable object.
export function logAudit(actor, action, details) {
  const db = getDb();
  db.prepare('INSERT INTO audit_log (actor, action, details) VALUES (?, ?, ?)')
    .run(actor || 'unknown', action, details != null ? JSON.stringify(details) : null);
}

export function getAuditLog(limit = 100) {
  const db = getDb();
  const rows = db.prepare('SELECT id, ts, actor, action, details FROM audit_log ORDER BY id DESC LIMIT ?').all(limit);
  return rows.map(r => ({ ...r, details: r.details ? JSON.parse(r.details) : null }));
}

export function getSyncState(key) {
  const db = getDb();
  const row = db.prepare('SELECT value FROM sync_state WHERE key = ?').get(key);
  return row ? row.value : null;
}

export function setSyncState(key, value) {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO sync_state (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
  `).run(key, value);
}

export function getSettings() {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map(r => [r.key, parseFloat(r.value)]));
}

export function updateSettings(updates) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO settings (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
  `);
  const updateMany = db.transaction((pairs) => {
    for (const [key, value] of pairs) {
      stmt.run(key, String(value));
    }
  });
  updateMany(Object.entries(updates));
}

// Run db init when executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  getDb();
  console.log('Database initialized at', DB_PATH);
  process.exit(0);
}
