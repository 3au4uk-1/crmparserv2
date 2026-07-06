import { Router } from 'express';
import { getDb } from '../db/connection.js';
import {
  loadBannerList,
  createBannerEntry,
  deleteBannerEntry,
} from '../services/banner.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDb();
  res.json({ items: loadBannerList(db) });
});

router.post('/', (req, res) => {
  const { pattern, matchType, sourceName } = req.body ?? {};
  try {
    const db = getDb();
    const item = createBannerEntry(db, { pattern, matchType, sourceName });
    res.status(201).json({ item });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const db = getDb();
    deleteBannerEntry(db, Number(req.params.id));
    res.json({ success: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

export default router;
