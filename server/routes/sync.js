import { Router } from 'express';
import { getSyncStatus, runContentSync, runStreamSync, runAnalyticsSync, runClassification, runCategoryClassification, runVoiceClassification } from '../sync/scheduler.js';
import { logAudit } from '../db.js';
import { requireAdmin } from '../auth.js';

const router = Router();

// GET /api/sync/status
router.get('/status', (req, res) => {
  const status = getSyncStatus();
  res.json(status);
});

// POST /api/sync/trigger
router.post('/trigger', requireAdmin, async (req, res) => {
  const { type = 'all' } = req.body || {};

  logAudit(req.auth?.user || 'unknown', 'trigger_sync', { type });
  res.json({ message: `Sync triggered: ${type}` });

  // Run in background after response — sequential when 'all' so analytics
  // waits for content to be in the DB before it tries to match URLs
  const runAll = async () => {
    if (type === 'content' || type === 'all') {
      await runContentSync().catch(err => console.error('[Sync API] Content sync error:', err.message));
    }
    if (type === 'stream' || type === 'all') {
      await runStreamSync().catch(err => console.error('[Sync API] Cloudflare Stream sync error:', err.message));
    }
    if (type === 'analytics' || type === 'all') {
      await runAnalyticsSync().catch(err => console.error('[Sync API] Analytics sync error:', err.message));
    }
    if (type === 'classify' || type === 'all') {
      await runClassification().catch(err => console.error('[Sync API] Classification error:', err.message));
      await runCategoryClassification().catch(err => console.error('[Sync API] Category classification error:', err.message));
      await runVoiceClassification().catch(err => console.error('[Sync API] Voice classification error:', err.message));
    }
  };
  runAll();
});

export default router;
