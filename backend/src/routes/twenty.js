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
import { writeDealItemQuantity } from '../services/deal-item-quantity.js';
import { scheduleListChangeResync } from '../services/list-change-resync.js';
import { syncDealToTwenty } from '../services/twenty-sync.js';
import { handleOkleykaSend } from '../telegram/handle-okleyka-send.js';
import { getOkleykaJobStatus } from '../telegram/okleyka-outbox.js';
import { queueBannerPodryadCatchUp } from '../telegram/banner-podryad/run.js';
import { getEventJournal, isTwentyEventsEnabled } from '../services/twenty-events/index.js';
import { waitForEvents } from '../services/twenty-events/wait-for-events.js';
import {
  confirmDealGroup,
  dissolveDealGroup,
  planExpenseRollup,
  unlinkDealFromGroup,
} from '../services/deal-groups.js';
import { suggestDealGroups } from '../services/deal-group-suggest.js';
import {
  clearDealGroupTwenty,
  mirrorDealGroupToTwenty,
} from '../services/deal-group-twenty.js';
import { buildExpenseUpdateInput } from '../services/expense-sync.js';
import { requireTwentyConfig } from '../services/twenty-config.js';
import { assertGqlSuccess, assertHttpSuccess, gql } from '../services/twenty-gql.js';

const UPDATE_OPPORTUNITY_EXPENSES_MUTATION = `
  mutation UpdateOpportunityExpenses($id: ID!, $input: OpportunityUpdateInput!) {
    updateOpportunity(id: $id, data: $input) { id }
  }
`;

function dealGroupHttpError(err, res, next) {
  if (err?.status) {
    const body = { error: err.message };
    if (err.code) body.code = err.code;
    if (err.dealId != null) body.dealId = err.dealId;
    return res.status(err.status).json(body);
  }
  return next(err);
}

function findDealByTwentyOppId(db, twentyOppId) {
  const id = String(twentyOppId || '').trim();
  if (!id) return null;
  return db.prepare('SELECT * FROM deals WHERE twenty_id = ?').get(id) || null;
}

function requireDealByTwentyOppId(db, twentyOppId) {
  const deal = findDealByTwentyOppId(db, twentyOppId);
  if (!deal) {
    const err = new Error(`Deal not found for twentyOppId ${twentyOppId}`);
    err.status = 404;
    err.code = 'DEAL_NOT_FOUND';
    throw err;
  }
  return deal;
}

function mapTwentyOppIdsToDealIds(db, twentyOppIds) {
  if (!Array.isArray(twentyOppIds) || twentyOppIds.length === 0) {
    const err = new Error('twentyOppIds must be a non-empty array');
    err.status = 400;
    err.code = 'INVALID_BODY';
    throw err;
  }
  return twentyOppIds.map((twentyOppId) => requireDealByTwentyOppId(db, twentyOppId).id);
}

function loadGroupPayload(db, groupId) {
  const group = db.prepare('SELECT * FROM deal_groups WHERE id = ?').get(groupId);
  if (!group) return null;
  const members = db.prepare(`
    SELECT d.id, d.title, d.twenty_id, d.payment_amount, d.crm_lead_id, d.tony_order_id
    FROM deal_group_members m
    JOIN deals d ON d.id = m.deal_id
    WHERE m.group_id = ?
    ORDER BY d.id
  `).all(groupId);
  return { group, members };
}

function findGroupIdForTwentyOppId(db, twentyOppId) {
  const id = String(twentyOppId || '').trim();
  if (!id) return null;

  const byParent = db.prepare(
    'SELECT id FROM deal_groups WHERE twenty_parent_id = ?',
  ).get(id);
  if (byParent) return byParent.id;

  const deal = findDealByTwentyOppId(db, id);
  if (!deal) return null;
  const membership = db.prepare(
    'SELECT group_id FROM deal_group_members WHERE deal_id = ?',
  ).get(deal.id);
  return membership?.group_id ?? null;
}

function loadSyncedDealsForSuggest(db) {
  const rows = db.prepare(`
    SELECT d.id, d.title, d.manager_name, d.load_date, d.start_date, d.twenty_id,
           m.group_id AS groupId
    FROM deals d
    LEFT JOIN deal_group_members m ON m.deal_id = d.id
    WHERE d.twenty_id IS NOT NULL
  `).all();

  const linksStmt = db.prepare(
    'SELECT bitrix_id FROM deal_bitrix_links WHERE deal_id = ? ORDER BY id',
  );
  return rows.map((row) => ({
    ...row,
    bitrixIds: linksStmt.all(row.id).map((l) => l.bitrix_id),
  }));
}

