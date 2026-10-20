export const TWENTY_BATCH_SIZE = 60;

const LINE_ITEM_UPSERT_CAPABILITY_QUERY = `query DealLineItemWriteCapability {
  upsertInput: __type(name: "DealLineItemUpsertInput") { name }
  mutationFields: __type(name: "Mutation") { fields { name } }
}`;

let cachedUpsertSupport = null;
let upsertSupportInflight = null;

export function resetDealLineItemUpsertSupport() {
  cachedUpsertSupport = null;
  upsertSupportInflight = null;
}

export function setDealLineItemUpsertSupport(value) {
  cachedUpsertSupport = value;
  upsertSupportInflight = null;
}

export function dealLineItemUpsertSupported(data) {
  const typeName = data?.upsertInput?.name;
  const fields = data?.mutationFields?.fields || [];
  return Boolean(typeName) && fields.some((field) => field?.name === 'upsertDealLineItems');
}

async function resolveDealLineItemUpsertSupport({
  gql, apiUrl, apiToken, assertHttpSuccess,
}) {
  if (cachedUpsertSupport != null) return cachedUpsertSupport;
  if (!upsertSupportInflight) {
    upsertSupportInflight = (async () => {
      try {
        const resp = await gql(apiUrl, apiToken, LINE_ITEM_UPSERT_CAPABILITY_QUERY, {});
        assertHttpSuccess(resp, apiUrl);
        if (resp.data?.errors?.length) {
          cachedUpsertSupport = false;
          return false;
        }
        cachedUpsertSupport = dealLineItemUpsertSupported(resp.data?.data);
        return cachedUpsertSupport;
      } catch (err) {
        cachedUpsertSupport = false;
        return false;
      } finally {
        upsertSupportInflight = null;
      }
    })();
  }
  return upsertSupportInflight;
}

export function chunk(items, size = TWENTY_BATCH_SIZE) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function isSchemaBatchError(err) {
  const message = err?.message || String(err);
  if (/limit reached|tokens per|429/i.test(message) || err?.status === 429) return false;
  if (/\b5\d\d\b/.test(message) || (err?.status >= 500 && err?.status < 600)) return false;
  if (err?.status === 400 || /HTTP 400\b/.test(message)) return true;
  return /cannot query field|unknown argument|upsertDealLineItems|did not exist|Cannot query|unknown type|DealLineItemUpsertInput/i.test(message);
}

export async function createDealLineItemsBatch({
  gql, apiUrl, apiToken, inputs, assertHttpSuccess, assertGqlSuccess,
}) {
  const created = [];
  for (const part of chunk(inputs, TWENTY_BATCH_SIZE)) {
    const resp = await gql(
      apiUrl,
      apiToken,
      `mutation CreateDealLineItems($data: [DealLineItemCreateInput!]!) {
        createDealLineItems(data: $data) { id }
      }`,
      { data: part },
    );
    assertHttpSuccess(resp, apiUrl);
    assertGqlSuccess(resp, 'Failed to create deal line items in Twenty');
    const rows = resp.data?.data?.createDealLineItems || [];
    if (rows.length !== part.length) {
      throw new Error(`createDealLineItems length mismatch: sent ${part.length}, got ${rows.length}`);
    }
    created.push(...rows);
  }
  return created;
}

export async function deleteDealLineItemsBatch({
  gql, apiUrl, apiToken, ids, assertHttpSuccess, assertGqlSuccess,
}) {
  for (const part of chunk(ids, TWENTY_BATCH_SIZE)) {
    const resp = await gql(
      apiUrl,
      apiToken,
      `mutation DeleteDealLineItems($ids: [ID!]!) {
        deleteDealLineItems(filter: { id: { in: $ids } }) { id }
      }`,
      { ids: part },
    );
    assertHttpSuccess(resp, apiUrl);
    assertGqlSuccess(resp, 'Failed to delete deal line items in Twenty');
  }
}

async function upsertOnce({ gql, apiUrl, apiToken, part, assertHttpSuccess, assertGqlSuccess }) {
  const resp = await gql(
    apiUrl,
    apiToken,
    `mutation UpsertDealLineItems($data: [DealLineItemUpsertInput!]!) {
      upsertDealLineItems(data: $data) { id }
    }`,
    { data: part.map((row) => ({ ...row.data, id: row.id })) },
  );
  assertHttpSuccess(resp, apiUrl);
  assertGqlSuccess(resp, 'Failed to upsert deal line items in Twenty');
  return resp;
}

/**
 * Twenty DirectExecution forbids duplicate root resolver *names* even with
 * GraphQL aliases (`u0: updateDealLineItem` + `u1: updateDealLineItem` →
 * "Duplicate root resolver"). Fallback must be one update per HTTP document.
 */
async function sequentialUpdates({ gql, apiUrl, apiToken, rows, assertHttpSuccess, assertGqlSuccess }) {
  for (const row of rows) {
    const resp = await gql(
      apiUrl,
      apiToken,
      `mutation UpdateDealLineItem($id: ID!, $data: DealLineItemUpdateInput!) {
        updateDealLineItem(id: $id, data: $data) { id }
      }`,
      { id: row.id, data: row.data },
    );
    assertHttpSuccess(resp, apiUrl);
    assertGqlSuccess(resp, 'Failed to update deal line items in Twenty');
  }
}

export async function upsertDealLineItemsBatch(args) {
  const { allowAliasFallback = true } = args;
  let supported = await resolveDealLineItemUpsertSupport(args);
  for (const part of chunk(args.rows, TWENTY_BATCH_SIZE)) {
    if (!supported) {
      await sequentialUpdates({ ...args, rows: part });
      continue;
    }
    try {
      await upsertOnce({ ...args, part });
    } catch (err) {
      if (!allowAliasFallback || !isSchemaBatchError(err)) throw err;
      supported = false;
      setDealLineItemUpsertSupport(false);
      await sequentialUpdates({ ...args, rows: part });
    }
  }
}

export async function updateDealLineItemsSameDataBatch({
  gql, apiUrl, apiToken, ids, data, assertHttpSuccess, assertGqlSuccess,
}) {
  for (const part of chunk(ids, TWENTY_BATCH_SIZE)) {
    const resp = await gql(
      apiUrl,
      apiToken,
      `mutation UpdateDealLineItems($ids: [ID!]!, $data: DealLineItemUpdateInput!) {
        updateDealLineItems(filter: { id: { in: $ids } }, data: $data) { id }
      }`,
      { ids: part, data },
    );
    assertHttpSuccess(resp, apiUrl);
    assertGqlSuccess(resp, 'Failed to batch-update deal line items in Twenty');
  }
}
