import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { syncDealToTwenty, buildSyncPreview, resyncDealIfSynced } from '../services/twenty-sync.js';
import { enrichDealItems } from '../services/twenty-items.js';
import { loadBlacklist, createBlacklistEntry } from '../services/blacklist.js';
import { loadRestorationList, createRestorationEntry } from '../services/restoration.js';
import { loadNeNasheBrandingList } from '../services/ne-nashe-branding.js';
import { loadNeNasheDecorMkList } from '../services/ne-nashe-decor-mk.js';
import { createTipRule, loadTipRules } from '../services/tip-rules.js';
import { scheduleListChangeResync } from '../services/list-change-resync.js';
import { importAuthMiddleware } from '../middleware/import-auth.js';
import { importDealByBooking } from '../services/import-by-booking.js';
import { attachTonyBooking } from '../services/attach-tony-booking.js';
import {
  countSyncedDeals,
  createBulkResyncJob,
  executeBulkResyncJob,
  getActiveBulkResyncJob,
  getBulkResyncJob,
} from '../services/bulk-resync-jobs.js';
import {
  countSyncedDealsForRestore,
  createRestoreMissingTwentyJob,
  executeRestoreMissingTwentyJob,
  getActiveRestoreMissingTwentyJob,
  getRestoreMissingTwentyJob,
} from '../services/restore-missing-twenty-jobs.js';
import {
  countProductStreamBackfillDeals,
  createProductStreamBackfillJob,
  executeProductStreamBackfillJob,
  getActiveProductStreamBackfillJob,
  getProductStreamBackfillJob,
} from '../services/product-stream-backfill-jobs.js';
import {
  countPaymentSyncTargets,
  runPaymentSync,
} from '../services/payment-sync.js';
import {
  isPaymentSyncInProgress,
  releasePaymentSyncLock,
  tryAcquirePaymentSyncLock,
} from '../services/payment-sync-lock.js';

const router = Router();

async function respondWithOptionalSync(res, dealId) {
  const sync = await resyncDealIfSynced(dealId);
  res.json({ success: true, ...(sync ? { sync } : {}) });
}

const VALID_SYNC_OVERRIDES = new Set(['include', 'exclude', null]);

const SORT_COLUMNS = {
  start_date: 'd.start_date',
  title: 'd.title',
  company_code: 'd.company_code',
  manager_name: 'd.manager_name',
  budget: 'CAST(d.budget AS REAL)',
  approval_status: 'd.approval_status',
};

export function buildDealsOrderClause(sortBy, sortDir) {
  const column = SORT_COLUMNS[sortBy] || SORT_COLUMNS.start_date;
  const dir = sortDir === 'asc' ? 'ASC' : 'DESC';
  if (sortBy === 'budget') {
    return `ORDER BY (d.budget IS NULL), ${column} ${dir}`;
  }
  return `ORDER BY ${column} ${dir}`;
}

