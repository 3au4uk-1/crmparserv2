import {
  buildLineItemCreateInput,
  buildLineItemUpdateInput,
} from './twenty-line-item.js';

export function computeLineItemDiff(existingLineItems, eligibleItems) {
  const eligibleNames = new Set(eligibleItems.map((i) => i.name));
  const existingByName = new Map(existingLineItems.map((li) => [li.name, li]));

  const toUpdate = [];
  const toCreate = [];

  for (const item of eligibleItems) {
    const existing = existingByName.get(item.name);
    if (existing) {
      toUpdate.push({ twentyId: existing.id, item });
    } else {
      toCreate.push(item);
    }
  }

  const toDelete = existingLineItems
    .filter((li) => !eligibleNames.has(li.name))
    .map((li) => li.id);

  return { toUpdate, toCreate, toDelete };
}

export async function listLineItemsForOpportunity(gql, apiUrl, apiToken, oppId) {
  const resp = await gql(
    apiUrl,
    apiToken,
    `query ListLineItems($oppId: ID!) {
      dealLineItems(filter: { opportunityId: { eq: $oppId } }) {
        edges { node { id name } }
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
}) {
  const { toUpdate, toCreate, toDelete } = computeLineItemDiff(
    existingLineItems,
    eligibleItems
  );

  for (const lineItemId of toDelete) {
    const resp = await deleteLineItem(gql, apiUrl, apiToken, lineItemId);
    assertHttpSuccess(resp, apiUrl);
    assertGqlSuccess(resp, 'Failed to delete line item in Twenty');
  }

  for (const { twentyId, item } of toUpdate) {
    const resp = await gql(
      apiUrl,
      apiToken,
      `mutation UpdateDealLineItem($id: ID!, $input: DealLineItemUpdateInput!) {
        updateDealLineItem(id: $id, data: $input) { id }
      }`,
      { id: twentyId, input: buildLineItemUpdateInput(item) }
    );
    assertHttpSuccess(resp, apiUrl);
    assertGqlSuccess(resp, `Failed to update line item "${item.name}" in Twenty`);
    db.prepare('UPDATE deal_items SET twenty_id = ? WHERE id = ?').run(twentyId, item.id);
  }

  let position = 0;
  for (const item of toCreate) {
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
          position === 0 ? 'first' : position
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
