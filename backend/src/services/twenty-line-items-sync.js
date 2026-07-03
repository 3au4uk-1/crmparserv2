import {
  buildLineItemCreateInput,
  buildLineItemUpdateInput,
} from './twenty-line-item.js';
import { isRestorationItem } from './restoration.js';
import { isPodryadItem } from './podryad.js';
import { logTwentyStep } from './twenty-sync-log.js';
import { DEFAULT_OPPORTUNITY_STAGE } from './twenty-opportunity.js';

/** Line items at this stage (or null) may be deleted/updated on re-sync. */
export const DELETABLE_LINE_ITEM_STAGE = DEFAULT_OPPORTUNITY_STAGE;

export function isProtectedLineItemStage(stage) {
  return stage != null && stage !== DELETABLE_LINE_ITEM_STAGE;
}

export function computeLineItemDiff(existingLineItems, eligibleItems, { ignoreStageProtection = false } = {}) {
  const isProtected = (stage) => !ignoreStageProtection && isProtectedLineItemStage(stage);
  const eligibleNames = new Set(eligibleItems.map((i) => i.name));
  const existingByName = new Map(existingLineItems.map((li) => [li.name, li]));

  const toUpdate = [];
  const toCreate = [];
  const preserved = [];

  for (const item of eligibleItems) {
    const existing = existingByName.get(item.name);
    if (existing) {
      if (isProtected(existing.stage)) continue;
      toUpdate.push({ twentyId: existing.id, item });
    } else {
      toCreate.push(item);
    }
  }

  const toDelete = [];
  for (const li of existingLineItems) {
    if (eligibleNames.has(li.name)) continue;
    if (isProtected(li.stage)) {
      preserved.push({ id: li.id, name: li.name, stage: li.stage });
      continue;
    }
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
        edges { node { id name stage } }
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
  podryadList = [],
  ignoreStageProtection = false,
}) {
  const { toUpdate, toCreate, toDelete, preserved } = computeLineItemDiff(
    existingLineItems,
    eligibleItems,
    { ignoreStageProtection },
  );

  const lineItemOptions = { deal, restorationList, podryadList };

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

  const zeroed = eligibleItems.filter((i) => isRestorationItem(i.name, restorationList));
  if (zeroed.length) {
    logTwentyStep('line_items.restoration_zero', { names: zeroed.map((i) => i.name) });
  }

  const podryadItems = eligibleItems.filter((i) => isPodryadItem(i.name, podryadList));
  if (podryadItems.length) {
    logTwentyStep('line_items.podryad_tip', { names: podryadItems.map((i) => i.name) });
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
          { deal, restorationList, podryadList }
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
