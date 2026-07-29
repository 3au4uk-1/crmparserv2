import { Router } from 'express';
import { getDb } from '../db/connection.js';
import {
  loadNeNasheBrandingList,
  createNeNasheBrandingEntry,
  deleteNeNasheBrandingEntry,
} from '../services/ne-nashe-branding.js';
import { scheduleListChangeResync } from '../services/list-change-resync.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDb();
  res.json({ items: loadNeNasheBrandingList(db) });
});

router.post('/', (req, res) => {
  const { pattern, matchType, sourceName } = req.body ?? {};
  try {
    const db = getDb();
    const item = createNeNasheBrandingEntry(db, { pattern, matchType, sourceName });
    scheduleListChangeResync();
    res.status(201).json({ item });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const db = getDb();
    deleteNeNasheBrandingEntry(db, Number(req.params.id));
    scheduleListChangeResync();
    res.json({ success: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

export default router;
