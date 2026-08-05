import { config } from '../config.js';
import { getDb } from '../db/connection.js';
import { getTwentyConfig, requireTwentyConfig } from './twenty-config.js';
import { loadProductStreamContext } from './twenty-items.js';
import { loadRestorationList, isRestorationItem } from './restoration.js';
import { loadNeNasheBrandingList, isNeNasheBrandingItem } from './ne-nashe-branding.js';
import { loadNeNasheDecorMkList, isNeNasheDecorMkItem } from './ne-nashe-decor-mk.js';
import { loadTipRules, findTipRuleMatch } from './tip-rules.js';
import { buildOpportunityAmountInputFromLineItems, buildOpportunityInput, computeDealItemsTotal, computeLineItemTotal, DEFAULT_OPPORTUNITY_STAGE, CANCELLED_OPPORTUNITY_STAGE, ZERO_RUB_AMOUNT } from './twenty-opportunity.js';
import {
  getItemsForTwenty,
  getItemEligibleReason,
} from './twenty-items.js';
import { buildWarehouseItemCreateInput } from './twenty-line-item.js';
import {
  cancelLineItemsForOpportunity,
  listLineItemsForOpportunity,
  syncLineItemsDiff,
} from './twenty-line-items-sync.js';
import {
  beginTwentySyncContext,
  endTwentySyncContext,
  logTwenty,
  logTwentyStep,
} from './twenty-sync-log.js';
import { createTwentyGqlClient, gql } from './twenty-gql.js';
import { runPrintSheetRefresh as runPrintSheetRefreshLocked } from './print-sheet-runner.js';

function assertHttpSuccess(resp, apiUrl) {
  if (resp.status === 404) {
    throw new Error(
      `Twenty GraphQL endpoint not found (${apiUrl}). ` +
      'Use URL вида https://your-domain/graphql (не /rest).'
    );
  }
  if (resp.status === 401 || resp.status === 403) {
    throw new Error('Twenty API: неверный токен или нет доступа (401/403)');
  }
  if (resp.status >= 400) {
    throw new Error(`Twenty API error: HTTP ${resp.status}`);
  }
}

function assertGqlSuccess(resp, fallbackMessage) {
  const errors = resp.data?.errors;
  if (errors?.length) {
    throw new Error(errors[0].message || fallbackMessage);
  }
}

function getOpportunityStage() {
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = 'opportunity_stage'").get();
  return row?.value?.trim() || DEFAULT_OPPORTUNITY_STAGE;
}

function logSyncRun(dealId, status, twentyId, error, action = null) {
  const db = getDb();
  db.prepare(
    'INSERT INTO sync_runs (deal_id, status, action, twenty_id, error) VALUES (?, ?, ?, ?, ?)'
  ).run(dealId, status, action, twentyId || null, error || null);
}

async function refreshPrintSheetAfterSync(_twenty, oppId) {
  if (!oppId) return;

  try {
    const result = await runPrintSheetRefreshLocked();
    logTwentyStep('print_sheet.refresh.done', { oppId, ...(result || {}) });
  } catch (err) {
    logTwenty('warn', 'print_sheet.refresh.failed', {
      oppId,
      error: err.message,
    });
  }
}

export async function runPrintSheetRefresh() {
  try {
    const result = await runPrintSheetRefreshLocked();
    if (result) {
      logTwentyStep('print_sheet.refresh.done', { bulk: true, ...result });
    }
    return result;
  } catch (err) {
    logTwenty('warn', 'print_sheet.refresh.failed', { bulk: true, error: err.message });
    throw err;
  }
}

