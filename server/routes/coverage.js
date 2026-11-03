import { Router } from 'express';
import { getDb, logAudit } from '../db.js';
import { requireAdmin } from '../auth.js';
import { mondayConfigured, BOARD_ID } from '../coverage/monday.js';
import { getAudienceContext, saveAudienceContext, AUDIENCE_MAX_CHARS } from '../coverage/audience.js';
import { runCoverageReport, getRunStatus, isRunning, currentWeekStart, isMonday } from '../coverage/report.js';

const router = Router();

// GET/PUT /api/coverage/audience — the audience description the report uses
// (internal strategy text, so admin-only; see coverage/audience.js).
router.get('/audience', requireAdmin, (req, res) => {
  res.json({ text: getAudienceContext(), maxChars: AUDIENCE_MAX_CHARS });
});

router.put('/audience', requireAdmin, (req, res) => {
  const text = typeof req.body?.text === 'string' ? req.body.text.trim() : null;
  if (text === null) return res.status(400).json({ error: 'text is required' });
  if (text.length > AUDIENCE_MAX_CHARS) return res.status(400).json({ error: `Too long (max ${AUDIENCE_MAX_CHARS} characters)` });
  saveAudienceContext(text);
  logAudit(req.auth?.user || 'unknown', 'update_audience_context', { chars: text.length });
  res.json({ text, maxChars: AUDIENCE_MAX_CHARS });
});

// GET /api/coverage?week=YYYY-MM-DD
// The stored report for that week (default: this week's, else the most recent
// one), plus everything the page needs to render around it: the list of weeks
// that have a report, whether a run is in flight, and whether the integrations
// are configured.
router.get('/', (req, res) => {
  const db = getDb();
  const weeks = db.prepare('SELECT week_start AS weekStart, generated_at AS generatedAt FROM coverage_reports ORDER BY week_start DESC LIMIT 26').all();
  const thisWeek = currentWeekStart();

  const requested = typeof req.query.week === 'string' ? req.query.week : null;
  const pick = requested || (weeks.find(w => w.weekStart === thisWeek) ? thisWeek : weeks[0]?.weekStart);
  const row = pick ? db.prepare('SELECT report_json FROM coverage_reports WHERE week_start = ?').get(pick) : null;

  res.json({
    report: row ? JSON.parse(row.report_json) : null,
    weeks,
    thisWeek,
    run: getRunStatus(),
    configured: {
      monday: mondayConfigured(),
      anthropic: !!process.env.ANTHROPIC_API_KEY,
      boardUrl: `https://dmagazine-company.monday.com/boards/${BOARD_ID}`,
    },
  });
});

// POST /api/coverage/run  { weekStart?: 'YYYY-MM-DD' (a Monday) }
// Admin only. Generation takes about a minute (it refreshes competitor
// headlines, reads the Monday board, then runs the analysis), so this answers
// right away and the page polls GET / for the run status.
router.post('/run', requireAdmin, (req, res) => {
  const weekStart = req.body?.weekStart || currentWeekStart();
  if (!isMonday(weekStart)) return res.status(400).json({ error: 'weekStart must be a Monday (YYYY-MM-DD)' });
  if (!mondayConfigured()) return res.status(400).json({ error: 'MONDAY_API_TOKEN is not set on the server' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(400).json({ error: 'ANTHROPIC_API_KEY is not set on the server' });
  if (isRunning()) return res.status(409).json({ error: 'A coverage report is already being generated' });

  logAudit(req.auth?.user || 'unknown', 'run_coverage_report', { weekStart });
  runCoverageReport({ weekStart }).catch(() => { /* status + log written by runCoverageReport */ });
  res.status(202).json({ started: true, weekStart });
});

export default router;
