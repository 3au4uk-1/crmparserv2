import { gql, assertHttpSuccess, assertGqlSuccess } from './twenty-gql.js';
import { requireTwentyConfig } from './twenty-config.js';
import { getDb } from '../db/connection.js';
import { buildOpportunityAmountInputFromLineItems } from './twenty-opportunity.js';

export const RECALC_FLAG_KEY = 'opportunity_amount_recalc_v1';
export const RECALC_STARTED_AT_KEY = 'opportunity_amount_recalc_v1_started_at';
export const STALE_RUNNING_MS = 6 * 60 * 60 * 1000;
export const ONE_RUB_MICROS = 1_000_000;

const LIST_LINE_ITEMS_QUERY = `query ListLineItems($oppId: ID!) {
  dealLineItems(filter: { opportunityId: { eq: $oppId } }) {
    edges { node { id name stage istochnik kolichestvo amount { amountMicros currencyCode } } }
  }
}`;

const GET_OPPORTUNITY_AMOUNT_QUERY = `query GetOpportunityAmount($id: ID!) {
  opportunities(filter: { id: { eq: $id } }, first: 1) {
    edges { node { id amount { amountMicros currencyCode } } }
  }
}`;

function readSetting(db, key) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value?.trim() || '';
}

function writeSetting(db, key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

export function resolveRecalcFlagState(db, nowMs = Date.now()) {
  const flag = readSetting(db, RECALC_FLAG_KEY);
  if (flag === 'done') return { shouldRun: false, reason: 'done' };
  if (flag === 'running') {
    const startedAt = readSetting(db, RECALC_STARTED_AT_KEY);
    const startedMs = startedAt ? Date.parse(startedAt) : Number.NaN;
    if (Number.isFinite(startedMs) && nowMs - startedMs < STALE_RUNNING_MS) {
      return { shouldRun: false, reason: 'running' };
    }
    return { shouldRun: true, reason: 'stale_running' };
  }
  if (flag === 'failed') return { shouldRun: true, reason: 'retry_failed' };
  return { shouldRun: true, reason: 'pending' };
}

export function opportunityAmountNeedsUpdate(currentAmount, expectedAmount) {
  const currentMicros = currentAmount?.amountMicros ?? 0;
  const expectedMicros = expectedAmount?.amountMicros ?? 0;
  return Math.abs(currentMicros - expectedMicros) >= ONE_RUB_MICROS;
}

function isHardTwentyError(err) {
  const message = err?.message || String(err);
  return /401|403|not configured|timeout|ECONNREFUSED|ECONNRESET|ECONNABORTED|GraphQL endpoint not found/i.test(message);
}

function listSyncedDeals(db) {
  return db.prepare(`
    SELECT *
    FROM deals
    WHERE twenty_id IS NOT NULL AND TRIM(twenty_id) != ''
    ORDER BY id ASC
  `).all();
}

async function listLineItemsWithAsserts(gqlFn, apiUrl, apiToken, oppId, assertHttp, assertGql) {
  const resp = await gqlFn(apiUrl, apiToken, LIST_LINE_ITEMS_QUERY, { oppId });
  assertHttp(resp, apiUrl);
  assertGql(resp, 'Failed to list line items from Twenty');
  return resp.data?.data?.dealLineItems?.edges?.map((e) => e.node) || [];
}

async function fetchOpportunityAmount(gqlFn, apiUrl, apiToken, oppId, assertHttp, assertGql) {
  const resp = await gqlFn(apiUrl, apiToken, GET_OPPORTUNITY_AMOUNT_QUERY, { id: oppId });
  assertHttp(resp, apiUrl);
  assertGql(resp, 'Failed to fetch opportunity amount from Twenty');
  return resp.data?.data?.opportunities?.edges?.[0]?.node?.amount ?? null;
}

async function updateOpportunityAmountOnly(gqlFn, apiUrl, apiToken, oppId, amount, assertHttp, assertGql) {
  const resp = await gqlFn(
    apiUrl,
    apiToken,
    `mutation UpdateOpportunityAmount($id: ID!, $input: OpportunityUpdateInput!) {
      updateOpportunity(id: $id, data: $input) { id }
    }`,
    { id: oppId, input: { amount } },
  );
  assertHttp(resp, apiUrl);
  assertGql(resp, 'Failed to update opportunity amount in Twenty');
}

export async function recalcOneDeal(deal, deps) {
  const {
    twenty,
    gql: gqlFn,
    assertHttpSuccess: assertHttp,
    assertGqlSuccess: assertGql,
    listLineItems = listLineItemsWithAsserts,
    log = console,
  } = deps;

  const lineItems = await listLineItems(
    gqlFn,
    twenty.apiUrl,
    twenty.apiToken,
    deal.twenty_id,
    assertHttp,
    assertGql,
  );
  const expectedAmount = buildOpportunityAmountInputFromLineItems(lineItems);
  const currentAmount = await fetchOpportunityAmount(
    gqlFn,
    twenty.apiUrl,
    twenty.apiToken,
    deal.twenty_id,
    assertHttp,
    assertGql,
  );

  if (!opportunityAmountNeedsUpdate(currentAmount, expectedAmount)) {
    return { updated: false };
  }

  await updateOpportunityAmountOnly(
    gqlFn,
    twenty.apiUrl,
    twenty.apiToken,
    deal.twenty_id,
    expectedAmount,
    assertHttp,
    assertGql,
  );

  log.info?.('[opportunity-amount-recalc] deal_updated', {
    dealId: deal.id,
    oppId: deal.twenty_id,
    amountMicros: expectedAmount.amountMicros,
  }) ?? log.log?.('[opportunity-amount-recalc] deal_updated', deal.id);

  return { updated: true };
}

export async function runOpportunityAmountRecalcIfNeeded(deps = {}) {
  const {
    getDb: getDbFn = getDb,
    requireTwentyConfig: requireTwenty = requireTwentyConfig,
    gql: gqlFn = gql,
    assertHttpSuccess: assertHttp = assertHttpSuccess,
    assertGqlSuccess: assertGql = assertGqlSuccess,
    listLineItems = listLineItemsWithAsserts,
    now = () => Date.now(),
    log = console,
  } = deps;

  const db = getDbFn();
  const flagState = resolveRecalcFlagState(db, now());
  if (!flagState.shouldRun) {
    return { status: 'skipped', reason: flagState.reason };
  }

  let twenty;
  try {
    twenty = requireTwenty();
  } catch (err) {
    return { status: 'skipped', reason: 'twenty_not_configured', error: err.message };
  }

  writeSetting(db, RECALC_FLAG_KEY, 'running');
  writeSetting(db, RECALC_STARTED_AT_KEY, new Date(now()).toISOString());

  const deals = listSyncedDeals(db);
  let updated = 0;
  let dealsFailed = 0;

  try {
    for (const deal of deals) {
      try {
        const result = await recalcOneDeal(deal, {
          twenty,
          gql: gqlFn,
          assertHttpSuccess: assertHttp,
          assertGqlSuccess: assertGql,
          listLineItems,
          log,
        });
        if (result.updated) updated += 1;
      } catch (err) {
        if (isHardTwentyError(err)) throw err;
        dealsFailed += 1;
        log.error?.('[opportunity-amount-recalc] deal_failed', {
          dealId: deal.id,
          error: err.message,
        }) ?? log.error?.(`[opportunity-amount-recalc] deal_failed deal=${deal.id}: ${err.message}`);
      }
    }

    writeSetting(db, RECALC_FLAG_KEY, 'done');
    return {
      status: 'done',
      reason: flagState.reason,
      dealsTotal: deals.length,
      updated,
      dealsFailed,
    };
  } catch (err) {
    writeSetting(db, RECALC_FLAG_KEY, 'failed');
    return {
      status: 'failed',
      error: err.message,
      dealsTotal: deals.length,
      updated,
      dealsFailed,
    };
  }
}