async function findOrCreateWarehouseItem(apiUrl, apiToken, name, warehouseCache) {
  if (warehouseCache?.has(name)) {
    return warehouseCache.get(name);
  }

  const searchResp = await gql(
    apiUrl,
    apiToken,
    `query FindWarehouseItem($name: String!) {
      products(filter: { name: { eq: $name } }) { edges { node { id } } }
    }`,
    { name }
  );
  assertHttpSuccess(searchResp, apiUrl);
  assertGqlSuccess(searchResp, 'Failed to search warehouse item in Twenty');

  const existing = searchResp.data?.data?.products?.edges?.[0]?.node;
  if (existing) {
    warehouseCache?.set(name, existing.id);
    return existing.id;
  }

  const createResp = await gql(
    apiUrl,
    apiToken,
    `mutation CreateWarehouseItem($input: ProductCreateInput!) {
      createProduct(data: $input) { id }
    }`,
    { input: buildWarehouseItemCreateInput(name) }
  );
  assertHttpSuccess(createResp, apiUrl);
  assertGqlSuccess(createResp, `Failed to create warehouse item "${name}" in Twenty`);

  const newId = createResp.data?.data?.createProduct?.id;
  if (!newId) throw new Error(`Failed to create warehouse item "${name}" in Twenty`);
  warehouseCache?.set(name, newId);
  return newId;
}

async function findOrCreateCompany(apiUrl, apiToken, code) {
  const db = getDb();
  const company = db.prepare('SELECT * FROM companies WHERE code = ?').get(code);
  if (!company) return null;

  if (company.twenty_id) return company.twenty_id;

  const searchResp = await gql(
    apiUrl,
    apiToken,
    `query FindCompany($name: String!) {
      companies(filter: { name: { eq: $name } }) { edges { node { id } } }
    }`,
    { name: company.full_name }
  );
  assertHttpSuccess(searchResp, apiUrl);
  assertGqlSuccess(searchResp, 'Failed to search company in Twenty');

  const existing = searchResp.data?.data?.companies?.edges?.[0]?.node;
  if (existing) {
    db.prepare('UPDATE companies SET twenty_id = ? WHERE id = ?').run(existing.id, company.id);
    return existing.id;
  }

  const createResp = await gql(
    apiUrl,
    apiToken,
    `mutation CreateCompany($input: CompanyCreateInput!) {
      createCompany(data: $input) { id }
    }`,
    { input: { name: company.full_name } }
  );
  assertHttpSuccess(createResp, apiUrl);
  assertGqlSuccess(createResp, 'Failed to create company in Twenty');

  const newId = createResp.data?.data?.createCompany?.id;
  if (newId) {
    db.prepare('UPDATE companies SET twenty_id = ? WHERE id = ?').run(newId, company.id);
  }
  return newId;
}

async function findOrCreatePerson(apiUrl, apiToken, managerName, companyTwentyId) {
  const db = getDb();

  const manager = db.prepare('SELECT * FROM managers WHERE name = ?').get(managerName);
  if (manager?.twenty_id) return manager.twenty_id;

  const searchResp = await gql(
    apiUrl,
    apiToken,
    `query FindPerson($lastName: String!) {
      people(filter: { name: { lastName: { eq: $lastName } } }) { edges { node { id } } }
    }`,
    { lastName: managerName }
  );
  assertHttpSuccess(searchResp, apiUrl);
  assertGqlSuccess(searchResp, 'Failed to search person in Twenty');

  const existing = searchResp.data?.data?.people?.edges?.[0]?.node;
  if (existing) {
    if (manager) {
      db.prepare('UPDATE managers SET twenty_id = ? WHERE id = ?').run(existing.id, manager.id);
    } else {
      db.prepare('INSERT INTO managers (name, twenty_id) VALUES (?, ?)').run(managerName, existing.id);
    }
    return existing.id;
  }

  const input = {
    name: { lastName: managerName, firstName: '' },
  };
  if (companyTwentyId) input.companyId = companyTwentyId;

  const createResp = await gql(
    apiUrl,
    apiToken,
    `mutation CreatePerson($input: PersonCreateInput!) {
      createPerson(data: $input) { id }
    }`,
    { input }
  );
  assertHttpSuccess(createResp, apiUrl);
  assertGqlSuccess(createResp, 'Failed to create person in Twenty');

  const newId = createResp.data?.data?.createPerson?.id;
  if (newId) {
    if (manager) {
      db.prepare('UPDATE managers SET twenty_id = ? WHERE id = ?').run(newId, manager.id);
    } else {
      db.prepare('INSERT INTO managers (name, twenty_id) VALUES (?, ?)').run(managerName, newId);
    }
  }
  return newId;
}

