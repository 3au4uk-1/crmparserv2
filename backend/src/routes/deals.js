import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { syncDealToTwenty, buildSyncPreview, enrichDealItems } from '../services/twenty-sync.js';
import { TWENTY_ELIGIBLE_COUNT_SQL } from '../services/twenty-items.js';

const router = Router();

const VALID_SYNC_OVERRIDES = new Set(['include', 'exclude', null]);

router.get('/', (req, res) => {
  const db = getDb();
  const { status, company, from, to } = req.query;
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);

  let where = '1=1';
  const params = [];

  if (status) { where += ' AND d.approval_status = ?'; params.push(status); }
  if (company) { where += ' AND d.company_code = ?'; params.push(company); }
  if (from) { where += ' AND d.start_date >= ?'; params.push(from); }
  if (to) { where += ' AND d.start_date <= ?'; params.push(to); }

  const deals = db.prepare(`
    SELECT d.*,
      ${TWENTY_ELIGIBLE_COUNT_SQL} as branding_count,
      (SELECT COUNT(*) FROM deal_items WHERE deal_id = d.id) as total_items
    FROM deals d WHERE ${where}
    ORDER BY d.start_date DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const total = db.prepare(`SELECT COUNT(*) as count FROM deals d WHERE ${where}`).get(...params);

  res.json({ deals, total: total.count, limit, offset });
});

router.get('/stats', (req, res) => {
  const db = getDb();
  const stats = {
    total: db.prepare('SELECT COUNT(*) as c FROM deals').get().c,
    pending: db.prepare("SELECT COUNT(*) as c FROM deals WHERE approval_status = 'pending'").get().c,
    approved: db.prepare("SELECT COUNT(*) as c FROM deals WHERE approval_status = 'approved'").get().c,
    synced: db.prepare("SELECT COUNT(*) as c FROM deals WHERE approval_status = 'synced'").get().c,
    rejected: db.prepare("SELECT COUNT(*) as c FROM deals WHERE approval_status = 'rejected'").get().c,
  };
  res.json(stats);
});

router.get('/:id/sync-preview', (req, res, next) => {
  try {
    res.json(buildSyncPreview(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(req.params.id);
  if (!deal) return res.status(404).json({ error: 'Deal not found' });
  const items = db.prepare('SELECT * FROM deal_items WHERE deal_id = ?').all(req.params.id);
  const enrichedItems = enrichDealItems(items);
  res.json({
    ...deal,
    items: enrichedItems,
    twentyEligibleCount: enrichedItems.filter((i) => i.eligibleForTwenty).length,
    totalItems: enrichedItems.length,
  });
});

router.patch('/:id/approve', async (req, res, next) => {
  try {
    const db = getDb();
    const dealId = Number(req.params.id);
    db.prepare(`
      UPDATE deals SET
        approval_status = 'approved',
        twenty_error = NULL,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(dealId);
    const result = await syncDealToTwenty(dealId);
    res.json({ success: true, ...result });
  } catch (err) { next(err); }
});

router.patch('/:id/reject', (req, res) => {
  const db = getDb();
  db.prepare("UPDATE deals SET approval_status = 'rejected', updated_at = datetime('now') WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});

router.post('/bulk-approve', async (req, res, next) => {
  try {
    const { ids } = req.body;
    const results = [];
    for (const id of ids) {
      const db = getDb();
      db.prepare(`
        UPDATE deals SET
          approval_status = 'approved',
          twenty_error = NULL,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(id);
      try {
        const result = await syncDealToTwenty(id);
        results.push({ id, ...result });
      } catch (err) {
        results.push({ id, error: err.message });
      }
    }
    res.json({ results });
  } catch (err) { next(err); }
});

router.post('/bulk-reject', (req, res) => {
  const { ids } = req.body;
  const db = getDb();
  const stmt = db.prepare("UPDATE deals SET approval_status = 'rejected', updated_at = datetime('now') WHERE id = ?");
  for (const id of ids) stmt.run(id);
  res.json({ success: true });
});

router.delete('/rejected', (req, res) => {
  const db = getDb();
  const result = db.prepare("DELETE FROM deals WHERE approval_status = 'rejected'").run();
  res.json({ success: true, deleted: result.changes });
});

router.post('/bulk-delete', (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids array required' });
  }

  const db = getDb();
  const stmt = db.prepare("DELETE FROM deals WHERE id = ? AND approval_status = 'rejected'");
  let deleted = 0;
  for (const id of ids) {
    deleted += stmt.run(id).changes;
  }
  res.json({ success: true, deleted });
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  const deal = db.prepare('SELECT id, approval_status FROM deals WHERE id = ?').get(req.params.id);
  if (!deal) return res.status(404).json({ error: 'Deal not found' });
  if (deal.approval_status !== 'rejected') {
    return res.status(400).json({ error: 'Only rejected deals can be deleted' });
  }

  db.prepare('DELETE FROM deals WHERE id = ?').run(deal.id);
  res.json({ success: true });
});

router.post('/:id/items/reset-sync-overrides', (req, res) => {
  const db = getDb();
  const deal = db.prepare('SELECT id FROM deals WHERE id = ?').get(req.params.id);
  if (!deal) return res.status(404).json({ error: 'Deal not found' });

  db.prepare('UPDATE deal_items SET sync_override = NULL WHERE deal_id = ?').run(deal.id);
  res.json({ success: true });
});

router.patch('/:dealId/items/:itemId/sync-override', (req, res) => {
  const { syncOverride } = req.body;
  if (!VALID_SYNC_OVERRIDES.has(syncOverride ?? null)) {
    return res.status(400).json({ error: 'syncOverride must be include, exclude, or null' });
  }

  const db = getDb();
  const item = db.prepare(
    'SELECT id FROM deal_items WHERE id = ? AND deal_id = ?'
  ).get(req.params.itemId, req.params.dealId);
  if (!item) return res.status(404).json({ error: 'Item not found' });

  db.prepare('UPDATE deal_items SET sync_override = ? WHERE id = ?').run(syncOverride, item.id);
  res.json({ success: true });
});

router.patch('/:dealId/items/:itemId', (req, res) => {
  const { classification } = req.body;
  const db = getDb();
  db.prepare('UPDATE deal_items SET classification = ? WHERE id = ? AND deal_id = ?')
    .run(classification, req.params.itemId, req.params.dealId);
  res.json({ success: true });
});

export default router;
