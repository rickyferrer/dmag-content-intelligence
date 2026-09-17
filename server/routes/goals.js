import { Router } from 'express';
import { getDb, listGoals, getGoal, createGoal, updateGoal, setGoalArchived, deleteGoal } from '../db.js';
import { METRICS, SCOPES, computeGoalProgress, computeGoalTrend } from '../utils/goals.js';

const router = Router();

function withProgress(db, goal) {
  return { ...goal, progress: computeGoalProgress(db, goal) };
}

function validateGoal(body) {
  const { name, metric, scope_type, scope_value, target, start_date, end_date } = body || {};
  if (!name || typeof name !== 'string' || !name.trim()) return 'name is required';
  if (!METRICS[metric]) return `metric must be one of: ${Object.keys(METRICS).join(', ')}`;
  if (!SCOPES[scope_type]) return `scope_type must be one of: ${Object.keys(SCOPES).join(', ')}`;
  if (SCOPES[scope_type].column && !scope_value) return `scope_value is required for scope_type "${scope_type}"`;
  if (typeof target !== 'number' || !(target > 0)) return 'target must be a positive number';
  if (!start_date || !end_date || !/^\d{4}-\d{2}-\d{2}$/.test(start_date) || !/^\d{4}-\d{2}-\d{2}$/.test(end_date)) {
    return 'start_date and end_date must be YYYY-MM-DD';
  }
  if (end_date < start_date) return 'end_date must be on or after start_date';
  return null;
}

// GET /api/goals/metrics — catalog for the client's goal-creation form.
router.get('/metrics', (req, res) => {
  res.json({
    metrics: Object.entries(METRICS).map(([key, m]) => ({ key, label: m.label, unit: m.unit, cumulative: m.cumulative })),
    scopes: Object.entries(SCOPES).map(([key, s]) => ({ key, label: s.label, needsValue: !!s.column })),
  });
});

// GET /api/goals
router.get('/', (req, res) => {
  const db = getDb();
  const includeArchived = req.query.includeArchived === 'true';
  const goals = listGoals(includeArchived).map(g => withProgress(db, g));
  res.json(goals);
});

// GET /api/goals/:id
router.get('/:id', (req, res) => {
  const db = getDb();
  const goal = getGoal(req.params.id);
  if (!goal) return res.status(404).json({ error: 'Goal not found' });
  res.json({ ...withProgress(db, goal), trend: computeGoalTrend(db, goal) });
});

// POST /api/goals
router.post('/', (req, res) => {
  const err = validateGoal(req.body);
  if (err) return res.status(400).json({ error: err });
  const scope = SCOPES[req.body.scope_type];
  const goal = createGoal({
    name: req.body.name.trim(),
    metric: req.body.metric,
    scope_type: req.body.scope_type,
    scope_value: scope.column ? req.body.scope_value : null,
    target: req.body.target,
    start_date: req.body.start_date,
    end_date: req.body.end_date,
  });
  res.status(201).json(withProgress(getDb(), goal));
});

// PUT /api/goals/:id
router.put('/:id', (req, res) => {
  const existing = getGoal(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Goal not found' });
  const err = validateGoal(req.body);
  if (err) return res.status(400).json({ error: err });
  const scope = SCOPES[req.body.scope_type];
  const goal = updateGoal(req.params.id, {
    name: req.body.name.trim(),
    metric: req.body.metric,
    scope_type: req.body.scope_type,
    scope_value: scope.column ? req.body.scope_value : null,
    target: req.body.target,
    start_date: req.body.start_date,
    end_date: req.body.end_date,
  });
  res.json(withProgress(getDb(), goal));
});

// POST /api/goals/:id/archive
router.post('/:id/archive', (req, res) => {
  const existing = getGoal(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Goal not found' });
  const goal = setGoalArchived(req.params.id, req.body?.archived !== false);
  res.json(withProgress(getDb(), goal));
});

// DELETE /api/goals/:id
router.delete('/:id', (req, res) => {
  const existing = getGoal(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Goal not found' });
  deleteGoal(req.params.id);
  res.json({ ok: true });
});

export default router;