async function resolveCompanyAndPerson(deal, twenty) {
  const companyTwentyId = deal.company_code
    ? await findOrCreateCompany(twenty.apiUrl, twenty.apiToken, deal.company_code)
    : null;

  const personTwentyId = deal.manager_name
    ? await findOrCreatePerson(twenty.apiUrl, twenty.apiToken, deal.manager_name, companyTwentyId)
    : null;

  return { companyTwentyId, personTwentyId };
}

function createLineItemSyncDeps(warehouseCache) {
  return {
    gql,
    assertHttpSuccess,
    assertGqlSuccess,
    findOrCreateWarehouseItem: (apiUrl, apiToken, name) =>
      findOrCreateWarehouseItem(apiUrl, apiToken, name, warehouseCache),
  };
}

async function updateOpportunityAmountFromLineItems(twenty, oppId) {
  const lineItems = await listLineItemsForOpportunity(
    gql, twenty.apiUrl, twenty.apiToken, oppId,
  );
  const amount = buildOpportunityAmountInputFromLineItems(lineItems);

  logTwentyStep('sync.opportunity_amount', {
    oppId,
    amountMicros: amount.amountMicros,
    lineItemCount: lineItems.length,
  });

  const resp = await gql(
    twenty.apiUrl,
    twenty.apiToken,
    `mutation UpdateOpportunity($id: ID!, $input: OpportunityUpdateInput!) {
      updateOpportunity(id: $id, data: $input) { id }
    }`,
    { id: oppId, input: { amount } },
  );
  assertHttpSuccess(resp, twenty.apiUrl);
  assertGqlSuccess(resp, 'Failed to update opportunity amount in Twenty');
}

async function updateDealInTwenty(
  dealId,
  deal,
  items,
  twenty,
  restorationList,
  neNasheBrandingList,
  neNasheDecorMkList,
  tipRules,
  { ignoreLineItemStageProtection = false } = {},
) {
  const db = getDb();
  const oppId = deal.twenty_id;

  logTwentyStep('update.resolve_company_person', {
    companyCode: deal.company_code || null,
    managerName: deal.manager_name || null,
  });

  const { companyTwentyId, personTwentyId } = await resolveCompanyAndPerson(deal, twenty);

  logTwentyStep('update.resolve_company_person.done', {
    companyTwentyId,
    personTwentyId,
  });

  const oppInput = buildOpportunityInput(deal, items, {
    includeStage: false,
    companyTwentyId,
    personTwentyId,
    restorationList,
    neNasheBrandingList,
    neNasheDecorMkList,
  });

  logTwentyStep('update.opportunity', {
    oppId,
    eligibleItems: items.length,
    amountMicros: oppInput.amount?.amountMicros,
  });

  const oppResp = await gql(
    twenty.apiUrl,
    twenty.apiToken,
    `mutation UpdateOpportunity($id: ID!, $input: OpportunityUpdateInput!) {
      updateOpportunity(id: $id, data: $input) { id }
    }`,
    { id: oppId, input: oppInput }
  );
  assertHttpSuccess(oppResp, twenty.apiUrl);
  assertGqlSuccess(oppResp, 'Failed to update opportunity in Twenty');

  logTwentyStep('update.list_line_items', { oppId });

  const existingLineItems = await listLineItemsForOpportunity(
    gql, twenty.apiUrl, twenty.apiToken, oppId
  );

  logTwentyStep('update.line_items_diff', {
    existingCount: existingLineItems.length,
    eligibleCount: items.length,
  });

  const warehouseCache = new Map();
  await syncLineItemsDiff({
    ...createLineItemSyncDeps(warehouseCache),
    apiUrl: twenty.apiUrl,
    apiToken: twenty.apiToken,
    oppId,
    eligibleItems: items,
    existingLineItems,
    db,
    deal,
    restorationList,
    neNasheBrandingList,
    neNasheDecorMkList,
    tipRules,
    ignoreStageProtection: ignoreLineItemStageProtection,
  });

  await updateOpportunityAmountFromLineItems(twenty, oppId);

  const action = items.length === 0 ? 'updated_empty' : 'updated';

  db.prepare(`
    UPDATE deals SET synced_at = datetime('now'), twenty_error = NULL WHERE id = ?
  `).run(dealId);

  logSyncRun(dealId, 'success', oppId, null, action);
  logTwentyStep('update.done', { action, itemCount: items.length });
  return { twentyId: oppId, action, itemCount: items.length };
}

