import { Router } from 'express';
import { getDb, listGoals, getGoal, createGoal, updateGoal, setGoalArchived, deleteGoal, listGoalHistory, recentGoalHistory } from '../db.js';
import { METRICS, SCOPES, TRAFFIC_SOURCE_CHANNELS, computeGoalProgress, computeGoalTrend, rollForwardIfDue } from '../utils/goals.js';

const router = Router();

// users/loyal_users goals hit GA4 live (see utils/goals.js) — that call can
// fail like any other external request, so this wraps it the same way
// analytics.js's /summary does rather than letting it 500 the whole route.
// Rolling forward first means progress is always computed against the
// goal's CURRENT period for a recurring goal, never a stale closed one.
//
// Embeds the last 6 closed periods for a recurring goal (recent_history) so
// the Goals grid can show a history sparkline on every card without an
// extra request per goal — a one-off goal always gets an empty array (it
// never writes to goal_history in the first place).
async function withProgress(db, goal, userId) {
  const current = await rollForwardIfDue(db, goal, userId);
  const [progress, recent_history] = await Promise.all([
    computeGoalProgress(db, current),
    current.recurrence === 'monthly' ? recentGoalHistory(current.id, userId) : [],
  ]);
  return { ...current, progress, recent_history };
}

function validateGoal(body) {
  const { name, metric, scope_type, scope_value, target, start_date, end_date, recurrence } = body || {};
  if (!name || typeof name !== 'string' || !name.trim()) return 'name is required';
  if (!METRICS[metric]) return `metric must be one of: ${Object.keys(METRICS).join(', ')}`;
  if (!SCOPES[scope_type]) return `scope_type must be one of: ${Object.keys(SCOPES).join(', ')}`;
  if (SCOPES[scope_type].needsValue && !scope_value) return `scope_value is required for scope_type "${scope_type}"`;
  // source_daily (see sync/marfeel.js) only breaks pageviews down by source —
  // no engagement/subscribe-click/etc. per-source data exists to goal against.
  if (scope_type === 'source' && metric !== 'pageviews') return 'Traffic Source goals only support the Pageviews metric';
  if (scope_type === 'source' && scope_value && !TRAFFIC_SOURCE_CHANNELS.some(c => c.key === scope_value)) {
    return `scope_value for "source" must be one of: ${TRAFFIC_SOURCE_CHANNELS.map(c => c.key).join(', ')}`;
  }
  if (typeof target !== 'number' || !(target > 0)) return 'target must be a positive number';
  if (!start_date || !end_date || !/^\d{4}-\d{2}-\d{2}$/.test(start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(end_date)) {
    return 'start_date and end_date must be YYYY-MM-DD';
  }
  if (end_date < start_date) return 'end_date must be on or after start_date';
  if (recurrence !== undefined && recurrence !== 'none' && recurrence !== 'monthly') return 'recurrence must be "none" or "monthly"';
  return null;
}

// GET /api/goals/metrics — catalog for the client's goal-creation form.
// `sources` is the curated channel list (see utils/channels.js) for the
// "Traffic Source" scope's value dropdown — the same handful of named
// channels the Sources tab shows, not source_daily's raw referrer values
// (hundreds of literal domains/app names, unusable in a picker).
router.get('/metrics', (req, res) => {
  res.json({
    metrics: Object.entries(METRICS).map(([key, m]) => ({ key, label: m.label, unit: m.unit, cumulative: m.cumulative })),
    scopes: Object.entries(SCOPES).map(([key, s]) => ({ key, label: s.label, needsValue: s.needsValue })),
    sources: TRAFFIC_SOURCE_CHANNELS,
  });
});

// GET /api/goals
router.get('/', async (req, res) => {
  try {
    const db = getDb();
    const includeArchived = req.query.includeArchived === 'true';
    const goals = await Promise.all(listGoals(req.user.id, includeArchived).map(g => withProgress(db, g, req.user.id)));
    res.json(goals);
  } catch (err) {
    console.error('[Server] GET /api/goals error:', err.message);
    res.status(500).json({ error: 'Failed to load goals', message: err.message });
  }
});

// GET /api/goals/:id
router.get('/:id', async (req, res) => {
  try {
    const db = getDb();
    const goal = getGoal(req.params.id, req.user.id);
    if (!goal) return res.status(404).json({ error: 'Goal not found' });
    // Roll forward once, then compute progress and trend against the SAME
    // (possibly now-current) period — computing trend on the stale goal
    // object would chart the period that just closed instead of this one.
    const current = await rollForwardIfDue(db, goal, req.user.id);
    const [progress, trend] = await Promise.all([computeGoalProgress(db, current), computeGoalTrend(db, current)]);
    res.json({ ...current, progress, trend });
  } catch (err) {
    console.error('[Server] GET /api/goals/:id error:', err.message);
    res.status(500).json({ error: 'Failed to load goal', message: err.message });
  }
});

// GET /api/goals/:id/history — past closed periods of a recurring goal.
router.get('/:id/history', (req, res) => {
  const existing = getGoal(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Goal not found' });
  try {
    res.json(listGoalHistory(req.params.id, req.user.id));
  } catch (err) {
    console.error('[Server] GET /api/goals/:id/history error:', err.message);
    res.status(500).json({ error: 'Failed to load goal history', message: err.message });
  }
});

// POST /api/goals
router.post('/', async (req, res) => {
  const err = validateGoal(req.body);
  if (err) return res.status(400).json({ error: err });
  try {
    const scope = SCOPES[req.body.scope_type];
    const goal = createGoal({
      name: req.body.name.trim(),
      metric: req.body.metric,
      scope_type: req.body.scope_type,
      scope_value: scope.needsValue ? req.body.scope_value : null,
      target: req.body.target,
      start_date: req.body.start_date,
      end_date: req.body.end_date,
      recurrence: req.body.recurrence === 'monthly' ? 'monthly' : 'none',
    }, req.user.id);
    res.status(201).json(await withProgress(getDb(), goal, req.user.id));
  } catch (err2) {
    console.error('[Server] POST /api/goals error:', err2.message);
    res.status(500).json({ error: 'Failed to create goal', message: err2.message });
  }
});

// PUT /api/goals/:id
router.put('/:id', async (req, res) => {
  const existing = getGoal(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Goal not found' });
  const err = validateGoal(req.body);
  if (err) return res.status(400).json({ error: err });
  try {
    const scope = SCOPES[req.body.scope_type];
    const goal = updateGoal(req.params.id, {
      name: req.body.name.trim(),
      metric: req.body.metric,
      scope_type: req.body.scope_type,
      scope_value: scope.needsValue ? req.body.scope_value : null,
      target: req.body.target,
      start_date: req.body.start_date,
      end_date: req.body.end_date,
      recurrence: req.body.recurrence === 'monthly' ? 'monthly' : 'none',
    }, req.user.id);
    res.json(await withProgress(getDb(), goal, req.user.id));
  } catch (err2) {
    console.error('[Server] PUT /api/goals/:id error:', err2.message);
    res.status(500).json({ error: 'Failed to update goal', message: err2.message });
  }
});

// POST /api/goals/:id/archive
router.post('/:id/archive', async (req, res) => {
  const existing = getGoal(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Goal not found' });
  try {
    const goal = setGoalArchived(req.params.id, req.body?.archived !== false, req.user.id);
    res.json(await withProgress(getDb(), goal, req.user.id));
  } catch (err) {
    console.error('[Server] POST /api/goals/:id/archive error:', err.message);
    res.status(500).json({ error: 'Failed to archive goal', message: err.message });
  }
});

// DELETE /api/goals/:id
router.delete('/:id', (req, res) => {
  const existing = getGoal(req.params.id, req.user.id);
  if (!existing) return res.status(404).json({ error: 'Goal not found' });
  deleteGoal(req.params.id, req.user.id);
  res.json({ ok: true });
});

export default router;
