import { normalizePattern } from './blacklist.js';
import { gql, assertHttpSuccess, assertGqlSuccess } from './twenty-gql.js';
import { requireTwentyConfig } from './twenty-config.js';
import { getDb } from '../db/connection.js';
import { listLineItemsForRepair } from './twenty-line-items-sync.js';
import { getItemsForTwenty, loadProductStreamContext } from './twenty-items.js';
import { computeDealItemsTotal } from './twenty-opportunity.js';
import { loadRestorationList } from './restoration.js';
import { loadNeNasheBrandingList } from './ne-nashe-branding.js';
import { loadNeNasheDecorMkList } from './ne-nashe-decor-mk.js';

export const REPAIR_FLAG_KEY = 'free_entry_duplicate_repair_v1';
export const REPAIR_STARTED_AT_KEY = 'free_entry_duplicate_repair_v1_started_at';
export const STALE_RUNNING_MS = 6 * 60 * 60 * 1000;

const FREE_ENTRY_RE = /свободная запись/i;
const DISAMBIG_SUFFIX_RE = / \((#\d+)\)$/;

export function isFreeEntryTemplateName(name) {
  return FREE_ENTRY_RE.test(name ?? '');
}

function commentToLineItemName(kommentariy) {
  const text = String(kommentariy ?? '').trim();
  if (!text) return null;
  const firstLine = text.split(/\r?\n/)[0]?.trim() ?? '';
  return firstLine || null;
}

export function planTwentyFreeEntryRename(li) {
  if (!isFreeEntryTemplateName(li?.name)) return null;
  const name = commentToLineItemName(li.kommentariy);
  if (!name) return null;
  return { id: li.id, name, kommentariy: '' };
}

function getBaseName(name) {
  const trimmed = String(name ?? '').trim();
  const match = trimmed.match(/^(.+?) \((#\d+)\)$/);
  return match ? match[1] : trimmed;
}

function compareLineItems(a, b) {
  const aTime = a.createdAt ?? '';
  const bTime = b.createdAt ?? '';
  if (aTime !== bTime) return aTime < bTime ? -1 : 1;
  const aId = String(a.id ?? '');
  const bId = String(b.id ?? '');
  return aId < bId ? -1 : aId > bId ? 1 : 0;
}

export function planTwentyNameDisambiguation(lineItems) {
  const sorted = [...lineItems].sort(compareLineItems);
  const groups = new Map();

  for (const item of sorted) {
    const base = getBaseName(item.name);
    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push(item);
  }

  const plan = [];
  for (const items of groups.values()) {
    if (items.length <= 1) continue;
    items.forEach((item, index) => {
      const base = getBaseName(items[0].name);
      const expected =
        index === 0 ? base : `${base} (#${index + 1})`;
      const current = String(item.name ?? '').trim();
      if (current === expected) return;
      if (index > 0 && DISAMBIG_SUFFIX_RE.test(current)) return;
      plan.push({ id: item.id, name: expected });
    });
  }

  return plan;
}

function findTwentyMatch(local, twentyItems, claimedTwentyIds) {
  const localName = String(local.name ?? '').trim();
  const localBase = getBaseName(localName);

  let exact = null;
  let base = null;
  for (const twenty of twentyItems) {
    if (claimedTwentyIds.has(twenty.id)) continue;
    const twentyName = String(twenty.name ?? '').trim();
    if (twentyName === localName) {
      exact = twenty;
      break;
    }
    if (!base && getBaseName(twentyName) === localBase) {
      base = twenty;
    }
  }

  return exact ?? base ?? null;
}

export function planLocalTwentyIdUntangle(localItems, twentyItems) {
  const byTwentyId = new Map();
  for (const local of localItems) {
    if (!local.twenty_id) continue;
    if (!byTwentyId.has(local.twenty_id)) byTwentyId.set(local.twenty_id, []);
    byTwentyId.get(local.twenty_id).push(local);
  }

  const claimedTwentyIds = new Set();
  const assignments = new Map();

  for (const local of localItems) {
    const dupCount = byTwentyId.get(local.twenty_id)?.length ?? 0;
    if (dupCount <= 1) {
      assignments.set(local.id, local.twenty_id ?? null);
      if (local.twenty_id) claimedTwentyIds.add(local.twenty_id);
    }
  }

  for (const group of byTwentyId.values()) {
    if (group.length <= 1) continue;
    const sorted = [...group].sort((a, b) => {
      const lockDiff = (b.amount_locked ? 1 : 0) - (a.amount_locked ? 1 : 0);
      if (lockDiff !== 0) return lockDiff;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    const [winner, ...losers] = sorted;
    assignments.set(winner.id, winner.twenty_id);
    claimedTwentyIds.add(winner.twenty_id);

    for (const loser of losers) {
      const match = findTwentyMatch(loser, twentyItems, claimedTwentyIds);
      const nextId = match?.id ?? null;
      assignments.set(loser.id, nextId);
      if (nextId) claimedTwentyIds.add(nextId);
    }
  }

  const plan = [];
  for (const local of localItems) {
    if (!assignments.has(local.id)) continue;
    const nextId = assignments.get(local.id);
    if (nextId !== (local.twenty_id ?? null)) {
      plan.push({ localId: local.id, twenty_id: nextId });
    }
  }

  for (const local of localItems) {
    const dupCount = byTwentyId.get(local.twenty_id)?.length ?? 0;
    if (dupCount <= 1) continue;
    const nextId = assignments.get(local.id);
    if (nextId === local.twenty_id && !plan.some((p) => p.localId === local.id)) {
      plan.push({ localId: local.id, twenty_id: nextId });
    }
  }

  return plan;
}

function hasDuplicateNormalizedNames(items) {
  const seen = new Map();
  for (const item of items) {
    const key = normalizePattern(item.name);
    if (!key) continue;
    seen.set(key, (seen.get(key) || 0) + 1);
    if (seen.get(key) >= 2) return true;
  }
  return false;
}

function hasDuplicateTwentyIds(localItems) {
  const seen = new Set();
  for (const item of localItems) {
    if (!item.twenty_id) continue;
    if (seen.has(item.twenty_id)) return true;
    seen.add(item.twenty_id);
  }
  return false;
}

export function dealNeedsFreeEntryRepair({ localItems, twentyItems }) {
  const locals = localItems ?? [];
  const twenties = twentyItems ?? [];

  if (locals.some((item) => isFreeEntryTemplateName(item.name))) return true;
  if (twenties.some((item) => isFreeEntryTemplateName(item.name))) return true;
  if (hasDuplicateTwentyIds(locals)) return true;
  if (hasDuplicateNormalizedNames(locals)) return true;
  if (hasDuplicateNormalizedNames(twenties)) return true;
  return false;
}

function readSetting(db, key) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value?.trim() || '';
}

function writeSetting(db, key, value) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

export function resolveRepairFlagState(db, nowMs = Date.now()) {
  const flag = readSetting(db, REPAIR_FLAG_KEY);
  if (flag === 'done') return { shouldRun: false, reason: 'done' };
  if (flag === 'running') {
    const startedAt = readSetting(db, REPAIR_STARTED_AT_KEY);
    const startedMs = startedAt ? Date.parse(startedAt) : Number.NaN;
    if (Number.isFinite(startedMs) && nowMs - startedMs < STALE_RUNNING_MS) {
      return { shouldRun: false, reason: 'running' };
    }
    return { shouldRun: true, reason: 'stale_running' };
  }
  if (flag === 'failed') return { shouldRun: true, reason: 'retry_failed' };
  return { shouldRun: true, reason: 'pending' };
}

function isHardTwentyError(err) {
  const message = err?.message || String(err);
  return /401|403|not configured|timeout|ECONNREFUSED|ECONNRESET|GraphQL endpoint not found|Twenty API/i.test(message);
}

function listSyncedDeals(db) {
  return db.prepare(`
    SELECT *
    FROM deals
    WHERE twenty_id IS NOT NULL AND TRIM(twenty_id) != ''
    ORDER BY id ASC
  `).all();
}

function applyPlanToLineItems(lineItems, updates) {
  const byId = new Map(lineItems.map((item) => [item.id, { ...item }]));
  for (const update of updates) {
    const current = byId.get(update.id);
    if (!current) continue;
    if (update.name != null) current.name = update.name;
    if (update.kommentariy !== undefined) current.kommentariy = update.kommentariy;
  }
  return [...byId.values()];
}

async function mutateDealLineItem(gqlFn, apiUrl, apiToken, id, input, assertHttp, assertGql) {
  const resp = await gqlFn(
    apiUrl,
    apiToken,
    `mutation UpdateDealLineItem($id: ID!, $input: DealLineItemUpdateInput!) {
      updateDealLineItem(id: $id, data: $input) { id }
    }`,
    { id, input },
  );
  assertHttp(resp, apiUrl);
  assertGql(resp, `Failed to update line item ${id} in Twenty`);
}

async function updateOpportunityAmount(
  gqlFn,
  apiUrl,
  apiToken,
  oppId,
  amountRubles,
  assertHttp,
  assertGql,
) {
  const resp = await gqlFn(
    apiUrl,
    apiToken,
    `mutation UpdateOpportunityAmount($id: ID!, $input: OpportunityUpdateInput!) {
      updateOpportunity(id: $id, data: $input) { id }
    }`,
    {
      id: oppId,
      input: {
        amount: {
          amountMicros: Math.round(amountRubles * 1_000_000),
          currencyCode: 'RUB',
        },
      },
    },
  );
  assertHttp(resp, apiUrl);
  assertGql(resp, 'Failed to update opportunity amount in Twenty');
}

export async function repairOneDeal(deal, deps) {
  const {
    db,
    twenty,
    gql: gqlFn,
    assertHttpSuccess: assertHttp,
    assertGqlSuccess: assertGql,
    listLineItems = listLineItemsForRepair,
    loadStreamContext = loadProductStreamContext,
    loadRestoration = loadRestorationList,
    loadNeNasheBranding = loadNeNasheBrandingList,
    loadNeNasheDecorMk = loadNeNasheDecorMkList,
    log = console,
  } = deps;

  let twentyItems = await listLineItems(
    gqlFn,
    twenty.apiUrl,
    twenty.apiToken,
    deal.twenty_id,
  );
  const localItems = db.prepare('SELECT * FROM deal_items WHERE deal_id = ?').all(deal.id);

  if (!dealNeedsFreeEntryRepair({ localItems, twentyItems })) {
    return { skipped: true };
  }

  const renamePlan = twentyItems
    .map((item) => planTwentyFreeEntryRename(item))
    .filter(Boolean);
  for (const update of renamePlan) {
    await mutateDealLineItem(
      gqlFn,
      twenty.apiUrl,
      twenty.apiToken,
      update.id,
      { name: update.name, kommentariy: update.kommentariy },
      assertHttp,
      assertGql,
    );
  }
  twentyItems = applyPlanToLineItems(twentyItems, renamePlan);

  const disambigPlan = planTwentyNameDisambiguation(twentyItems);
  for (const update of disambigPlan) {
    await mutateDealLineItem(
      gqlFn,
      twenty.apiUrl,
      twenty.apiToken,
      update.id,
      { name: update.name },
      assertHttp,
      assertGql,
    );
  }
  twentyItems = applyPlanToLineItems(twentyItems, disambigPlan);

  const untanglePlan = planLocalTwentyIdUntangle(localItems, twentyItems);
  for (const { localId, twenty_id: nextTwentyId } of untanglePlan) {
    db.prepare('UPDATE deal_items SET twenty_id = ? WHERE id = ?').run(nextTwentyId, localId);
  }

  const refreshedItems = db.prepare('SELECT * FROM deal_items WHERE deal_id = ?').all(deal.id);
  const streamContext = loadStreamContext(db);
  const restorationList = loadRestoration(db);
  const neNasheBrandingList = loadNeNasheBranding(db);
  const neNasheDecorMkList = loadNeNasheDecorMk(db);
  const neNasheLists = { neNasheBrandingList, neNasheDecorMkList };
  const eligibleItems = getItemsForTwenty(refreshedItems, streamContext);
  const amount = computeDealItemsTotal(deal, eligibleItems, restorationList, neNasheLists);

  await updateOpportunityAmount(
    gqlFn,
    twenty.apiUrl,
    twenty.apiToken,
    deal.twenty_id,
    amount,
    assertHttp,
    assertGql,
  );

  log.info?.('[free-entry-repair] deal_repaired', { dealId: deal.id, oppId: deal.twenty_id })
    ?? log.log?.('[free-entry-repair] deal_repaired', deal.id);

  return { skipped: false, renamed: renamePlan.length, disambiguated: disambigPlan.length, untangled: untanglePlan.length };
}

export async function runFreeEntryDuplicateRepairIfNeeded(deps = {}) {
  const {
    getDb: getDbFn = getDb,
    requireTwentyConfig: requireTwenty = requireTwentyConfig,
    gql: gqlFn = gql,
    assertHttpSuccess: assertHttp = assertHttpSuccess,
    assertGqlSuccess: assertGql = assertGqlSuccess,
    listLineItems = listLineItemsForRepair,
    loadStreamContext = loadProductStreamContext,
    loadRestoration = loadRestorationList,
    loadNeNasheBranding = loadNeNasheBrandingList,
    loadNeNasheDecorMk = loadNeNasheDecorMkList,
    now = () => Date.now(),
    log = console,
  } = deps;

  const db = getDbFn();
  const flagState = resolveRepairFlagState(db, now());
  if (!flagState.shouldRun) {
    return { status: 'skipped', reason: flagState.reason };
  }

  let twenty;
  try {
    twenty = requireTwenty();
  } catch (err) {
    return { status: 'skipped', reason: 'twenty_not_configured', error: err.message };
  }

  writeSetting(db, REPAIR_FLAG_KEY, 'running');
  writeSetting(db, REPAIR_STARTED_AT_KEY, new Date(now()).toISOString());

  const deals = listSyncedDeals(db);
  let dealsProcessed = 0;
  let dealsSkipped = 0;
  let dealsFailed = 0;

  try {
    for (const deal of deals) {
      try {
        const result = await repairOneDeal(deal, {
          db,
          twenty,
          gql: gqlFn,
          assertHttpSuccess: assertHttp,
          assertGqlSuccess: assertGql,
          listLineItems,
          loadStreamContext,
          loadRestoration,
          loadNeNasheBranding,
          loadNeNasheDecorMk,
          log,
        });
        if (result.skipped) dealsSkipped += 1;
        else dealsProcessed += 1;
      } catch (err) {
        if (isHardTwentyError(err)) throw err;
        dealsFailed += 1;
        log.error?.('[free-entry-repair] deal_failed', { dealId: deal.id, error: err.message })
          ?? log.error?.(`[free-entry-repair] deal_failed deal=${deal.id}: ${err.message}`);
      }
    }

    writeSetting(db, REPAIR_FLAG_KEY, 'done');
    return {
      status: 'done',
      reason: flagState.reason,
      dealsTotal: deals.length,
      dealsProcessed,
      dealsSkipped,
      dealsFailed,
    };
  } catch (err) {
    writeSetting(db, REPAIR_FLAG_KEY, 'failed');
    return {
      status: 'failed',
      error: err.message,
      dealsTotal: deals.length,
      dealsProcessed,
      dealsSkipped,
      dealsFailed,
    };
  }
}
