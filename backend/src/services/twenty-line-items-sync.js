import {
  buildLineItemCreateInput,
  buildLineItemUpdateInput,
} from './twenty-line-item.js';
import { normalizePattern } from './blacklist.js';
import { shouldZeroLineItemAmount } from './twenty-opportunity.js';
import { findTipRuleMatch } from './tip-rules.js';
import { logTwentyStep } from './twenty-sync-log.js';
import { CANCELLED_OPPORTUNITY_STAGE, DEFAULT_OPPORTUNITY_STAGE } from './twenty-opportunity.js';
import { MANUAL_TWENTY_CLASSIFICATION } from './manual-twenty-line-item.js';

/** Line items at this stage (or null) may be deleted/updated on re-sync. */
export const DELETABLE_LINE_ITEM_STAGE = DEFAULT_OPPORTUNITY_STAGE;

export function isProtectedLineItemStage(stage) {
  return stage != null && stage !== DELETABLE_LINE_ITEM_STAGE;
}

function isManualTwentyItem(item) {
  return item.classification === MANUAL_TWENTY_CLASSIFICATION && item.twenty_id;
}

function isUnsyncedManualTwenty(li, manualParserTwentyIds) {
  return (
    li.istochnik === 'TWENTY_RUCHNAYA'
    && !manualParserTwentyIds.has(li.id)
  );
}

function getManualParserTwentyIds(db) {
  const rows = db.prepare(
    'SELECT twenty_id FROM deal_items WHERE classification = ? AND twenty_id IS NOT NULL',
  ).all(MANUAL_TWENTY_CLASSIFICATION);
  return new Set(rows.map((row) => row.twenty_id));
}

export function computeLineItemDiff(
  existingLineItems,
  eligibleItems,
  { ignoreStageProtection = false, manualParserTwentyIds = new Set() } = {},
) {
  const isProtected = (stage) => !ignoreStageProtection && isProtectedLineItemStage(stage);
  const manualItems = eligibleItems.filter(isManualTwentyItem);
  const parsedItems = eligibleItems.filter((item) => !isManualTwentyItem(item));

  const existingById = new Map(existingLineItems.map((li) => [li.id, li]));

  const toUpdate = [];
  const toCreate = [];
  const claimedIds = new Set();

  for (const item of manualItems) {
    const existing = existingById.get(item.twenty_id);
    if (existing) {
      if (isProtected(existing.stage)) {
        claimedIds.add(existing.id);
        continue;
      }
      claimedIds.add(existing.id);
      toUpdate.push({ twentyId: item.twenty_id, item });
    } else {
      toCreate.push(item);
    }
  }

  const byNameQueues = new Map();
  for (const li of existingLineItems) {
    const key = normalizePattern(li.name);
    if (!byNameQueues.has(key)) byNameQueues.set(key, []);
    byNameQueues.get(key).push(li);
  }

  for (const item of parsedItems) {
    if (item.twenty_id && existingById.has(item.twenty_id) && !claimedIds.has(item.twenty_id)) {
      const existing = existingById.get(item.twenty_id);
      if (isProtected(existing.stage)) {
        claimedIds.add(existing.id);
        continue;
      }
      claimedIds.add(existing.id);
      toUpdate.push({ twentyId: existing.id, item });
      continue;
    }

    const key = normalizePattern(item.name);
    const queue = byNameQueues.get(key) || [];
    let matched = null;
    while (queue.length) {
      const candidate = queue.shift();
      if (claimedIds.has(candidate.id)) continue;
      matched = candidate;
      break;
    }
    if (matched) {
      if (isProtected(matched.stage)) {
        claimedIds.add(matched.id);
        continue;
      }
      claimedIds.add(matched.id);
      toUpdate.push({ twentyId: matched.id, item });
    } else {
      toCreate.push(item);
    }
  }

  const manualTwentyIds = new Set(manualItems.map((item) => item.twenty_id));

  const toDelete = [];
  const preserved = [];

  for (const li of existingLineItems) {
    if (manualTwentyIds.has(li.id)) continue;
    if (claimedIds.has(li.id)) continue;
    if (isProtected(li.stage)) {
      preserved.push({ id: li.id, name: li.name, stage: li.stage });
      continue;
    }
    if (isUnsyncedManualTwenty(li, manualParserTwentyIds)) continue;
    toDelete.push(li.id);
  }

  return { toUpdate, toCreate, toDelete, preserved };
}

export async function listLineItemsForOpportunity(gql, apiUrl, apiToken, oppId) {
  const resp = await gql(
    apiUrl,
    apiToken,
    `query ListLineItems($oppId: ID!) {
      dealLineItems(filter: { opportunityId: { eq: $oppId } }) {
        edges { node { id name stage istochnik } }
      }
    }`,
    { oppId }
  );
  return resp.data?.data?.dealLineItems?.edges?.map((e) => e.node) || [];
}

export async function deleteLineItem(gql, apiUrl, apiToken, lineItemId) {
  return gql(
    apiUrl,
    apiToken,
    `mutation DeleteDealLineItem($id: ID!) {
      deleteDealLineItem(id: $id) { id }
    }`,
    { id: lineItemId }
  );
}