async function createDealInTwenty(
  dealId,
  deal,
  items,
  twenty,
  restorationList,
  neNasheBrandingList,
  neNasheDecorMkList,
  tipRules,
) {
  const db = getDb();

  const { companyTwentyId, personTwentyId } = await resolveCompanyAndPerson(deal, twenty);

  const oppInput = buildOpportunityInput(deal, items, {
    includeStage: true,
    stage: getOpportunityStage(),
    companyTwentyId,
    personTwentyId,
    restorationList,
    neNasheBrandingList,
    neNasheDecorMkList,
  });

  const oppResp = await gql(
    twenty.apiUrl,
    twenty.apiToken,
    `mutation CreateOpportunity($input: OpportunityCreateInput!) {
      createOpportunity(data: $input) { id }
    }`,
    { input: oppInput }
  );
  assertHttpSuccess(oppResp, twenty.apiUrl);
  assertGqlSuccess(oppResp, 'Failed to create opportunity in Twenty');

  const oppId = oppResp.data?.data?.createOpportunity?.id;
  if (!oppId) throw new Error('Failed to create opportunity in Twenty');

  const warehouseCache = new Map();
  await syncLineItemsDiff({
    ...createLineItemSyncDeps(warehouseCache),
    apiUrl: twenty.apiUrl,
    apiToken: twenty.apiToken,
    oppId,
    eligibleItems: items,
    existingLineItems: [],
    db,
    deal,
    restorationList,
    neNasheBrandingList,
    neNasheDecorMkList,
    tipRules,
  });

  await updateOpportunityAmountFromLineItems(twenty, oppId);

  db.prepare(`
    UPDATE deals SET
      twenty_id = ?,
      twenty_stage = ?,
      synced_at = datetime('now'),
      approval_status = 'synced',
      twenty_error = NULL
    WHERE id = ?
  `).run(oppId, getOpportunityStage(), dealId);

  logSyncRun(dealId, 'success', oppId, null, 'created');
  return { twentyId: oppId, action: 'created', itemCount: items.length };
}

