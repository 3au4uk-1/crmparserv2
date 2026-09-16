import { requireTwentyConfig } from './twenty-config.js';
import { gql, assertHttpSuccess, assertGqlSuccess } from './twenty-gql.js';
import { computeParentMoney } from './deal-groups.js';
import { computeDealItemsTotal } from './twenty-opportunity.js';
import { buildBitrixLinkInput } from './deal-bitrix-links.js';
import { PAYMENT_FIELDS } from './payment-field-names.js';
import { EXPENSE_FIELDS } from './expense-field-names.js';

const CREATE_PARENT = `
  mutation CreateParent($data: OpportunityCreateInput!) {
    createOpportunity(data: $data) { id }
  }
`;

const UPDATE_OPP = `
  mutation UpdateOpp($id: ID!, $data: OpportunityUpdateInput!) {
    updateOpportunity(id: $id, data: $data) { id }
  }
`;

const DELETE_OPP = `
  mutation DeleteOpp($id: ID!) {
    deleteOpportunity(id: $id) { id }
  }
`;

const PARENT_HAS_LINE_ITEMS = `
  query ParentHasLineItems($id: ID!) {
    dealLineItems(filter: { opportunityId: { eq: $id } }, first: 1) {
      edges { node { id } }
    }
  }
`;

function toRub(value) {
  return {
    amountMicros: Math.round((Number(value) || 0) * 1_000_000),
    currencyCode: 'RUB',
  };
}

function loadDateInput(deal) {
  if (!deal?.load_date) return null;
  const time = /^\d{1,2}:\d{2}$/.test(deal.load_time || '') ? deal.load_time : '00:00';
  return `${deal.load_date}T${time.padStart(5, '0')}:00+03:00`;
}

function buildCanonicalLinks(canonical, group) {
  const data = {};
  if (canonical?.tony_order_id) {
    data.tonyLink = {
      primaryLinkUrl: `https://crm.apihide.com/orders/orders_edit/?id=${canonical.tony_order_id}`,
      primaryLinkLabel: `Tony #${canonical.tony_order_id}`,
    };
  }
  if (group.canonical_bitrix_id) {
    const bitrix = buildBitrixLinkInput([
      { bitrixId: group.canonical_bitrix_id, isCanonical: true },
    ]);
    if (bitrix) data.bitrixLink = bitrix;
  }
  return data;
}

function buildParentMoneyInput(money) {
  return {
    amount: toRub(money.amount),
    [PAYMENT_FIELDS.amount]: toRub(money.summaPostupleniy),
    [EXPENSE_FIELDS.total]: toRub(money.rashodItogo),
  };
}

function loadGroupContext(db, groupId) {
  const group = db.prepare('SELECT * FROM deal_groups WHERE id = ?').get(groupId);
  if (!group) {
    const err = new Error(`Deal group ${groupId} not found`);
    err.code = 'GROUP_NOT_FOUND';
    err.status = 404;
    throw err;
  }

  const members = db.prepare(`
    SELECT d.*
    FROM deal_group_members m
    JOIN deals d ON d.id = m.deal_id
    WHERE m.group_id = ?
    ORDER BY d.id
  `).all(groupId);

  const moneyMembers = members.map((deal) => {
    const items = db.prepare('SELECT * FROM deal_items WHERE deal_id = ?').all(deal.id);
    return {
      id: deal.id,
      amountRub: computeDealItemsTotal(deal, items),
      payment_amount: deal.payment_amount,
      rashodItogo: 0,
    };
  });

  const money = computeParentMoney(moneyMembers, group.canonical_deal_id);
  const canonical = members.find((m) => m.id === group.canonical_deal_id) || members[0] || null;

  let companyId = null;
  if (canonical?.company_code) {
    const company = db.prepare(
      'SELECT twenty_id FROM companies WHERE code = ?',
    ).get(canonical.company_code);
    companyId = company?.twenty_id || null;
  }

  return { group, members, money, canonical, companyId };
}

async function gqlOk(twenty, query, variables, fallbackMessage) {
  const resp = await gql(twenty.apiUrl, twenty.apiToken, query, variables);
  assertHttpSuccess(resp, twenty.apiUrl);
  assertGqlSuccess(resp, fallbackMessage);
  return resp;
}

