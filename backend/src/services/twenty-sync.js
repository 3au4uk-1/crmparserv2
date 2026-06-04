import axios from 'axios';
import { config } from '../config.js';
import { getDb } from '../db/connection.js';

function gql(query, variables = {}) {
  return axios.post(
    config.twentyApiUrl,
    { query, variables },
    {
      headers: {
        'Authorization': `Bearer ${config.twentyApiToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    }
  );
}

async function findOrCreateCompany(code) {
  const db = getDb();
  const company = db.prepare('SELECT * FROM companies WHERE code = ?').get(code);
  if (!company) return null;

  if (company.twenty_id) return company.twenty_id;

  const searchResp = await gql(`
    query { companies(filter: { name: { eq: "${company.full_name}" } }) { edges { node { id } } } }
  `);

  const existing = searchResp.data?.data?.companies?.edges?.[0]?.node;
  if (existing) {
    db.prepare('UPDATE companies SET twenty_id = ? WHERE id = ?').run(existing.id, company.id);
    return existing.id;
  }

  const createResp = await gql(`
    mutation($input: CompanyCreateInput!) { createCompany(data: $input) { id } }
  `, { input: { name: company.full_name } });

  const newId = createResp.data?.data?.createCompany?.id;
  if (newId) {
    db.prepare('UPDATE companies SET twenty_id = ? WHERE id = ?').run(newId, company.id);
  }
  return newId;
}

async function findOrCreatePerson(managerName, companyTwentyId) {
  const db = getDb();

  const manager = db.prepare(
    'SELECT * FROM managers WHERE name = ?'
  ).get(managerName);

  if (manager?.twenty_id) return manager.twenty_id;

  const searchResp = await gql(`
    query { people(filter: { name: { lastName: { eq: "${managerName}" } } }) { edges { node { id } } } }
  `);

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

  const createResp = await gql(`
    mutation($input: PersonCreateInput!) { createPerson(data: $input) { id } }
  `, { input });

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

export async function syncDealToTwenty(dealId) {
  if (!config.twentyApiUrl || !config.twentyApiToken) {
    throw new Error('Twenty CRM not configured');
  }

  const db = getDb();
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(dealId);
  if (!deal) throw new Error(`Deal ${dealId} not found`);
  if (deal.twenty_id) return { twentyId: deal.twenty_id, action: 'already_synced' };

  const items = db.prepare(
    "SELECT * FROM deal_items WHERE deal_id = ? AND classification IN ('keyword_match', 'llm_confirmed')"
  ).all(dealId);

  const companyTwentyId = deal.company_code
    ? await findOrCreateCompany(deal.company_code)
    : null;

  const personTwentyId = deal.manager_name
    ? await findOrCreatePerson(deal.manager_name, companyTwentyId)
    : null;

  const brandingBudget = items.reduce((sum, i) => sum + (i.price || 0), 0);

  const oppInput = {
    name: deal.title || `Deal ${deal.crm_event_id}`,
    stage: 'NEW',
    closeDate: deal.end_date || deal.start_date || new Date().toISOString(),
    amount: { amountMicros: Math.round(brandingBudget * 1000000), currencyCode: 'RUB' },
  };
  if (companyTwentyId) oppInput.companyId = companyTwentyId;
  if (personTwentyId) oppInput.pointOfContactId = personTwentyId;

  const oppResp = await gql(`
    mutation($input: OpportunityCreateInput!) { createOpportunity(data: $input) { id } }
  `, { input: oppInput });

  const oppId = oppResp.data?.data?.createOpportunity?.id;
  if (!oppId) throw new Error('Failed to create opportunity in Twenty');

  if (items.length > 0) {
    const itemsText = items
      .map(i => `• ${i.name} — ${i.price?.toLocaleString('ru-RU')} руб. × ${i.quantity}`)
      .join('\n');

    await gql(`
      mutation($input: NoteCreateInput!) { createNote(data: $input) { id } }
    `, {
      input: {
        title: 'Позиции брендинга',
        body: itemsText,
        activityTargets: [{ opportunityId: oppId }],
      },
    });
  }

  db.prepare(
    "UPDATE deals SET twenty_id = ?, synced_at = datetime('now'), approval_status = 'synced' WHERE id = ?"
  ).run(oppId, dealId);

  return { twentyId: oppId, action: 'created' };
}