export function buildSyncPreview(dealId) {
  const twenty = getTwentyConfig();
  const db = getDb();
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(dealId);
  if (!deal) throw new Error(`Deal ${dealId} not found`);

  const allItems = db.prepare('SELECT * FROM deal_items WHERE deal_id = ?').all(dealId);
  const streamContext = loadProductStreamContext(db);
  const restorationList = loadRestorationList(db);
  const neNasheBrandingList = loadNeNasheBrandingList(db);
  const neNasheDecorMkList = loadNeNasheDecorMkList(db);
  const tipRules = loadTipRules(db);
  const neNasheLists = { neNasheBrandingList, neNasheDecorMkList };
  const eligibleItems = getItemsForTwenty(allItems, streamContext);
  const eligibleAmount = computeDealItemsTotal(deal, eligibleItems, restorationList, neNasheLists);

  return {
    configured: Boolean(twenty.apiUrl && twenty.apiToken),
    configSource: twenty.source,
    apiUrl: twenty.apiUrl || null,
    eligibleCount: eligibleItems.length,
    totalCount: allItems.length,
    eligibleAmount,
    eligibleItems: eligibleItems.map((item) => {
      const tipHit = findTipRuleMatch(item.name, tipRules);
      return {
        id: item.id,
        name: item.name,
        reason: getItemEligibleReason(item, streamContext),
        productStream: item.productStream || null,
        twentyLineAmount: computeLineItemTotal(item, deal, restorationList, neNasheLists),
        restorationMatch: isRestorationItem(item.name, restorationList),
        neNasheBrandingMatch: isNeNasheBrandingItem(item.name, neNasheBrandingList),
        neNasheDecorMkMatch: isNeNasheDecorMkItem(item.name, neNasheDecorMkList),
        tipRuleMatch: Boolean(tipHit),
        podryadMatch: tipHit?.tip === 'PODRYAD',
        bannerMatch: tipHit?.tip === 'BANNERA',
      };
    }),
    alreadySynced: Boolean(deal.twenty_id),
    twentyId: deal.twenty_id || null,
    twentyError: deal.twenty_error || null,
  };
}

export async function resyncDealIfSynced(dealId) {
  const db = getDb();
  const deal = db.prepare('SELECT twenty_id FROM deals WHERE id = ?').get(dealId);
  if (!deal?.twenty_id) return null;
  return syncDealToTwenty(dealId, { ignoreLineItemStageProtection: true });
}

export async function syncDealToTwenty(
  dealId,
  { skipPrintSheetRefresh = false, ignoreLineItemStageProtection = false } = {},
) {
  const twenty = requireTwentyConfig();
  const db = getDb();
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(dealId);
  if (!deal) throw new Error(`Deal ${dealId} not found`);

  const allItems = db.prepare('SELECT * FROM deal_items WHERE deal_id = ?').all(dealId);
  const streamContext = loadProductStreamContext(db);
  const restorationList = loadRestorationList(db);
  const neNasheBrandingList = loadNeNasheBrandingList(db);
  const neNasheDecorMkList = loadNeNasheDecorMkList(db);
  const tipRules = loadTipRules(db);
  const items = getItemsForTwenty(allItems, streamContext);
  const mode = deal.twenty_id ? 'update' : 'create';

  beginTwentySyncContext({
    dealId,
    twentyId: deal.twenty_id || null,
    mode,
    title: deal.title,
  });

  logTwentyStep('sync.start', {
    mode,
    apiUrl: twenty.apiUrl,
    configSource: twenty.source,
    timeoutMs: config.twentyApiTimeoutMs,
    totalItems: allItems.length,
    eligibleItems: items.length,
    eligibleNames: items.map((i) => i.name).slice(0, 10),
  });

  try {
    let result;
    if (deal.twenty_id) {
      result = await updateDealInTwenty(
        dealId,
        deal,
        items,
        twenty,
        restorationList,
        neNasheBrandingList,
        neNasheDecorMkList,
        tipRules,
        { ignoreLineItemStageProtection },
      );
    } else {
      if (items.length === 0) {
        const message = 'Нет позиций для переноса в Twenty';
        db.prepare("UPDATE deals SET twenty_error = ? WHERE id = ?").run(message, dealId);
        logSyncRun(dealId, 'failed', null, message, 'created');
        logTwenty('warn', 'sync.aborted', { reason: message });
        throw new Error(message);
      }

      result = await createDealInTwenty(
        dealId,
        deal,
        items,
        twenty,
        restorationList,
        neNasheBrandingList,
        neNasheDecorMkList,
        tipRules,
      );
    }

    if (!skipPrintSheetRefresh) {
      await refreshPrintSheetAfterSync(twenty, result.twentyId);
    }
    return result;
  } catch (err) {
    logTwenty('error', 'sync.failed', { mode, error: err.message });
    if (deal.twenty_id) {
      db.prepare("UPDATE deals SET twenty_error = ? WHERE id = ?").run(err.message, dealId);
      logSyncRun(dealId, 'failed', deal.twenty_id, err.message, 'updated');
    } else {
      db.prepare("UPDATE deals SET twenty_error = ? WHERE id = ?").run(err.message, dealId);
      logSyncRun(dealId, 'failed', null, err.message, 'created');
    }
    throw err;
  } finally {
    endTwentySyncContext();
  }
}

