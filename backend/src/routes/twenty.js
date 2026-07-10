import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { twentyAppAuthMiddleware } from '../middleware/twenty-app-auth.js';
import {
  addDealItemToList,
  getLineItemListStatus,
} from '../services/twenty-line-item-api.js';
import { scheduleListChangeResync } from '../services/list-change-resync.js';
import { syncDealToTwenty } from '../services/twenty-sync.js';

const router = Router();
router.use(twentyAppAuthMiddleware);

router.get('/line-items/:twentyLineItemId/list-status', (req, res, next) => {
  try {
    const db = getDb();
    res.json(getLineItemListStatus(db, req.params.twentyLineItemId));
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
    const sync = await syncDealToTwenty(deal.id, { ignoreLineItemStageProtection: true });
    res.json({ success: true, sync });
  } catch (err) {
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