export async function cancelLineItemsForOpportunity(
  gql,
  apiUrl,
  apiToken,
  oppId,
  {
    cancelledStage = CANCELLED_OPPORTUNITY_STAGE,
    assertHttpSuccess = null,
    assertGqlSuccess = null,
  } = {},
) {
  const existingLineItems = await listLineItemsForOpportunity(gql, apiUrl, apiToken, oppId);
  let cancelled = 0;

  for (const li of existingLineItems) {
    if (li.stage === cancelledStage) continue;

    logTwentyStep('line_items.cancel', { lineItemId: li.id, name: li.name, fromStage: li.stage });

    const resp = await gql(
      apiUrl,
      apiToken,
      `mutation UpdateDealLineItem($id: ID!, $input: DealLineItemUpdateInput!) {
        updateDealLineItem(id: $id, data: $input) { id }
      }`,
      { id: li.id, input: { stage: cancelledStage } }
    );

    if (assertHttpSuccess) assertHttpSuccess(resp, apiUrl);
    if (assertGqlSuccess) {
      assertGqlSuccess(resp, `Failed to cancel line item "${li.name}" in Twenty`);
    }

    cancelled += 1;
  }

  return { cancelled, total: existingLineItems.length };
}

export async function syncLineItemsDiff({
  gql,
  assertHttpSuccess,
  assertGqlSuccess,
  apiUrl,
  apiToken,
  oppId,
  eligibleItems,
  existingLineItems,
  findOrCreateWarehouseItem,
  db,
  deal = null,
  restorationList = [],
  neNasheBrandingList = [],
  neNasheDecorMkList = [],
  tipRules = [],
  ignoreStageProtection = false,
}) {
  const { toUpdate, toCreate, toDelete, preserved } = computeLineItemDiff(
    existingLineItems,
    eligibleItems,
    {
      ignoreStageProtection,
      manualParserTwentyIds: getManualParserTwentyIds(db),
    },
  );

  const lineItemOptions = {
    deal,
    restorationList,
    neNasheBrandingList,
    neNasheDecorMkList,
    tipRules,
  };

  logTwentyStep('line_items.diff', {
    toUpdate: toUpdate.length,
    toCreate: toCreate.length,
    toDelete: toDelete.length,
    preserved: preserved.length,
    ignoreStageProtection,
    updateNames: toUpdate.map((x) => x.item.name).slice(0, 5),
    createNames: toCreate.map((x) => x.name).slice(0, 5),
  });

  if (preserved.length) {
    logTwentyStep('line_items.preserved', { items: preserved });
  }

  const zeroed = eligibleItems.filter((i) => shouldZeroLineItemAmount(i.name, {
    restorationList,
    neNasheBrandingList,
    neNasheDecorMkList,
  }));
  if (zeroed.length) {
    logTwentyStep('line_items.restoration_zero', { names: zeroed.map((i) => i.name) });
  }

  const tipMatched = (tip) =>
    eligibleItems.filter((i) => findTipRuleMatch(i.name, tipRules)?.tip === tip);
  const podryadItems = tipMatched('PODRYAD');
  if (podryadItems.length) {
    logTwentyStep('line_items.podryad_tip', { names: podryadItems.map((i) => i.name) });
  }

  const bannerItems = tipMatched('BANNERA');
  if (bannerItems.length) {
    logTwentyStep('line_items.banner_tip', { names: bannerItems.map((i) => i.name) });
  }

  for (const lineItemId of toDelete) {
    logTwentyStep('line_items.delete', { lineItemId });
    const resp = await deleteLineItem(gql, apiUrl, apiToken, lineItemId);
    assertHttpSuccess(resp, apiUrl);
    assertGqlSuccess(resp, 'Failed to delete line item in Twenty');
  }

  for (const { twentyId, item } of toUpdate) {
    logTwentyStep('line_items.update', { lineItemId: twentyId, name: item.name, price: item.price });
    const resp = await gql(
      apiUrl,
      apiToken,
      `mutation UpdateDealLineItem($id: ID!, $input: DealLineItemUpdateInput!) {
        updateDealLineItem(id: $id, data: $input) { id }
      }`,
      { id: twentyId, input: buildLineItemUpdateInput(item, lineItemOptions) }
    );
    assertHttpSuccess(resp, apiUrl);
    assertGqlSuccess(resp, `Failed to update line item "${item.name}" in Twenty`);
    db.prepare('UPDATE deal_items SET twenty_id = ? WHERE id = ?').run(twentyId, item.id);
  }

  let position = 0;
  for (const item of toCreate) {
    logTwentyStep('line_items.create', { name: item.name, price: item.price });
    const warehouseItemId = await findOrCreateWarehouseItem(apiUrl, apiToken, item.name);
    const resp = await gql(
      apiUrl,
      apiToken,
      `mutation CreateDealLineItem($input: DealLineItemCreateInput!) {
        createDealLineItem(data: $input) { id }
      }`,
      {
        input: buildLineItemCreateInput(
          item,
          warehouseItemId,
          oppId,
          position === 0 ? 'first' : position,
          lineItemOptions
        ),
      }
    );
    assertHttpSuccess(resp, apiUrl);
    assertGqlSuccess(resp, `Failed to create line item "${item.name}" in Twenty`);
    const lineItemId = resp.data?.data?.createDealLineItem?.id;
    if (!lineItemId) throw new Error(`Failed to create line item "${item.name}" in Twenty`);
    db.prepare('UPDATE deal_items SET twenty_id = ? WHERE id = ?').run(lineItemId, item.id);
    position += 1;
  }

  return { updated: toUpdate.length, created: toCreate.length, deleted: toDelete.length };
}
