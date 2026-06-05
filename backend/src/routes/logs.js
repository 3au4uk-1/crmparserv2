import { Router } from 'express';
import { getDb } from '../db/connection.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDb();
  const { limit = 100, offset = 0, type = 'parse' } = req.query;

  if (type === 'sync') {
    const runs = db.prepare(`
      SELECT sr.*, d.title as deal_title
      FROM sync_runs sr
      LEFT JOIN deals d ON d.id = sr.deal_id
      ORDER BY sr.created_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);
    const total = db.prepare('SELECT COUNT(*) as count FROM sync_runs').get();
    return res.json({ logs: runs, total: total.count, type: 'sync' });
  }

  const runs = db.prepare(
    'SELECT * FROM parse_runs ORDER BY started_at DESC LIMIT ? OFFSET ?'
  ).all(limit, offset);
  const total = db.prepare('SELECT COUNT(*) as count FROM parse_runs').get();
  res.json({ logs: runs, total: total.count, type: 'parse' });
});

export default router;
