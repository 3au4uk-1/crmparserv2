import {
  buildLineItemCreateInput,
  buildLineItemUpdateInput,
  lineItemFieldsEqual,
} from './twenty-line-item.js';
import { normalizePattern } from './blacklist.js';
import { shouldZeroLineItemAmount } from './twenty-opportunity.js';
import { findTipRuleMatch } from './tip-rules.js';
import { logTwentyStep } from './twenty-sync-log.js';
import { CANCELLED_OPPORTUNITY_STAGE, DEFAULT_OPPORTUNITY_STAGE, ZERO_RUB_AMOUNT } from './twenty-opportunity.js';
import { MANUAL_TWENTY_CLASSIFICATION } from './manual-twenty-line-item.js';
import { publishDealLineItemEvent } from './twenty-events/publish-record-event.js';
import {
  createDealLineItemsBatch,
  deleteDealLineItemsBatch,
  upsertDealLineItemsBatch,
  updateDealLineItemsSameDataBatch,
  isSchemaBatchError,
} from './twenty-batch.js';

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
  { ignoreStageProtection = false, manualParserTwentyIds = new Set(), scoped = false } = {},
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
    if (scoped) {
      preserved.push({ id: li.id, name: li.name, stage: li.stage });
      continue;
    }
    toDelete.push(li.id);
  }

  return { toUpdate, toCreate, toDelete, preserved };
}

export function applyFieldSkip(diff, existingLineItems, lineItemOptions = {}) {
  const byId = new Map((existingLineItems || []).map((li) => [li.id, li]));
  const toUpdate = (diff.toUpdate || []).filter(({ twentyId, item }) => {
    const current = byId.get(twentyId);
    const desired = buildLineItemUpdateInput(item, lineItemOptions);
    return !lineItemFieldsEqual(current, desired);
  });
  return { ...diff, toUpdate };
}

export async function listLineItemsForOpportunity(
  gql,
  apiUrl,
  apiToken,
  oppId,
  assertHttpSuccess,
  assertGqlSuccess,
) {
  const resp = await gql(
    apiUrl,
    apiToken,
    `query ListLineItems($oppId: ID!) {
      dealLineItems(filter: { opportunityId: { eq: $oppId } }) {
        edges { node { id name stage istochnik productStream kolichestvo kommentariy tip tipDetail amount { amountMicros currencyCode } } }
      }
    }`,
    { oppId }
  );
  if (assertHttpSuccess) assertHttpSuccess(resp, apiUrl);
  if (assertGqlSuccess) {
    assertGqlSuccess(resp, 'Failed to list line items for opportunity in Twenty');
  }
  return resp.data?.data?.dealLineItems?.edges?.map((e) => e.node) || [];
}

export async function fetchOpportunityAndLineItems(
  gql, apiUrl, apiToken, oppId, assertHttpSuccess, assertGqlSuccess,
) {
  const resp = await gql(
    apiUrl,
    apiToken,
    `query OpportunityAndLineItems($oppId: ID!) {
      opportunities(filter: { id: { eq: $oppId } }, first: 1) {
        edges {
          node {
            id name companyId pointOfContactId closeDate
            arrivalTime readyTime workTime dismantleTime loadDate
            clientAddress
            amount { amountMicros currencyCode }
            summaPostupleniy { amountMicros currencyCode }
            statusOplaty
            tonyLink { primaryLinkUrl }
            bitrixLink { primaryLinkUrl }
          }
        }
      }
      dealLineItems(filter: { opportunityId: { eq: $oppId } }) {
        edges {
          node {
            id name stage istochnik productStream kolichestvo kommentariy tip tipDetail
            amount { amountMicros currencyCode }
          }
        }
      }
    }`,
    { oppId },
  );
  assertHttpSuccess(resp, apiUrl);
  assertGqlSuccess(resp, 'Failed to load opportunity and line items');
  return {
    opportunity: resp.data?.data?.opportunities?.edges?.[0]?.node || null,
    lineItems: resp.data?.data?.dealLineItems?.edges?.map((e) => e.node) || [],
  };
}

export async function updateDealLineItemProductStreams(
  gql,
  apiUrl,
  apiToken,
  lineItemId,
  productStreams,
  assertHttpSuccess,
  assertGqlSuccess,
) {
  const resp = await gql(
    apiUrl,
    apiToken,
    `mutation UpdateDealLineItem($id: ID!, $input: DealLineItemUpdateInput!) {
      updateDealLineItem(id: $id, data: $input) { id }
    }`,
    { id: lineItemId, input: { productStream: productStreams } },
  );
  assertHttpSuccess(resp, apiUrl);
  assertGqlSuccess(resp, `Failed to update productStream for line item "${lineItemId}" in Twenty`);
  return resp.data?.data?.updateDealLineItem ?? null;
}

