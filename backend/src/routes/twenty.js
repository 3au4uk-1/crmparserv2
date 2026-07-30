import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { twentyAppAuthMiddleware } from '../middleware/twenty-app-auth.js';
import {
  addDealItemToList,
  getLineItemListStatus,
  getLineItemsListStatusBatch,
} from '../services/twenty-line-item-api.js';
import {
  archiveManualTwentyLineItem,
  upsertManualTwentyLineItem,
} from '../services/manual-twenty-line-item.js';
import { lockDealItemAmount } from '../services/deal-item-amount-lock.js';
import { scheduleListChangeResync } from '../services/list-change-resync.js';
import { syncDealToTwenty } from '../services/twenty-sync.js';
import { handleOkleykaSend } from '../telegram/handle-okleyka-send.js';

const router = Router();
router.use(twentyAppAuthMiddleware);

router.post('/line-items/list-status', (req, res, next) => {
  try {
    const db = getDb();
    const ids = req.body?.ids;
    if (!Array.isArray(ids)) {
      return res.status(400).json({ error: 'ids must be an array' });
    }
    res.json({ statuses: getLineItemsListStatusBatch(db, ids) });
  } catch (err) {
    next(err);
  }
});

router.get('/line-items/:twentyLineItemId/list-status', (req, res, next) => {
  try {
    const db = getDb();
    res.json(getLineItemListStatus(db, req.params.twentyLineItemId));
  } catch (err) {
    next(err);
  }
});

router.post('/line-items/:twentyLineItemId/amount', async (req, res, next) => {
  try {
    const db = getDb();
    const amountRub = req.body?.amountRub;
    const result = lockDealItemAmount(db, req.params.twentyLineItemId, amountRub);
    const sync = await syncDealToTwenty(result.dealId, { ignoreLineItemStageProtection: true });
    res.json({
      success: true,
      amountRub: result.amountRub,
      opportunityAmountRub: result.opportunityAmountRub,
      dealId: result.dealId,
      sync,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/line-items/:twentyLineItemId/add-to-list', async (req, res, next) => {
  try {
    const db = getDb();
    const { list } = req.body ?? {};
    const { deal } = addDealItemToList(db, req.params.twentyLineItemId, list);
    scheduleListChangeResync();
    void syncDealToTwenty(deal.id, { ignoreLineItemStageProtection: true }).catch((err) => {
      console.error('[twenty] add-to-list sync failed:', err.message);
    });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.post('/line-items/:twentyLineItemId/sync', (req, res, next) => {
  try {
    const db = getDb();
    const { dealItemId } = upsertManualTwentyLineItem(db, req.params.twentyLineItemId, req.body ?? {});
    res.json({ success: true, dealItemId });
  } catch (err) {
    next(err);
  }
});

router.post('/line-items/:twentyLineItemId/archive', (req, res, next) => {
  try {
    const db = getDb();
    archiveManualTwentyLineItem(db, req.params.twentyLineItemId);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.post('/telegram/events', async (req, res, next) => {
  try {
    const db = getDb();
    const body = req.body ?? {};
    if (body.event !== 'okleyka.send') {
      return res.status(400).json({ error: `Unsupported event: ${body.event}` });
    }
    const result = await handleOkleykaSend(db, body);
    return res.status(200).json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});

router.post('/opportunities/:twentyOppId/resync', async (req, res, next) => {
  try {
    const db = getDb();
    const deal = db.prepare('SELECT id FROM deals WHERE twenty_id = ?').get(req.params.twentyOppId);
    if (!deal) return res.status(404).json({ error: 'Deal not found' });
    const sync = await syncDealToTwenty(deal.id, { ignoreLineItemStageProtection: true });
    res.json({ success: true, sync });
  } catch (err) {
    next(err);
  }
});

export default router;
