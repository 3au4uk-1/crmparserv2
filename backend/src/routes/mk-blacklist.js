import { Router } from 'express';
import { getDb } from '../db/connection.js';
import {
  loadMkBlacklist,
  createMkBlacklistEntry,
  deleteMkBlacklistEntry,
} from '../services/mk-blacklist.js';
import { scheduleListChangeResync } from '../services/list-change-resync.js';
import { invalidatePatternListsCache } from '../services/pattern-lists-cache.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDb();
  res.json({ items: loadMkBlacklist(db) });
});

router.post('/', (req, res) => {
  const { pattern, matchType, sourceName } = req.body ?? {};
  try {
    const db = getDb();
    const item = createMkBlacklistEntry(db, { pattern, matchType, sourceName });
    invalidatePatternListsCache();
    scheduleListChangeResync();
    res.status(201).json({ item });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const db = getDb();
    deleteMkBlacklistEntry(db, Number(req.params.id));
    invalidatePatternListsCache();
    scheduleListChangeResync();
    res.json({ success: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

export default router;