export async function restoreDealInTwenty(dealId) {
  const twenty = requireTwentyConfig();
  const db = getDb();
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(dealId);
  if (!deal) throw new Error(`Deal ${dealId} not found`);
  if (!deal.twenty_id) return null;
  if (deal.twenty_stage !== CANCELLED_OPPORTUNITY_STAGE) {
    return { twentyId: deal.twenty_id, action: 'restored', skipped: true };
  }

  const stage = deal.pre_cancel_opportunity_stage || getOpportunityStage();
  let snapshot = [];
  if (deal.line_item_stage_snapshot_json) {
    try {
      snapshot = JSON.parse(deal.line_item_stage_snapshot_json);
      if (!Array.isArray(snapshot)) snapshot = [];
    } catch {
      snapshot = [];
    }
  }

  beginTwentySyncContext({
    dealId,
    twentyId: deal.twenty_id,
    mode: 'restore',
    title: deal.title,
  });

  logTwentyStep('restore.start', { oppId: deal.twenty_id, stage, lineItemCount: snapshot.length });

  try {
    const oppResp = await gql(
      twenty.apiUrl,
      twenty.apiToken,
      `mutation RestoreOpportunity($id: ID!, $input: OpportunityUpdateInput!) {
        updateOpportunity(id: $id, data: $input) { id }
      }`,
      { id: deal.twenty_id, input: { stage } }
    );
    assertHttpSuccess(oppResp, twenty.apiUrl);
    assertGqlSuccess(oppResp, 'Failed to restore opportunity in Twenty');

    const existingLineItems = await listLineItemsForOpportunity(
      gql,
      twenty.apiUrl,
      twenty.apiToken,
      deal.twenty_id,
    );
    const existingLineItemIds = new Set(existingLineItems.map((li) => li.id));

    for (const entry of snapshot) {
      if (!entry?.id) continue;
      if (!existingLineItemIds.has(entry.id)) {
        logTwentyStep('restore.line_item_skipped', { lineItemId: entry.id });
        continue;
      }
      const resp = await gql(
        twenty.apiUrl,
        twenty.apiToken,
        `mutation UpdateDealLineItem($id: ID!, $input: DealLineItemUpdateInput!) {
          updateDealLineItem(id: $id, data: $input) { id }
        }`,
        { id: entry.id, input: { stage: entry.stage ?? null } }
      );
      assertHttpSuccess(resp, twenty.apiUrl);
      assertGqlSuccess(resp, `Failed to restore line item ${entry.id} in Twenty`);
      if (!resp.data?.data?.updateDealLineItem?.id) {
        logTwentyStep('restore.line_item_skipped', { lineItemId: entry.id });
        continue;
      }
    }

    db.prepare(`
      UPDATE deals SET
        twenty_stage = ?,
        status = NULL,
        pre_cancel_opportunity_stage = NULL,
        line_item_stage_snapshot_json = NULL,
        calendar_miss_streak = 0,
        synced_at = datetime('now'),
        twenty_error = NULL,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(stage, dealId);

    logSyncRun(dealId, 'success', deal.twenty_id, null, 'restored');
    logTwentyStep('restore.done', { oppId: deal.twenty_id, stage });
    return { twentyId: deal.twenty_id, action: 'restored', stage };
  } catch (err) {
    logTwenty('error', 'restore.failed', { error: err.message });
    db.prepare("UPDATE deals SET twenty_error = ? WHERE id = ?").run(err.message, dealId);
    logSyncRun(dealId, 'failed', deal.twenty_id, err.message, 'restored');
    throw err;
  } finally {
    endTwentySyncContext();
  }
}

export async function cancelDealInTwenty(dealId) {
  const twenty = requireTwentyConfig();
  const db = getDb();
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(dealId);
  if (!deal) throw new Error(`Deal ${dealId} not found`);
  if (!deal.twenty_id) return null;
  if (deal.twenty_stage === CANCELLED_OPPORTUNITY_STAGE) {
    return { twentyId: deal.twenty_id, action: 'cancelled', skipped: true };
  }

  beginTwentySyncContext({
    dealId,
    twentyId: deal.twenty_id,
    mode: 'cancel',
    title: deal.title,
  });

  logTwentyStep('cancel.start', { oppId: deal.twenty_id });

  try {
    const existingLineItems = await listLineItemsForOpportunity(
      gql,
      twenty.apiUrl,
      twenty.apiToken,
      deal.twenty_id,
    );

    const existingSnapshot = deal.line_item_stage_snapshot_json;
    if (!existingSnapshot) {
      const snapshot = existingLineItems.map((li) => ({ id: li.id, stage: li.stage ?? null }));
      const snapshotWrite = db.prepare(`
        UPDATE deals
        SET pre_cancel_opportunity_stage = ?,
            line_item_stage_snapshot_json = ?
        WHERE id = ?
          AND (line_item_stage_snapshot_json IS NULL OR line_item_stage_snapshot_json = '')
      `).run(deal.twenty_stage ?? null, JSON.stringify(snapshot), dealId);
      if (snapshotWrite.changes > 0) {
        logTwentyStep('cancel.snapshot', {
          lineItemCount: snapshot.length,
          opportunityStage: deal.twenty_stage ?? null,
        });
      }
    }

    const oppResp = await gql(
      twenty.apiUrl,
      twenty.apiToken,
      `mutation CancelOpportunity($id: ID!, $input: OpportunityUpdateInput!) {
        updateOpportunity(id: $id, data: $input) { id }
      }`,
      { id: deal.twenty_id, input: { stage: CANCELLED_OPPORTUNITY_STAGE, amount: ZERO_RUB_AMOUNT } }
    );
    assertHttpSuccess(oppResp, twenty.apiUrl);
    assertGqlSuccess(oppResp, 'Failed to cancel opportunity in Twenty');

    const lineItemCancel = await cancelLineItemsForOpportunity(
      gql,
      twenty.apiUrl,
      twenty.apiToken,
      deal.twenty_id,
      { assertHttpSuccess, assertGqlSuccess },
    );
    logTwentyStep('cancel.line_items', lineItemCancel);

    db.prepare(`
      UPDATE deals SET
        twenty_stage = ?,
        status = ?,
        synced_at = datetime('now'),
        twenty_error = NULL,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(CANCELLED_OPPORTUNITY_STAGE, 'отмена', dealId);

    logSyncRun(dealId, 'success', deal.twenty_id, null, 'cancelled');
    logTwentyStep('cancel.done', { oppId: deal.twenty_id });
    return { twentyId: deal.twenty_id, action: 'cancelled' };
  } catch (err) {
    logTwenty('error', 'cancel.failed', { error: err.message });
    db.prepare("UPDATE deals SET twenty_error = ? WHERE id = ?").run(err.message, dealId);
    logSyncRun(dealId, 'failed', deal.twenty_id, err.message, 'cancelled');
    throw err;
  } finally {
    endTwentySyncContext();
  }
}
