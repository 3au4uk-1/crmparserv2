import {
  buildLineItemCreateInput,
  buildLineItemUpdateInput,
} from './twenty-line-item.js';
import { normalizePattern } from './blacklist.js';
import { isRestorationItem } from './restoration.js';
import { isPodryadItem } from './podryad.js';
import { isBannerItem } from './banner.js';
import { logTwentyStep } from './twenty-sync-log.js';
import { DEFAULT_OPPORTUNITY_STAGE } from './twenty-opportunity.js';
import { MANUAL_TWENTY_CLASSIFICATION } from './manual-twenty-line-item.js';

const DEFAULT_MANUAL_LINE_ITEM_NAME = 'Новая позиция';

/** Line items at this stage (or null) may be deleted/updated on re-sync. */
export const DELETABLE_LINE_ITEM_STAGE = DEFAULT_OPPORTUNITY_STAGE;

export function isProtectedLineItemStage(stage) {
  return stage != null && stage !== DELETABLE_LINE_ITEM_STAGE;
}

function isManualTwentyItem(item) {
  return item.classification === MANUAL_TWENTY_CLASSIFICATION && item.twenty_id;
}

function isManualTwentyDraft(li, manualParserTwentyIds) {
  return (
    li.istochnik === 'TWENTY_RUCHNAYA'
    && !manualParserTwentyIds.has(li.id)
    && normalizePattern(li.name) === normalizePattern(DEFAULT_MANUAL_LINE_ITEM_NAME)
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
  const existingByName = new Map(
    existingLineItems.map((li) => [normalizePattern(li.name), li]),
  );

  const toUpdate = [];
  const toCreate = [];

  for (const item of manualItems) {
    const existing = existingById.get(item.twenty_id);
    if (existing) {
      if (isProtected(existing.stage)) continue;
      toUpdate.push({ twentyId: item.twenty_id, item });
    } else {
      toCreate.push(item);
    }
  }

  for (const item of parsedItems) {
    const existing = existingByName.get(normalizePattern(item.name));
    if (existing) {
      if (isProtected(existing.stage)) continue;
      toUpdate.push({ twentyId: existing.id, item });
    } else {
      toCreate.push(item);
    }
  }

  const manualTwentyIds = new Set(manualItems.map((item) => item.twenty_id));
  const parsedEligibleNames = new Set(parsedItems.map((item) => normalizePattern(item.name)));

  const toDelete = [];
  const preserved = [];

  for (const li of existingLineItems) {
    if (manualTwentyIds.has(li.id)) continue;
    if (parsedEligibleNames.has(normalizePattern(li.name))) continue;
    if (isProtected(li.stage)) {
      preserved.push({ id: li.id, name: li.name, stage: li.stage });
      continue;
    }
    if (isManualTwentyDraft(li, manualParserTwentyIds)) continue;
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
  bannerList = [],
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

  const lineItemOptions = { deal, restorationList, podryadList, bannerList };

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

  const bannerItems = eligibleItems.filter((i) => isBannerItem(i.name, bannerList));
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
          { deal, restorationList, podryadList, bannerList }
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
