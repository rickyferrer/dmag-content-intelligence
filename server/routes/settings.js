import { Router } from 'express';
import { getSettings, updateSettings, getDb, logAudit, getAuditLog } from '../db.js';
import { scoreContent, pruneSnapshots, runBenchmarkCheckIfDue } from '../sync/scheduler.js';
import { BENCHMARK_META } from '../utils/trueValue.js';

const router = Router();

// req.auth is set by express-basic-auth after a successful admin challenge —
// this route tree is always mounted behind adminAuth (see server/index.js).
const actorOf = (req) => req.auth?.user || 'unknown';

// GET /api/settings
router.get('/', (req, res) => {
  const settings = getSettings();
  res.json(settings);
});

// PUT /api/settings
router.put('/', (req, res) => {
  const allowed = [
    'score_w_subscription',
    'score_w_loyal',
    'score_w_inmarket',
    'score_w_newsletter',
    'score_w_engagement',
    'score_w_ad_revenue',
    'score_confidence_k',
    ...Object.values(BENCHMARK_META).map(m => m.settingKey),
  ];

  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      const val = parseFloat(req.body[key]);
      if (!isNaN(val) && val >= 0) updates[key] = val;
    }
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No valid settings provided' });
  }

  updateSettings(updates);
  logAudit(actorOf(req), 'update_settings', updates);
  res.json({ success: true, settings: getSettings() });
});

// POST /api/settings/recalculate
router.post('/recalculate', (req, res) => {
  const db = getDb();
  const settings = getSettings();

  logAudit(actorOf(req), 'recalculate_scores', {});
  res.json({ message: 'Recalculating Content Value scores in background' });

  // Recompute 1-100 scores from stored signal values using current weights.
  // No re-fetch from GA4/Marfeel needed — signals are already in the DB.
  setImmediate(() => {
    try {
      scoreContent(db);
      console.log('[Settings] Recalculation complete');
    } catch (err) {
      console.error('[Settings] Recalculation error:', err.message);
    }
  });
});

// GET /api/settings/benchmark-checks
// Pending (not dismissed, not applied) Content Value benchmark recommendations
// from the last 30-day recalibration check — see utils/benchmarkCheck.js.
// Also reports when the check itself last ran (sync_state), independent of
// whether it found anything to flag.
router.get('/benchmark-checks', (req, res) => {
  const db = getDb();
  const pending = db.prepare(`
    SELECT * FROM benchmark_checks
    WHERE dismissed = 0 AND applied_at IS NULL
    ORDER BY checked_at DESC
  `).all();
  const lastChecked = db.prepare("SELECT value FROM sync_state WHERE key = 'last_benchmark_check'").get();
  res.json({ pending, last_checked: lastChecked?.value || null });
});

