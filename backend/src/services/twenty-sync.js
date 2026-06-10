import axios from 'axios';
import { config } from '../config.js';
import { getDb } from '../db/connection.js';
import { getTwentyConfig, requireTwentyConfig } from './twenty-config.js';
import { loadBlacklist } from './blacklist.js';
import {
  getItemsForTwenty,
  getItemEligibleReason,
} from './twenty-items.js';
import { buildWarehouseItemCreateInput } from './twenty-line-item.js';
import { buildOpportunityInput, DEFAULT_OPPORTUNITY_STAGE } from './twenty-opportunity.js';
import {
  listLineItemsForOpportunity,
  syncLineItemsDiff,
} from './twenty-line-items-sync.js';
import {
  beginTwentySyncContext,
  endTwentySyncContext,
  logTwenty,
  logTwentyStep,
  parseGqlOperation,
  summarizeGqlVariables,
} from './twenty-sync-log.js';
import {
  acquireTwentyRateLimitSlot,
  isTwentyRateLimitError,
  parseTwentyRateLimitWaitMs,
} from './twenty-rate-limit.js';

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTimeoutError(err) {
  return err.code === 'ECONNABORTED' || /timeout/i.test(err.message || '');
}

async function gql(apiUrl, apiToken, query, variables = {}, attempt = 0) {
  const maxAttempts = 5;
  const timeoutMs = config.twentyApiTimeoutMs;
  const operation = parseGqlOperation(query);
  const startedAt = Date.now();

  logTwenty('info', `gql request start`, {
    operation,
    attempt: attempt + 1,
    maxAttempts,
    timeoutMs,
    apiUrl,
    variables: summarizeGqlVariables(variables),
  });

  try {
    await acquireTwentyRateLimitSlot();

    const resp = await axios.post(
      apiUrl,
      { query, variables },
      {
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        timeout: timeoutMs,
        validateStatus: () => true,
      }
    );

    const durationMs = Date.now() - startedAt;
    const gqlErrors = resp.data?.errors?.map((e) => e.message) || [];
    const rateLimitMessage = gqlErrors.find(isTwentyRateLimitError);

    if ((resp.status === 429 || rateLimitMessage) && attempt < maxAttempts - 1) {
      const waitMs = rateLimitMessage
        ? parseTwentyRateLimitWaitMs(rateLimitMessage)
        : config.twentyApiRateLimitWindowMs;
      logTwenty('warn', `gql rate limited, retrying`, {
        operation,
        attempt: attempt + 1,
        maxAttempts,
        waitMs,
        httpStatus: resp.status,
      });
      await delay(waitMs);
      return gql(apiUrl, apiToken, query, variables, attempt + 1);
    }

    logTwenty('info', `gql request done`, {
      operation,
      attempt: attempt + 1,
      durationMs,
      httpStatus: resp.status,
      gqlErrors: gqlErrors.length ? gqlErrors : undefined,
    });

    return resp;
  } catch (err) {
    const durationMs = Date.now() - startedAt;

    if (isTimeoutError(err) && attempt < maxAttempts - 1) {
      const waitMs = 2000 * (attempt + 1);
      logTwenty('warn', `gql timeout, retrying`, {
        operation,
        attempt: attempt + 1,
        maxAttempts,
        durationMs,
        waitMs,
        apiUrl,
      });
      await delay(waitMs);
      return gql(apiUrl, apiToken, query, variables, attempt + 1);
    }

    logTwenty('error', `gql request failed`, {
      operation,
      attempt: attempt + 1,
      maxAttempts,
      durationMs,
      apiUrl,
      error: err.message,
      code: err.code,
      variables: summarizeGqlVariables(variables),
    });

    if (isTimeoutError(err)) {
      throw new Error(
        `Twenty API timeout on ${operation} after ${maxAttempts} attempts (${timeoutMs}ms each, apiUrl=${apiUrl})`
      );
    }
    throw new Error(`${operation}: ${err.message || 'Twenty API request failed'}`);
  }
}

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

async function updateDealInTwenty(dealId, deal, items, twenty) {
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
  });

  const action = items.length === 0 ? 'updated_empty' : 'updated';

  db.prepare(`
    UPDATE deals SET synced_at = datetime('now'), twenty_error = NULL WHERE id = ?
  `).run(dealId);

  logSyncRun(dealId, 'success', oppId, null, action);
  logTwentyStep('update.done', { action, itemCount: items.length });
  return { twentyId: oppId, action, itemCount: items.length };
}

async function createDealInTwenty(dealId, deal, items, twenty) {
  const db = getDb();

  const { companyTwentyId, personTwentyId } = await resolveCompanyAndPerson(deal, twenty);

  const oppInput = buildOpportunityInput(deal, items, {
    includeStage: true,
    stage: getOpportunityStage(),
    companyTwentyId,
    personTwentyId,
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
  });

  db.prepare(`
    UPDATE deals SET
      twenty_id = ?,
      synced_at = datetime('now'),
      approval_status = 'synced',
      twenty_error = NULL
    WHERE id = ?
  `).run(oppId, dealId);

  logSyncRun(dealId, 'success', oppId, null, 'created');
  return { twentyId: oppId, action: 'created', itemCount: items.length };
}

export function buildSyncPreview(dealId) {
  const twenty = getTwentyConfig();
  const db = getDb();
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(dealId);
  if (!deal) throw new Error(`Deal ${dealId} not found`);

  const allItems = db.prepare('SELECT * FROM deal_items WHERE deal_id = ?').all(dealId);
  const blacklist = loadBlacklist(db);
  const eligibleItems = getItemsForTwenty(allItems, blacklist);
  const eligibleAmount = eligibleItems.reduce((sum, i) => sum + (i.price || 0), 0);

  return {
    configured: Boolean(twenty.apiUrl && twenty.apiToken),
    configSource: twenty.source,
    apiUrl: twenty.apiUrl || null,
    eligibleCount: eligibleItems.length,
    totalCount: allItems.length,
    eligibleAmount,
    eligibleItems: eligibleItems.map((item) => ({
      id: item.id,
      name: item.name,
      reason: getItemEligibleReason(item, blacklist),
    })),
    alreadySynced: Boolean(deal.twenty_id),
    twentyId: deal.twenty_id || null,
    twentyError: deal.twenty_error || null,
  };
}

export async function syncDealToTwenty(dealId) {
  const twenty = requireTwentyConfig();
  const db = getDb();
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(dealId);
  if (!deal) throw new Error(`Deal ${dealId} not found`);

  const allItems = db.prepare('SELECT * FROM deal_items WHERE deal_id = ?').all(dealId);
  const blacklist = loadBlacklist(db);
  const items = getItemsForTwenty(allItems, blacklist);
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
    if (deal.twenty_id) {
      return await updateDealInTwenty(dealId, deal, items, twenty);
    }

    if (items.length === 0) {
      const message = 'Нет позиций для переноса в Twenty';
      db.prepare("UPDATE deals SET twenty_error = ? WHERE id = ?").run(message, dealId);
      logSyncRun(dealId, 'failed', null, message, 'created');
      logTwenty('warn', 'sync.aborted', { reason: message });
      throw new Error(message);
    }

    return await createDealInTwenty(dealId, deal, items, twenty);
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