async function attachChildren(twenty, children, parentTwentyId) {
  for (const child of children) {
    await gqlOk(
      twenty,
      UPDATE_OPP,
      { id: child.twenty_id, data: { parentOpportunityId: parentTwentyId } },
      `Failed to set parentOpportunityId on ${child.twenty_id}`,
    );
  }
}

function storeParentId(db, groupId, parentTwentyId) {
  db.prepare(`
    UPDATE deal_groups
    SET twenty_parent_id = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(parentTwentyId, groupId);
}

/**
 * Mirror a confirmed deal group into Twenty: create/update parent opportunity,
 * set parentOpportunityId on children, copy aggregates + canonical links.
 * Persists twenty_parent_id only after children attach succeeds.
 */
export async function mirrorDealGroupToTwenty(db, groupId) {
  const twenty = requireTwentyConfig();
  const { group, members, money, canonical, companyId } = loadGroupContext(db, groupId);
  const children = members.filter((m) => m.twenty_id);

  let parentTwentyId = group.twenty_parent_id || null;
  const createdThisCall = !parentTwentyId;

  if (!parentTwentyId) {
    const createData = {
      name: group.name,
      amount: toRub(money.amount),
      parentOpportunityId: null,
    };
    const loadDate = loadDateInput(canonical);
    if (loadDate) createData.loadDate = loadDate;
    if (companyId) createData.companyId = companyId;

    const resp = await gqlOk(
      twenty,
      CREATE_PARENT,
      { data: createData },
      'Failed to create parent opportunity',
    );
    parentTwentyId = resp.data?.data?.createOpportunity?.id;
    if (!parentTwentyId) {
      throw new Error('Failed to create parent opportunity: missing id');
    }
  }

  // Attach children before storing twenty_parent_id so a failed attach retries cleanly.
  await attachChildren(twenty, children, parentTwentyId);

  if (createdThisCall) {
    storeParentId(db, groupId, parentTwentyId);
  }

  const parentUpdate = {
    name: group.name,
    ...buildParentMoneyInput(money),
    ...buildCanonicalLinks(canonical, group),
  };
  const loadDate = loadDateInput(canonical);
  if (loadDate) parentUpdate.loadDate = loadDate;
  if (companyId) parentUpdate.companyId = companyId;

  await gqlOk(
    twenty,
    UPDATE_OPP,
    { id: parentTwentyId, data: parentUpdate },
    `Failed to update parent opportunity ${parentTwentyId}`,
  );

  return { parentTwentyId };
}

/**
 * Detach children from parent in Twenty, then delete the parent opportunity
 * only when it has no dealLineItems.
 */
export async function clearDealGroupTwenty(db, groupId) {
  const twenty = requireTwentyConfig();
  const group = db.prepare('SELECT * FROM deal_groups WHERE id = ?').get(groupId);
  if (!group) return { deleted: false };

  const children = db.prepare(`
    SELECT d.twenty_id
    FROM deal_group_members m
    JOIN deals d ON d.id = m.deal_id
    WHERE m.group_id = ?
      AND d.twenty_id IS NOT NULL
    ORDER BY d.id
  `).all(groupId);

  for (const child of children) {
    await gqlOk(
      twenty,
      UPDATE_OPP,
      { id: child.twenty_id, data: { parentOpportunityId: null } },
      `Failed to clear parentOpportunityId on ${child.twenty_id}`,
    );
  }

  if (!group.twenty_parent_id) {
    return { deleted: false };
  }

  const check = await gqlOk(
    twenty,
    PARENT_HAS_LINE_ITEMS,
    { id: group.twenty_parent_id },
    `Failed to list line items for parent ${group.twenty_parent_id}`,
  );
  const edges = check.data?.data?.dealLineItems?.edges || [];
  if (edges.length > 0) {
    console.warn(
      `[deal-group-twenty] skip delete parent ${group.twenty_parent_id}: has dealLineItems`,
    );
    return { deleted: false, skippedDelete: true };
  }

  await gqlOk(
    twenty,
    DELETE_OPP,
    { id: group.twenty_parent_id },
    `Failed to delete parent opportunity ${group.twenty_parent_id}`,
  );

  db.prepare(`
    UPDATE deal_groups
    SET twenty_parent_id = NULL, updated_at = datetime('now')
    WHERE id = ?
  `).run(groupId);

  return { deleted: true };
}
