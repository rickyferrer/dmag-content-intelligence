import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { editorialBrief } from '../server/utils/editorialBrief.js';

function fixture() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE content (wp_id INTEGER PRIMARY KEY, title TEXT, url TEXT, writer TEXT,
      section TEXT, published_at TEXT, user_need TEXT, publication_override TEXT);
    CREATE TABLE analytics_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, wp_id INTEGER,
      snapshot_at TEXT, true_value REAL, lifetime_value REAL, ga4_pageviews INTEGER,
      ga4_users INTEGER, ga4_loyal_users INTEGER, ga4_avg_engagement_time REAL,
      ga4_subscribe_clicks INTEGER, mf_newsletter_signups INTEGER);
    INSERT INTO content VALUES
      (1,'First','https://example.com/publications/d-magazine/2026/nov/first','Writer A','Food & Drink','2026-11-03T08:00:00','educate_me',NULL),
      (2,'Second','https://example.com/publications/d-magazine/2026/nov/second','Writer B','Food & Drink','2026-11-05T09:00:00','update_me',NULL),
      (3,'Older','https://example.com/publications/d-ceo/2025/nov/older','Writer A','Business','2025-11-05T09:00:00','educate_me',NULL),
      (4,'Override','https://example.com/guide/override','Writer A','Food & Drink','2026-11-06T09:00:00','educate_me','d-magazine/2026/november');
    INSERT INTO analytics_snapshots (wp_id,snapshot_at,true_value,lifetime_value,ga4_pageviews,ga4_users,ga4_loyal_users,ga4_avg_engagement_time,ga4_subscribe_clicks,mf_newsletter_signups) VALUES
      (1,'2026-11-10',10,40,70,40,9,20,2,1),
      (1,'2026-11-15',80,90,400,200,40,45,12,6),
      (2,'2026-11-15',50,60,250,190,20,35,7,3),
      (3,'2026-11-15',99,100,800,500,70,50,20,15),
      (4,'2026-11-16',40,40,150,100,12,25,1,2);
  `);
  return db;
}

test('ranks latest snapshot, filters publication date and reports freshness', () => {
  const db = fixture();
  try {
    const r = editorialBrief(db, { dateFrom:'2026-11-01', dateTo:'2026-11-15', section:'Food & Drink' }, new Date('2026-11-16T00:00:00Z'));
    assert.equal(r.articleCount, 3);
    assert.equal(r.topArticles[0].title, 'First');
    assert.equal(r.topArticles[0].rolling_content_value, 80);
    assert.equal(r.topArticles[0].rolling_pageviews, 400);
    assert.equal(r.newestSnapshot, '2026-11-16');
    assert.equal(r.filters.sortBy, 'content_value');
  } finally { db.close(); }
});
test('supports publication overrides and a whitelisted sort', () => {
  const db = fixture();
  try {
    const r = editorialBrief(db, { dateFrom:'2026-11-01', dateTo:'2026-11-15',
      publication:'d-magazine', sortBy:'newsletter_signups' }, new Date('2026-11-16T00:00:00Z'));
    assert.equal(r.articleCount, 3);
    assert.deepEqual(r.topArticles.map(a => a.title), ['First','Second','Override']);
  } finally { db.close(); }
});
test('rejects invalid date windows, sorting and filters', () => {
  const db = fixture();
  try {
    assert.throws(() => editorialBrief(db, {dateFrom:'2026-11-31',dateTo:'2026-12-01'}), /valid dateFrom/);
    assert.throws(() => editorialBrief(db, {dateFrom:'2026-12-01',dateTo:'2026-11-01'}), /valid dateFrom/);
    assert.throws(() => editorialBrief(db, {sortBy:'(SELECT * FROM sync_state)'}), /Unknown sort/);
    assert.throws(() => editorialBrief(db, {section:'X'.repeat(300)}), /too long/);
    assert.throws(() => editorialBrief(db, {publication:'fake'}), /Unknown publication/);
  } finally { db.close(); }
});
test('never presents article users as sitewide unique users', () => {
  const db = fixture();
  try {
    const r = editorialBrief(db, {dateFrom:'2026-11-01',dateTo:'2026-11-15'});
    assert.ok(r.metricNotes.some(s => s.includes('never sum')));
    assert.equal('totalUniqueUsers' in r, false);
  } finally { db.close(); }
});