export async function listLineItemsForRepair(
  gql,
  apiUrl,
  apiToken,
  oppId,
  assertHttpSuccess,
  assertGqlSuccess,
) {
  const resp = await gql(
    apiUrl,
    apiToken,
    `query ListLineItemsForRepair($oppId: ID!) {
      dealLineItems(filter: { opportunityId: { eq: $oppId } }) {
        edges {
          node {
            id
            name
            stage
            istochnik
            kommentariy
            createdAt
            amount { amountMicros currencyCode }
          }
        }
      }
    }`,
    { oppId },
  );
  assertHttpSuccess(resp, apiUrl);
  assertGqlSuccess(resp, 'Failed to list line items for repair in Twenty');
  return resp.data?.data?.dealLineItems?.edges?.map(({ node }) => ({
    id: node.id,
    name: node.name,
    stage: node.stage,
    istochnik: node.istochnik,
    kommentariy: node.kommentariy ?? '',
    createdAt: node.createdAt ?? null,
    amountMicros: node.amount?.amountMicros ?? null,
  })) || [];
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
  const ids = existingLineItems
    .filter((li) => li.stage !== cancelledStage)
    .map((li) => li.id);
  const data = { stage: cancelledStage, amount: ZERO_RUB_AMOUNT };

  if (ids.length) {
    logTwentyStep('line_items.cancel', { count: ids.length });
    try {
      await updateDealLineItemsSameDataBatch({
        gql,
        apiUrl,
        apiToken,
        ids,
        data,
        assertHttpSuccess: assertHttpSuccess || (() => {}),
        assertGqlSuccess: assertGqlSuccess || (() => {}),
      });
    } catch (err) {
      if (!isSchemaBatchError(err)) throw err;
      await upsertDealLineItemsBatch({
        gql,
        apiUrl,
        apiToken,
        rows: ids.map((id) => ({ id, data })),
        assertHttpSuccess: assertHttpSuccess || (() => {}),
        assertGqlSuccess: assertGqlSuccess || (() => {}),
        allowAliasFallback: true,
      });
    }
  }

  return { cancelled: ids.length, total: existingLineItems.length };
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
  scoped = false,
}) {
  const identity = computeLineItemDiff(
    existingLineItems,
    eligibleItems,
    {
      ignoreStageProtection,
      manualParserTwentyIds: getManualParserTwentyIds(db),
      scoped,
    },
  );
  const lineItemOptions = {
    deal,
    restorationList,
    neNasheBrandingList,
    neNasheDecorMkList,
    tipRules,
  };
  const { toUpdate, toCreate, toDelete, preserved } = applyFieldSkip(
    identity,
    existingLineItems,
    lineItemOptions,
  );

  for (const { twentyId, item } of identity.toUpdate) {
    db.prepare('UPDATE deal_items SET twenty_id = ? WHERE id = ?').run(twentyId, item.id);
  }

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

  if (toDelete.length) {
    logTwentyStep('line_items.delete', { count: toDelete.length });
    await deleteDealLineItemsBatch({
      gql,
      apiUrl,
      apiToken,
      ids: toDelete,
      assertHttpSuccess,
      assertGqlSuccess,
    });
    for (const lineItemId of toDelete) {
      publishDealLineItemEvent('DELETED', lineItemId, { before: { id: lineItemId } });
    }
  }

  const toUpdateWithData = toUpdate.map(({ twentyId, item }) => ({
    twentyId,
    item,
    data: buildLineItemUpdateInput(item, lineItemOptions),
  }));
  const createdNodes = [];

  if (toUpdateWithData.length) {
    logTwentyStep('line_items.update', { count: toUpdateWithData.length });
    await upsertDealLineItemsBatch({
      gql,
      apiUrl,
      apiToken,
      rows: toUpdateWithData.map(({ twentyId, data }) => ({
        id: twentyId,
        data,
      })),
      assertHttpSuccess,
      assertGqlSuccess,
    });
    for (const { twentyId, item } of toUpdateWithData) {
      db.prepare('UPDATE deal_items SET twenty_id = ? WHERE id = ?').run(twentyId, item.id);
      publishDealLineItemEvent('UPDATED', twentyId, {
        after: { id: twentyId, opportunityId: oppId, name: item.name },
      });
    }
  }

  if (toCreate.length) {
    logTwentyStep('line_items.create', { count: toCreate.length });
    const warehouseIdsByName = new Map();
    for (const item of toCreate) {
      if (!warehouseIdsByName.has(item.name)) {
        warehouseIdsByName.set(
          item.name,
          await findOrCreateWarehouseItem(apiUrl, apiToken, item.name),
        );
      }
    }
    const inputs = toCreate.map((item, index) => buildLineItemCreateInput(
      item,
      warehouseIdsByName.get(item.name),
      oppId,
      index === 0 ? 'first' : index,
      lineItemOptions,
    ));
    const created = await createDealLineItemsBatch({
      gql,
      apiUrl,
      apiToken,
      inputs,
      assertHttpSuccess,
      assertGqlSuccess,
    });
    for (let i = 0; i < toCreate.length; i += 1) {
      const item = toCreate[i];
      const lineItemId = created[i].id;
      const input = inputs[i];
      createdNodes.push({
        id: lineItemId,
        amount: input.amount,
        kolichestvo: input.kolichestvo,
        stage: DEFAULT_OPPORTUNITY_STAGE,
      });
      db.prepare('UPDATE deal_items SET twenty_id = ? WHERE id = ?').run(lineItemId, item.id);
      publishDealLineItemEvent('CREATED', lineItemId, {
        after: { id: lineItemId, opportunityId: oppId, name: item.name },
      });
    }
  }

  return {
    updated: toUpdateWithData.length,
    created: toCreate.length,
    deleted: toDelete.length,
    toUpdate: toUpdateWithData,
    toCreate,
    toDelete,
    createdNodes,
  };
}