function attachDealItemCounts(deals, db) {
  if (!deals.length) return deals;
  const blacklist = loadBlacklist(db);
  const restorationList = loadRestorationList(db);
  const neNasheBrandingList = loadNeNasheBrandingList(db);
  const neNasheDecorMkList = loadNeNasheDecorMkList(db);
  const tipRules = loadTipRules(db);
  const ids = deals.map((d) => d.id);
  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT * FROM deal_items WHERE deal_id IN (${placeholders})`)
    .all(...ids);

  const byDeal = new Map();
  for (const row of rows) {
    if (!byDeal.has(row.deal_id)) byDeal.set(row.deal_id, []);
    byDeal.get(row.deal_id).push(row);
  }

  return deals.map((deal) => {
    const enriched = enrichDealItems(
      byDeal.get(deal.id) || [],
      blacklist,
      restorationList,
      deal,
      tipRules,
      neNasheBrandingList,
      neNasheDecorMkList,
    );
    return {
      ...deal,
      branding_count: enriched.filter((i) => i.eligibleForTwenty).length,
      total_items: enriched.length,
    };
  });
}

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

  const orderClause = buildDealsOrderClause(req.query.sortBy, req.query.sortDir);

  const rawDeals = db.prepare(`
    SELECT d.*
    FROM deals d WHERE ${where}
    ${orderClause} LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const deals = attachDealItemCounts(rawDeals, db);
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

router.get('/bulk-resync/preview', (req, res) => {
  res.json({ count: countSyncedDeals() });
});

router.post('/bulk-resync', (req, res) => {
  if (getActiveBulkResyncJob()) {
    return res.status(409).json({ error: 'Массовая пересинхронизация уже выполняется' });
  }
  if (getActiveRestoreMissingTwentyJob()) {
    return res.status(409).json({ error: 'Восстановление отсутствующих сделок уже выполняется' });
  }
  if (getActiveProductStreamBackfillJob()) {
    return res.status(409).json({ error: 'Обновление потоков продуктов уже выполняется' });
  }

  const requestedTrigger = req.body?.trigger;
  const trigger =
    typeof requestedTrigger === 'string' && requestedTrigger.trim()
      ? requestedTrigger.trim()
      : 'manual';

  const job = createBulkResyncJob({ trigger });
  executeBulkResyncJob(job.jobId).catch((err) => {
    console.error(`[bulk-resync] job ${job.jobId} failed:`, err.message);
  });

  res.status(201).json({ jobId: job.jobId });
});

router.get('/bulk-resync/jobs/active', (req, res) => {
  res.json(getActiveBulkResyncJob() ?? null);
});

router.get('/bulk-resync/jobs/:id', (req, res) => {
  const job = getBulkResyncJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Задача не найдена' });
  res.json(job);
});

router.get('/product-stream-backfill/preview', (req, res) => {
  res.json({ count: countProductStreamBackfillDeals() });
});

router.post('/product-stream-backfill', (req, res) => {
  if (getActiveProductStreamBackfillJob()) {
    return res.status(409).json({ error: 'Обновление потоков продуктов уже выполняется' });
  }
  if (getActiveBulkResyncJob()) {
    return res.status(409).json({ error: 'Массовая пересинхронизация уже выполняется' });
  }
  if (getActiveRestoreMissingTwentyJob()) {
    return res.status(409).json({ error: 'Восстановление отсутствующих сделок уже выполняется' });
  }

  const requestedTrigger = req.body?.trigger;
  const trigger =
    typeof requestedTrigger === 'string' && requestedTrigger.trim()
      ? requestedTrigger.trim()
      : 'manual';

  const job = createProductStreamBackfillJob({ trigger });
  executeProductStreamBackfillJob(job.jobId).catch((err) => {
    console.error(`[product-stream-backfill] job ${job.jobId} failed:`, err.message);
  });

  res.status(201).json({ jobId: job.jobId });
});

router.get('/product-stream-backfill/jobs/active', (req, res) => {
  res.json(getActiveProductStreamBackfillJob() ?? null);
});

router.get('/product-stream-backfill/jobs/:id', (req, res) => {
  const job = getProductStreamBackfillJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Задача не найдена' });
  res.json(job);
});

router.get('/restore-missing-twenty/preview', (req, res) => {
  res.json({ count: countSyncedDealsForRestore() });
});

router.post('/restore-missing-twenty', (req, res) => {
  if (getActiveRestoreMissingTwentyJob()) {
    return res.status(409).json({ error: 'Восстановление отсутствующих сделок уже выполняется' });
  }
  if (getActiveBulkResyncJob()) {
    return res.status(409).json({ error: 'Массовая пересинхронизация уже выполняется' });
  }
  if (getActiveProductStreamBackfillJob()) {
    return res.status(409).json({ error: 'Обновление потоков продуктов уже выполняется' });
  }

  const requestedTrigger = req.body?.trigger;
  const trigger =
    typeof requestedTrigger === 'string' && requestedTrigger.trim()
      ? requestedTrigger.trim()
      : 'manual';

  const job = createRestoreMissingTwentyJob({ trigger });
  executeRestoreMissingTwentyJob(job.jobId).catch((err) => {
    console.error(`[restore-missing-twenty] job ${job.jobId} failed:`, err.message);
  });

  res.status(201).json({ jobId: job.jobId });
});

router.get('/restore-missing-twenty/jobs/active', (req, res) => {
  res.json(getActiveRestoreMissingTwentyJob() ?? null);
});

router.get('/restore-missing-twenty/jobs/:id', (req, res) => {
  const job = getRestoreMissingTwentyJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Задача не найдена' });
  res.json(job);
});

router.get('/payment-sync/preview', (req, res) => {
  const { from, to } = req.query;
  if (!from || !to) {
    return res.status(400).json({ error: 'from and to required (YYYY-MM-DD)' });
  }
  try {
    const db = getDb();
    res.json(countPaymentSyncTargets(db, from, to));
  } catch (err) {
    if (err.message === 'from must be <= to' || err.message === 'from and to required (YYYY-MM-DD)') {
      return res.status(400).json({ error: err.message });
    }
    throw err;
  }
});

router.post('/payment-sync', async (req, res, next) => {
  if (!tryAcquirePaymentSyncLock()) {
    return res.status(409).json({ error: 'Синхронизация поступлений уже выполняется' });
  }

  const { from, to } = req.body || {};
  if (!from || !to) {
    releasePaymentSyncLock();
    return res.status(400).json({ error: 'from and to required (YYYY-MM-DD)' });
  }

  try {
    const result = await runPaymentSync({ from, to });
    res.json(result);
  } catch (err) {
    if (err.message === 'from must be <= to' || err.message === 'from and to required (YYYY-MM-DD)') {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  } finally {
    releasePaymentSyncLock();
  }
});

router.get('/payment-sync/status', (req, res) => {
  res.json({ inProgress: isPaymentSyncInProgress() });
});

router.post('/import-by-booking', importAuthMiddleware, async (req, res) => {
  try {
    const bookingNumber = String(req.body?.bookingNumber ?? '').trim();
    if (!/^\d+$/.test(bookingNumber)) {
      return res.status(400).json({ ok: false, error: 'bookingNumber required (digits only)' });
    }
    console.log(`[import-by-booking] start booking=${bookingNumber}`);
    const result = await importDealByBooking(bookingNumber);
    console.log(`[import-by-booking] done booking=${bookingNumber} opportunityId=${result.opportunityId}`);
    res.json(result);
  } catch (err) {
    const message = err.message || 'Import failed';
    const status = message.includes('не найдена') ? 404 : 500;
    res.status(status).json({ ok: false, error: message });
  }
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
  const blacklist = loadBlacklist(db);
  const restorationList = loadRestorationList(db);
  const neNasheBrandingList = loadNeNasheBrandingList(db);
  const neNasheDecorMkList = loadNeNasheDecorMkList(db);
  const tipRules = loadTipRules(db);
  const items = db.prepare('SELECT * FROM deal_items WHERE deal_id = ?').all(req.params.id);
  const enrichedItems = enrichDealItems(
    items,
    blacklist,
    restorationList,
    deal,
    tipRules,
    neNasheBrandingList,
    neNasheDecorMkList,
  );
  res.json({
    ...deal,
    items: enrichedItems,
    twentyEligibleCount: enrichedItems.filter((i) => i.eligibleForTwenty).length,
    totalItems: enrichedItems.length,
  });
});

router.post('/:id/resync', async (req, res, next) => {
  try {
    const db = getDb();
    const dealId = Number(req.params.id);
    const deal = db.prepare('SELECT id, twenty_id, title FROM deals WHERE id = ?').get(dealId);
    if (!deal) return res.status(404).json({ error: 'Deal not found' });
    if (!deal.twenty_id) {
      return res.status(400).json({ error: 'Deal is not synced to Twenty yet' });
    }
    console.log(`[twenty-sync] ${new Date().toISOString()} api.resync_start {"dealId":${dealId},"twentyId":"${deal.twenty_id}","title":${JSON.stringify(deal.title)}}`);
    const result = await syncDealToTwenty(dealId);
    console.log(`[twenty-sync] ${new Date().toISOString()} api.resync_done {"dealId":${dealId},"action":"${result.action}"}`);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error(`[twenty-sync] ${new Date().toISOString()} api.resync_failed {"dealId":${Number(req.params.id)},"error":${JSON.stringify(err.message)}}`);
    next(err);
  }
});

router.patch('/:id/tony-booking', async (req, res, next) => {
  try {
    const bookingNumber = String(req.body?.bookingNumber ?? '').trim();
    const result = await attachTonyBooking(Number(req.params.id), bookingNumber);
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
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

router.post('/:id/items/reset-sync-overrides', async (req, res, next) => {
  try {
    const db = getDb();
    const deal = db.prepare('SELECT id FROM deals WHERE id = ?').get(req.params.id);
    if (!deal) return res.status(404).json({ error: 'Deal not found' });

    db.prepare('UPDATE deal_items SET sync_override = NULL WHERE deal_id = ?').run(deal.id);
    await respondWithOptionalSync(res, Number(req.params.id));
  } catch (err) {
    next(err);
  }
});

router.patch('/:dealId/items/:itemId/sync-override', async (req, res, next) => {
  try {
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
    await respondWithOptionalSync(res, Number(req.params.dealId));
  } catch (err) {
    next(err);
  }
});

router.post('/:dealId/items/:itemId/blacklist', async (req, res, next) => {
  try {
    const db = getDb();
    const item = db
      .prepare('SELECT id, name FROM deal_items WHERE id = ? AND deal_id = ?')
      .get(req.params.itemId, req.params.dealId);
    if (!item) return res.status(404).json({ error: 'Item not found' });

    createBlacklistEntry(db, {
      pattern: item.name,
      matchType: 'exact',
      sourceName: item.name,
    });
    scheduleListChangeResync();
    await respondWithOptionalSync(res, Number(req.params.dealId));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.post('/:dealId/items/:itemId/restoration', async (req, res, next) => {
  try {
    const db = getDb();
    const item = db
      .prepare('SELECT id, name FROM deal_items WHERE id = ? AND deal_id = ?')
      .get(req.params.itemId, req.params.dealId);
    if (!item) return res.status(404).json({ error: 'Item not found' });

    createRestorationEntry(db, {
      pattern: item.name,
      matchType: 'exact',
      sourceName: item.name,
    });
    scheduleListChangeResync();
    await respondWithOptionalSync(res, Number(req.params.dealId));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.post('/:dealId/items/:itemId/podryad', async (req, res, next) => {
  try {
    const db = getDb();
    const item = db
      .prepare('SELECT id, name FROM deal_items WHERE id = ? AND deal_id = ?')
      .get(req.params.itemId, req.params.dealId);
    if (!item) return res.status(404).json({ error: 'Item not found' });

    createTipRule(db, {
      pattern: item.name,
      matchType: 'exact',
      tip: 'PODRYAD',
      sourceName: item.name,
    });
    scheduleListChangeResync();
    await respondWithOptionalSync(res, Number(req.params.dealId));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.post('/:dealId/items/:itemId/banner', async (req, res, next) => {
  try {
    const db = getDb();
    const item = db
      .prepare('SELECT id, name FROM deal_items WHERE id = ? AND deal_id = ?')
      .get(req.params.itemId, req.params.dealId);
    if (!item) return res.status(404).json({ error: 'Item not found' });

    createTipRule(db, {
      pattern: item.name,
      matchType: 'exact',
      tip: 'BANNERA',
      sourceName: item.name,
    });
    scheduleListChangeResync();
    await respondWithOptionalSync(res, Number(req.params.dealId));
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.patch('/:dealId/items/:itemId', (req, res) => {
  const { classification } = req.body;
  const db = getDb();
  db.prepare('UPDATE deal_items SET classification = ? WHERE id = ? AND deal_id = ?')
    .run(classification, req.params.itemId, req.params.dealId);
  res.json({ success: true });
});

export default router;
