import { Router } from 'express';
import { getDb } from '../db/connection.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDb();
  const { limit = 100, offset = 0 } = req.query;
  const runs = db.prepare(
    'SELECT * FROM parse_runs ORDER BY started_at DESC LIMIT ? OFFSET ?'
  ).all(limit, offset);
  const total = db.prepare('SELECT COUNT(*) as count FROM parse_runs').get();
  res.json({ logs: runs, total: total.count });
});

export default router;