function buildMemberExpenseRows(db, dealIds) {
  const rows = [];
  const linksStmt = db.prepare(`
    SELECT bitrix_id FROM deal_bitrix_links
    WHERE deal_id = ?
    ORDER BY is_canonical DESC, id
  `);
  for (const dealId of dealIds) {
    const links = linksStmt.all(dealId);
    for (const link of links) {
      rows.push({ dealId, bitrixId: link.bitrix_id, amounts: {} });
    }
  }
  return rows;
}

async function applyExpenseRollupToCanonical(db, group) {
  const members = db.prepare(
    'SELECT deal_id FROM deal_group_members WHERE group_id = ?',
  ).all(group.id);
  const dealIds = members.map((m) => m.deal_id);
  const plan = planExpenseRollup(buildMemberExpenseRows(db, dealIds), group.canonical_deal_id);
  const amounts = plan?.amounts || {};
  if (Object.keys(amounts).length === 0) return plan;

  const canonical = db.prepare('SELECT twenty_id FROM deals WHERE id = ?').get(group.canonical_deal_id);
  if (!canonical?.twenty_id) return plan;

  const twenty = requireTwentyConfig();
  const resp = await gql(
    twenty.apiUrl,
    twenty.apiToken,
    UPDATE_OPPORTUNITY_EXPENSES_MUTATION,
    {
      id: canonical.twenty_id,
      input: buildExpenseUpdateInput({ amounts }),
    },
  );
  assertHttpSuccess(resp, twenty.apiUrl);
  assertGqlSuccess(resp, `Failed to apply expense rollup to ${canonical.twenty_id}`);
  return plan;
}

async function deleteParentOpportunityIfEmpty(parentTwentyId) {
  const twenty = requireTwentyConfig();
  const check = await gql(
    twenty.apiUrl,
    twenty.apiToken,
    `query ParentHasLineItems($id: ID!) {
      dealLineItems(filter: { opportunityId: { eq: $id } }, first: 1) {
        edges { node { id } }
      }
    }`,
    { id: parentTwentyId },
  );
  assertHttpSuccess(check, twenty.apiUrl);
  assertGqlSuccess(check, `Failed to list line items for parent ${parentTwentyId}`);
  const edges = check.data?.data?.dealLineItems?.edges || [];
  if (edges.length > 0) {
    console.warn(
      `[deal-groups] skip delete parent ${parentTwentyId}: has dealLineItems`,
    );
    return { deleted: false, skippedDelete: true };
  }

  const del = await gql(
    twenty.apiUrl,
    twenty.apiToken,
    `mutation DeleteOpp($id: ID!) {
      deleteOpportunity(id: $id) { id }
    }`,
    { id: parentTwentyId },
  );
  assertHttpSuccess(del, twenty.apiUrl);
  assertGqlSuccess(del, `Failed to delete parent opportunity ${parentTwentyId}`);
  return { deleted: true };
}

