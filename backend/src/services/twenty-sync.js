import axios from 'axios';
import { getDb } from '../db/connection.js';
import { getTwentyConfig, requireTwentyConfig } from './twenty-config.js';
import {
  getItemsForTwenty,
  getItemEligibleReason,
  enrichDealItems,
} from './twenty-items.js';
import {
  buildWarehouseItemCreateInput,
  buildLineItemCreateInput,
  buildLineItemUpdateInput,
} from './twenty-line-item.js';

async function gql(apiUrl, apiToken, query, variables = {}) {
  try {
    return await axios.post(
      apiUrl,
      { query, variables },
      {
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
        validateStatus: () => true,
      }
    );
  } catch (err) {
    throw new Error(err.message || 'Twenty API request failed');
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
  return row?.value?.trim() || 'NEW';
}

function logSyncRun(dealId, status, twentyId, error) {
  const db = getDb();
  db.prepare(
    'INSERT INTO sync_runs (deal_id, status, twenty_id, error) VALUES (?, ?, ?, ?)'
  ).run(dealId, status, twentyId || null, error || null);
}

async function findOrCreateWarehouseItem(apiUrl, apiToken, name) {
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
  if (existing) return existing.id;

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
  return newId;
}

async function findLineItemByNameAndOpp(apiUrl, apiToken, name, oppId) {
  const resp = await gql(
    apiUrl,
    apiToken,
    `query FindLineItem($name: String!, $oppId: ID!) {
      dealLineItems(filter: { and: [
        { name: { eq: $name } },
        { opportunityId: { eq: $oppId } }
      ]}) { edges { node { id } } }
    }`,
    { name, oppId }
  );
  assertHttpSuccess(resp, apiUrl);
  assertGqlSuccess(resp, 'Failed to search line item in Twenty');
  return resp.data?.data?.dealLineItems?.edges?.[0]?.node?.id || null;
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

export function buildSyncPreview(dealId) {
  const twenty = getTwentyConfig();
  const db = getDb();
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(dealId);
  if (!deal) throw new Error(`Deal ${dealId} not found`);

  const allItems = db.prepare('SELECT * FROM deal_items WHERE deal_id = ?').all(dealId);
  const eligibleItems = getItemsForTwenty(allItems);
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
      reason: getItemEligibleReason(item),
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
  if (deal.twenty_id) return { twentyId: deal.twenty_id, action: 'already_synced' };

  const allItems = db.prepare('SELECT * FROM deal_items WHERE deal_id = ?').all(dealId);
  const items = getItemsForTwenty(allItems);

  if (items.length === 0) {
    const message = 'Нет позиций для переноса в Twenty';
    db.prepare("UPDATE deals SET twenty_error = ? WHERE id = ?").run(message, dealId);
    logSyncRun(dealId, 'failed', null, message);
    throw new Error(message);
  }

  try {
    const companyTwentyId = deal.company_code
      ? await findOrCreateCompany(twenty.apiUrl, twenty.apiToken, deal.company_code)
      : null;

    const personTwentyId = deal.manager_name
      ? await findOrCreatePerson(twenty.apiUrl, twenty.apiToken, deal.manager_name, companyTwentyId)
      : null;

    const brandingBudget = items.reduce((sum, i) => sum + (i.price || 0), 0);

    const oppInput = {
      name: deal.title || `Deal ${deal.crm_event_id}`,
      stage: getOpportunityStage(),
      closeDate: deal.start_date || deal.end_date || new Date().toISOString(),
      amount: { amountMicros: Math.round(brandingBudget * 1000000), currencyCode: 'RUB' },
    };
    if (companyTwentyId) oppInput.companyId = companyTwentyId;
    if (personTwentyId) oppInput.pointOfContactId = personTwentyId;

    if (deal.tony_order_id) {
      oppInput.tonyLink = {
        primaryLinkUrl: `https://crm.apihide.com/orders/orders_edit/?id=${deal.tony_order_id}`,
        primaryLinkLabel: `Tony #${deal.tony_order_id}`,
      };
    }
    if (deal.crm_lead_id) {
      const leadId = deal.crm_lead_id.trim();
      oppInput.bitrixLink = {
        primaryLinkUrl: `https://prointeractive.bitrix24.ru/crm/deal/details/${leadId}/`,
        primaryLinkLabel: `Bitrix #${leadId}`,
      };
    }

    if (deal.arrival_time) oppInput.arrivalTime = deal.arrival_time;
    if (deal.ready_time) oppInput.readyTime = deal.ready_time;
    if (deal.work_time) oppInput.workTime = deal.work_time;
    if (deal.dismantle_time) oppInput.dismantleTime = deal.dismantle_time;

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

    const lineItemIds = [];
    for (let i = 0; i < items.length; i++) {
      const warehouseItemId = await findOrCreateWarehouseItem(
        twenty.apiUrl, twenty.apiToken, items[i].name
      );

      const existingId = await findLineItemByNameAndOpp(
        twenty.apiUrl, twenty.apiToken, items[i].name, oppId
      );

      let lineItemId;
      if (existingId) {
        const updateResp = await gql(
          twenty.apiUrl,
          twenty.apiToken,
          `mutation UpdateDealLineItem($id: ID!, $input: DealLineItemUpdateInput!) {
            updateDealLineItem(id: $id, data: $input) { id }
          }`,
          { id: existingId, input: buildLineItemUpdateInput(items[i]) }
        );
        assertHttpSuccess(updateResp, twenty.apiUrl);
        assertGqlSuccess(updateResp, `Failed to update line item "${items[i].name}" in Twenty`);
        lineItemId = existingId;
      } else {
        const createResp = await gql(
          twenty.apiUrl,
          twenty.apiToken,
          `mutation CreateDealLineItem($input: DealLineItemCreateInput!) {
            createDealLineItem(data: $input) { id }
          }`,
          { input: buildLineItemCreateInput(items[i], warehouseItemId, oppId, i === 0 ? 'first' : i) }
        );
        assertHttpSuccess(createResp, twenty.apiUrl);
        assertGqlSuccess(createResp, `Failed to create line item "${items[i].name}" in Twenty`);
        lineItemId = createResp.data?.data?.createDealLineItem?.id;
        if (!lineItemId) throw new Error(`Failed to create line item "${items[i].name}" in Twenty`);
      }

      lineItemIds.push(lineItemId);
      db.prepare('UPDATE deal_items SET twenty_id = ? WHERE id = ?').run(lineItemId, items[i].id);
    }

    db.prepare(`
      UPDATE deals SET
        twenty_id = ?,
        synced_at = datetime('now'),
        approval_status = 'synced',
        twenty_error = NULL
      WHERE id = ?
    `).run(oppId, dealId);

    logSyncRun(dealId, 'success', oppId, null);

    return { twentyId: oppId, action: 'created', itemCount: items.length, lineItemIds };
  } catch (err) {
    db.prepare("UPDATE deals SET twenty_error = ? WHERE id = ?").run(err.message, dealId);
    logSyncRun(dealId, 'failed', null, err.message);
    throw err;
  }
}

export { enrichDealItems };
