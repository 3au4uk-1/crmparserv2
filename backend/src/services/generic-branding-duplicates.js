import { isGenericBrandingName } from './tony-mapping.js';
import { deleteDealLineItemsBatch } from './twenty-batch.js';

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isParserCreated(item) {
  const source = item?.istochnik;
  return source == null || source === '' || source === 'PARSER';
}

function sameQtyAndAmount(generic, real) {
  const genericQty = finiteNumber(generic.kolichestvo);
  const realQty = finiteNumber(real.kolichestvo);
  const genericAmount = finiteNumber(generic.amount?.amountMicros);
  const realAmount = finiteNumber(real.amount?.amountMicros);
  if (genericQty == null || realQty == null || genericAmount == null || realAmount == null) return false;
  return genericQty === realQty && genericAmount === realAmount;
}

/**
 * Parser-created «Брендинг» / «Брендинг (#N)» rows that sit next to a
 * real-named line item with the same quantity and amount.
 */
export function planGenericBrandingDuplicates(lineItems) {
  const items = lineItems || [];
  const reals = items.filter((item) => !isGenericBrandingName(item?.name));
  const duplicates = [];
  for (const generic of items) {
    if (!isGenericBrandingName(generic?.name) || !isParserCreated(generic)) continue;
    const match = reals.find((real) => sameQtyAndAmount(generic, real));
    if (!match) continue;
    duplicates.push({
      id: generic.id,
      name: generic.name,
      kolichestvo: finiteNumber(generic.kolichestvo),
      amountMicros: finiteNumber(generic.amount?.amountMicros),
      equivalentId: match.id,
      equivalentName: match.name,
    });
  }
  return duplicates;
}

export async function cleanupGenericBrandingDuplicates({
  db,
  gql,
  apiUrl,
  apiToken,
  assertHttpSuccess,
  assertGqlSuccess,
  listLineItems,
  deleteDuplicates = false,
}) {
  const deals = db.prepare(`
    SELECT id, title, twenty_id, tony_order_id
    FROM deals
    WHERE twenty_id IS NOT NULL AND TRIM(twenty_id) != ''
    ORDER BY id ASC
  `).all();

  const duplicates = [];
  for (const deal of deals) {
    const lineItems = await listLineItems(gql, apiUrl, apiToken, deal.twenty_id, assertHttpSuccess, assertGqlSuccess);
    for (const row of planGenericBrandingDuplicates(lineItems)) {
      duplicates.push({
        dealId: deal.id,
        twentyOpportunityId: deal.twenty_id,
        orderId: deal.tony_order_id || null,
        title: deal.title || '',
        ...row,
      });
    }
  }

  if (!deleteDuplicates) {
    return { dryRun: true, count: duplicates.length, duplicates };
  }

  const ids = duplicates.map((row) => row.id).filter(Boolean);
  if (ids.length) {
    await deleteDealLineItemsBatch({
      gql,
      apiUrl,
      apiToken,
      ids,
      assertHttpSuccess,
      assertGqlSuccess,
    });
  }
  return { dryRun: false, count: ids.length, deleted: ids.length, duplicates };
}