function patchDealGroupRow(db, groupId, body = {}) {
  const group = db.prepare('SELECT * FROM deal_groups WHERE id = ?').get(groupId);
  if (!group) {
    const err = new Error(`Deal group ${groupId} not found`);
    err.status = 404;
    err.code = 'GROUP_NOT_FOUND';
    throw err;
  }

  let name = group.name;
  let nameLocked = group.name_locked;
  let canonicalDealId = group.canonical_deal_id;
  let canonicalBitrixId = group.canonical_bitrix_id;
  let canonicalLocked = group.canonical_locked;

  if (body.name != null) {
    name = String(body.name).trim();
    if (!name) {
      const err = new Error('name must be non-empty');
      err.status = 400;
      throw err;
    }
  }
  if (body.nameLocked != null) nameLocked = body.nameLocked ? 1 : 0;

  if (body.canonicalTwentyOppId != null) {
    const deal = requireDealByTwentyOppId(db, body.canonicalTwentyOppId);
    const member = db.prepare(
      'SELECT deal_id FROM deal_group_members WHERE group_id = ? AND deal_id = ?',
    ).get(groupId, deal.id);
    if (!member) {
      const err = new Error('canonicalTwentyOppId must be a group member');
      err.status = 400;
      err.code = 'INVALID_CANONICAL_DEAL';
      throw err;
    }
    canonicalDealId = deal.id;
  }

  if (body.canonicalBitrixId != null) {
    canonicalBitrixId = String(body.canonicalBitrixId).trim();
    const link = db.prepare(
      'SELECT bitrix_id FROM deal_bitrix_links WHERE deal_id = ? AND bitrix_id = ?',
    ).get(canonicalDealId, canonicalBitrixId);
    if (!link) {
      const err = new Error(
        `canonical_bitrix_id ${canonicalBitrixId} not on deal ${canonicalDealId}`,
      );
      err.status = 400;
      err.code = 'INVALID_CANONICAL_BITRIX';
      throw err;
    }
  }

  if (body.canonicalLocked != null) canonicalLocked = body.canonicalLocked ? 1 : 0;

  db.prepare(`
    UPDATE deal_groups
    SET name = ?,
        name_locked = ?,
        canonical_deal_id = ?,
        canonical_bitrix_id = ?,
        canonical_locked = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(name, nameLocked ? 1 : 0, canonicalDealId, canonicalBitrixId, canonicalLocked ? 1 : 0, groupId);

  return db.prepare('SELECT * FROM deal_groups WHERE id = ?').get(groupId);
}

const router = Router();
router.use(twentyAppAuthMiddleware);

router.get('/deal-groups/suggestions', (req, res, next) => {
  try {
    const db = getDb();
    const deals = loadSyncedDealsForSuggest(db);
    const raw = suggestDealGroups(deals);
    const twentyByDealId = new Map(
      deals.map((deal) => [deal.id, deal.twenty_id]).filter(([, twentyId]) => twentyId),
    );
    const withTwentyOppIds = (candidates) =>
      candidates.map((candidate) => ({
        ...candidate,
        twentyOppIds: candidate.dealIds
          .map((dealId) => twentyByDealId.get(dealId))
          .filter(Boolean),
      }));
    res.json({
      hard: withTwentyOppIds(raw.hard),
      soft: withTwentyOppIds(raw.soft),
    });
  } catch (err) {
    dealGroupHttpError(err, res, next);
  }
});

router.get('/deal-groups', (req, res, next) => {
  try {
    const db = getDb();
    const twentyOppId = req.query.twentyOppId;
    if (!twentyOppId || typeof twentyOppId !== 'string') {
      return res.status(400).json({ error: 'twentyOppId query required' });
    }

    const groupId = findGroupIdForTwentyOppId(db, twentyOppId);
    if (groupId == null) {
      if (!findDealByTwentyOppId(db, twentyOppId)) {
        return res.status(404).json({ error: `Deal not found for twentyOppId ${twentyOppId}` });
      }
      return res.status(404).json({ error: 'Deal is not in a group' });
    }

    const payload = loadGroupPayload(db, groupId);
    if (!payload) return res.status(404).json({ error: 'Deal group not found' });
    res.json(payload);
  } catch (err) {
    dealGroupHttpError(err, res, next);
  }
});

router.post('/deal-groups', async (req, res, next) => {
  try {
    const db = getDb();
    const body = req.body ?? {};
    const dealIds = mapTwentyOppIdsToDealIds(db, body.twentyOppIds);

    const opts = {
      dealIds,
      name: body.name,
      nameLocked: body.nameLocked,
      canonicalBitrixId: body.canonicalBitrixId,
      canonicalLocked: body.canonicalLocked,
    };
    if (body.canonicalTwentyOppId != null) {
      opts.canonicalDealId = requireDealByTwentyOppId(db, body.canonicalTwentyOppId).id;
    }

    const group = confirmDealGroup(db, opts);
    const mirror = await mirrorDealGroupToTwenty(db, group.id);
    await applyExpenseRollupToCanonical(db, group);

    res.json({
      group,
      parentTwentyId: mirror?.parentTwentyId ?? group.twenty_parent_id ?? null,
    });
  } catch (err) {
    dealGroupHttpError(err, res, next);
  }
});

router.patch('/deal-groups/:id', async (req, res, next) => {
  try {
    const db = getDb();
    const groupId = Number(req.params.id);
    if (!Number.isFinite(groupId)) {
      return res.status(400).json({ error: 'invalid group id' });
    }
    const group = patchDealGroupRow(db, groupId, req.body ?? {});
    const mirror = await mirrorDealGroupToTwenty(db, group.id);
    res.json({
      group,
      parentTwentyId: mirror?.parentTwentyId ?? group.twenty_parent_id ?? null,
    });
  } catch (err) {
    dealGroupHttpError(err, res, next);
  }
});

router.post('/deal-groups/:id/unlink', async (req, res, next) => {
  try {
    const db = getDb();
    const groupId = Number(req.params.id);
    if (!Number.isFinite(groupId)) {
      return res.status(400).json({ error: 'invalid group id' });
    }
    const group = db.prepare('SELECT * FROM deal_groups WHERE id = ?').get(groupId);
    if (!group) return res.status(404).json({ error: 'Deal group not found' });

    const twentyOppId = req.body?.twentyOppId;
    const deal = requireDealByTwentyOppId(db, twentyOppId);
    const membership = db.prepare(
      'SELECT group_id FROM deal_group_members WHERE group_id = ? AND deal_id = ?',
    ).get(groupId, deal.id);
    if (!membership) {
      return res.status(404).json({ error: 'Deal is not a member of this group' });
    }

    if (deal.twenty_id) {
      const twenty = requireTwentyConfig();
      const resp = await gql(
        twenty.apiUrl,
        twenty.apiToken,
        `mutation DetachChild($id: ID!, $data: OpportunityUpdateInput!) {
          updateOpportunity(id: $id, data: $data) { id }
        }`,
        { id: deal.twenty_id, data: { parentOpportunityId: null } },
      );
      assertHttpSuccess(resp, twenty.apiUrl);
      assertGqlSuccess(resp, `Failed to detach ${deal.twenty_id}`);
    }

    const parentTwentyId = group.twenty_parent_id;
    const result = unlinkDealFromGroup(db, deal.id);
    if (result.dissolved) {
      if (parentTwentyId) {
        await deleteParentOpportunityIfEmpty(parentTwentyId);
      }
      return res.json({ dissolved: true });
    }

    const mirror = await mirrorDealGroupToTwenty(db, groupId);
    res.json({
      dissolved: false,
      parentTwentyId: mirror?.parentTwentyId ?? parentTwentyId ?? null,
    });
  } catch (err) {
    dealGroupHttpError(err, res, next);
  }
});

router.post('/deal-groups/:id/dissolve', async (req, res, next) => {
  try {
    const db = getDb();
    const groupId = Number(req.params.id);
    if (!Number.isFinite(groupId)) {
      return res.status(400).json({ error: 'invalid group id' });
    }
    const group = db.prepare('SELECT * FROM deal_groups WHERE id = ?').get(groupId);
    if (!group) return res.status(404).json({ error: 'Deal group not found' });

    await clearDealGroupTwenty(db, groupId);
    dissolveDealGroup(db, groupId);
    res.json({ dissolved: true });
  } catch (err) {
    dealGroupHttpError(err, res, next);
  }
});

router.get('/events', async (req, res, next) => {
  try {
    if (!isTwentyEventsEnabled()) {
      return res.json({ disabled: true });
    }

    const journal = getEventJournal();
    if (!journal) {
      return res.status(503).json({ error: 'Twenty events journal is not ready' });
    }

    const sinceRaw = req.query.since;
    const since =
      typeof sinceRaw === 'string' && /^\d+$/.test(sinceRaw) ? Number(sinceRaw) : undefined;
    const epochRaw = req.query.epoch;
    const epoch = typeof epochRaw === 'string' && epochRaw ? epochRaw : undefined;

    const controller = new AbortController();
    res.on('close', () => controller.abort());

    const result = await waitForEvents(journal, { since, epoch, signal: controller.signal });
    if (res.writableEnded) return;

    res.json(result);
  } catch (err) {
    next(err);
  }
});

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

router.post('/line-items/:twentyLineItemId/quantity', async (req, res, next) => {
  try {
    const db = getDb();
    const result = writeDealItemQuantity(db, req.params.twentyLineItemId, req.body?.kolichestvo);
    const sync = await syncDealToTwenty(result.dealId, { ignoreLineItemStageProtection: true });
    res.json({
      success: true,
      kolichestvo: result.kolichestvo,
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

router.get('/telegram/okleyka-jobs/:lineItemId', (req, res) => {
  const lineItemId = String(req.params.lineItemId || '').trim();
  if (!lineItemId) return res.status(400).json({ error: 'lineItemId required' });
  res.json(getOkleykaJobStatus(getDb(), lineItemId));
});

router.post('/telegram/events', async (req, res, next) => {
  try {
    const db = getDb();
    const body = req.body ?? {};
    if (body.event === 'okleyka.send') {
      const result = await handleOkleykaSend(db, body);
      return res.status(200).json(result);
    }
    if (body.event === 'banner_podryad.catchup') {
      const lineItemId = typeof body.lineItemId === 'string' ? body.lineItemId.trim() : '';
      if (lineItemId) {
        queueBannerPodryadCatchUp([lineItemId], { db });
      }
      return res.status(200).json({ ok: true, queued: Boolean(lineItemId) });
    }
    return res.status(400).json({ error: `Unsupported event: ${body.event}` });
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
