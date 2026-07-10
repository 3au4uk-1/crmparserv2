import { Router } from 'express';
import { getDb } from '../db/connection.js';
import {
  loadPodryadList,
  createPodryadEntry,
  deletePodryadEntry,
} from '../services/podryad.js';
import { scheduleListChangeResync } from '../services/list-change-resync.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDb();
  res.json({ items: loadPodryadList(db) });
});

router.post('/', (req, res) => {
  const { pattern, matchType, sourceName } = req.body ?? {};
  try {
    const db = getDb();
    const item = createPodryadEntry(db, { pattern, matchType, sourceName });
    scheduleListChangeResync();
    res.status(201).json({ item });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const db = getDb();
    deletePodryadEntry(db, Number(req.params.id));
    scheduleListChangeResync();
    res.json({ success: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

export default router;
