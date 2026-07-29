import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { createTipRule, deleteTipRule, loadTipRules } from '../services/tip-rules.js';
import { scheduleListChangeResync } from '../services/list-change-resync.js';

const router = Router();

router.get('/', (req, res) => {
  res.json({ items: loadTipRules(getDb(), req.query.tip) });
});

router.post('/', (req, res) => {
  try {
    const item = createTipRule(getDb(), req.body ?? {});
    scheduleListChangeResync();
    res.status(201).json({ item });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    deleteTipRule(getDb(), Number(req.params.id));
    scheduleListChangeResync();
    res.json({ success: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

export default router;