// POST /api/settings/benchmark-checks/run — manual trigger, bypasses the
// 30-day gate (same "run it now instead of waiting" role as Recalculate All
// Scores has for scoreContent()).
router.post('/benchmark-checks/run', (req, res) => {
  logAudit(actorOf(req), 'run_benchmark_check', {});
  try {
    const flagged = runBenchmarkCheckIfDue(true);
    res.json({ flagged });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/settings/benchmark-checks/:id/apply — writes the recommended
// value into the live setting and marks this recommendation applied. Does
// NOT re-run Recalculate All Scores automatically — same reasoning as every
// other settings change here, the admin should see the settings update
// succeed before kicking off a full rescore.
router.post('/benchmark-checks/:id/apply', (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id);
  const row = db.prepare('SELECT * FROM benchmark_checks WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  if (row.applied_at) return res.status(400).json({ error: 'Already applied' });

  const meta = BENCHMARK_META[row.benchmark_key];
  if (!meta) return res.status(400).json({ error: `Unknown benchmark_key: ${row.benchmark_key}` });

  updateSettings({ [meta.settingKey]: row.recommended_value });
  db.prepare('UPDATE benchmark_checks SET applied_at = datetime(\'now\'), applied_by = ? WHERE id = ?')
    .run(actorOf(req), id);
  logAudit(actorOf(req), 'apply_benchmark_recommendation', {
    benchmark_key: row.benchmark_key, from: row.current_value, to: row.recommended_value,
  });
  res.json({ success: true, settings: getSettings() });
});

// POST /api/settings/benchmark-checks/:id/dismiss — reviewed, deliberately
// not applying it (e.g. the change looked like a one-off spike, not a real
// shift). Distinct from apply: nothing about the live settings changes.
router.post('/benchmark-checks/:id/dismiss', (req, res) => {
  const db = getDb();
  const id = parseInt(req.params.id);
  const result = db.prepare('UPDATE benchmark_checks SET dismissed = 1 WHERE id = ? AND applied_at IS NULL').run(id);
  if (result.changes === 0) return res.status(404).json({ error: 'Not found or already applied' });
  logAudit(actorOf(req), 'dismiss_benchmark_recommendation', { id });
  res.json({ success: true });
});

// GET /api/settings/exclusions — list all excluded content items
router.get('/exclusions', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT wp_id, title, url, content_type, section
    FROM content
    WHERE excluded_from_scoring = 1
    ORDER BY url
  `).all();
  res.json(rows);
});

// POST /api/settings/exclusions — replace the exclusion list with a set of URLs
// Body: { urls: ["https://...", "https://..."] }
// Returns which URLs were matched/unmatched so the user can verify.
router.post('/exclusions', (req, res) => {
  const db = getDb();
  const urls = (req.body?.urls || []).map(u => u.trim()).filter(Boolean);

  // Clear all existing exclusions
  db.prepare('UPDATE content SET excluded_from_scoring = 0').run();

  if (urls.length === 0) {
    return res.json({ matched: [], unmatched: [] });
  }

  const matched = [];
  const unmatched = [];

  const findByUrl = db.prepare('SELECT wp_id, title, url FROM content WHERE url = ? LIMIT 1');
  const exclude   = db.prepare('UPDATE content SET excluded_from_scoring = 1 WHERE wp_id = ?');

  for (const url of urls) {
    // Try exact match, then with/without trailing slash
    const alt = url.endsWith('/') ? url.slice(0, -1) : url + '/';
    const row = findByUrl.get(url) || findByUrl.get(alt);
    if (row) {
      exclude.run(row.wp_id);
      matched.push({ url: row.url, title: row.title });
    } else {
      unmatched.push(url);
    }
  }

  console.log(`[Settings] Exclusions updated: ${matched.length} matched, ${unmatched.length} not found`);
  logAudit(actorOf(req), 'update_exclusions', { matched: matched.length, unmatched: unmatched.length });
  res.json({ matched, unmatched });
});

// POST /api/settings/cleanup
// Deletes content older than `years` years (default 2) and all their snapshots,
// then prunes excess snapshots (keeps last 30 per content item).
//
// Irreversibly deletes data, so — beyond the frontend's type-to-confirm UI —
// this also requires an explicit { confirm: "DELETE" } in the request body.
// That's enforced here, not just in the UI, so a direct API call (a stray
// script, a replay, anything bypassing the modal) can't trigger it by accident.
router.post('/cleanup', (req, res) => {
  if (req.body?.confirm !== 'DELETE') {
    return res.status(400).json({ error: 'Confirmation required — pass { confirm: "DELETE" } to proceed with this destructive operation.' });
  }

  const db = getDb();
  const years = Math.max(1, parseInt(req.body?.years || 2, 10));

  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - years);
  const cutoffIso = cutoff.toISOString().slice(0, 10); // YYYY-MM-DD

  try {
    // 1. Delete snapshots for old content (must go first — FK reference)
    const snapshotResult = db.prepare(`
      DELETE FROM analytics_snapshots
      WHERE wp_id IN (SELECT wp_id FROM content WHERE published_at < ?)
    `).run(cutoffIso);

    // 2. Delete the old content rows
    const contentResult = db.prepare(
      `DELETE FROM content WHERE published_at < ?`
    ).run(cutoffIso);

    // 3. Prune excess snapshots for remaining content (keep last 30)
    pruneSnapshots(db, 30);

    // 4. Report remaining counts
    const remainingContent = db.prepare('SELECT COUNT(*) as n FROM content').get().n;
    const remainingSnapshots = db.prepare('SELECT COUNT(*) as n FROM analytics_snapshots').get().n;

    console.log(`[Settings] Cleanup: deleted ${contentResult.changes} content rows and ${snapshotResult.changes} snapshots older than ${cutoffIso}`);
    logAudit(actorOf(req), 'cleanup_data', {
      years, cutoff: cutoffIso,
      contentDeleted: contentResult.changes,
      snapshotsDeleted: snapshotResult.changes,
    });

    res.json({
      cutoff: cutoffIso,
      contentDeleted: contentResult.changes,
      snapshotsDeleted: snapshotResult.changes,
      remainingContent,
      remainingSnapshots,
    });
  } catch (err) {
    console.error('[Settings] Cleanup error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/settings/audit-log — recent admin actions (who, what, when)
router.get('/audit-log', (req, res) => {
  res.json(getAuditLog(100));
});

export default router;
