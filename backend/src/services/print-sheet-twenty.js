import { formatPlenkaText, lookupFilmsForLineItem } from './print-sheet-lookup.js';
import { V_PECHATI_OPPORTUNITY_STAGE } from './twenty-opportunity.js';

export const V_PECHATI_LINE_ITEM_STAGE = V_PECHATI_OPPORTUNITY_STAGE;

const LIST_IN_PRINT_QUERY = `
  query ListLineItemsInPrintStage($limit: Int!) {
    dealLineItems(
      filter: { stage: { eq: V_PECHATI } }
      first: $limit
    ) {
      edges {
        node {
          id
          name
          stage
          plenka {
            markdown
          }
          opportunity {
            id
            name
            closeDate
          }
        }
      }
    }
  }
`;

const LIST_IN_PRINT_FOR_OPPORTUNITY_QUERY = `
  query ListLineItemsInPrintStageForOpportunity($oppId: UUID!, $limit: Int!) {
    dealLineItems(
      filter: {
        and: [
          { opportunityId: { eq: $oppId } }
          { stage: { eq: V_PECHATI } }
        ]
      }
      first: $limit
    ) {
      edges {
        node {
          id
          name
          stage
          plenka {
            markdown
          }
          opportunity {
            id
            name
            closeDate
          }
        }
      }
    }
  }
`;

const UPDATE_PLENKA_MUTATION = `
  mutation UpdateDealLineItemPlenka($id: ID!, $input: DealLineItemUpdateInput!) {
    updateDealLineItem(id: $id, data: $input) {
      id
      plenka {
        markdown
      }
    }
  }
`;

export async function listLineItemsInPrintStage(gql, limit = 200) {
  const resp = await gql(LIST_IN_PRINT_QUERY, { limit });
  const edges = resp.data?.data?.dealLineItems?.edges || [];
  return edges.map((edge) => edge.node);
}

export async function listLineItemsInPrintStageForOpportunity(gql, opportunityId, limit = 200) {
  const resp = await gql(LIST_IN_PRINT_FOR_OPPORTUNITY_QUERY, {
    oppId: opportunityId,
    limit,
  });
  const edges = resp.data?.data?.dealLineItems?.edges || [];
  return edges.map((edge) => edge.node);
}

export async function updateLineItemPlenka(gql, id, plenkaText) {
  const input = { plenka: { markdown: plenkaText } };
  await gql(UPDATE_PLENKA_MUTATION, { id, input });
}

export async function refreshPlenkaForLineItem(gql, lineItem) {
  const opportunity = lineItem?.opportunity;
  if (!lineItem?.id || !lineItem?.name || !opportunity?.name) {
    return { updated: false, text: '', reason: 'missing line item id, name, or opportunity name' };
  }

  const matches = await lookupFilmsForLineItem(
    opportunity.name,
    opportunity.closeDate,
    lineItem.name
  );
  const text = formatPlenkaText(matches);
  const currentMarkdown = lineItem.plenka?.markdown ?? '';

  if (currentMarkdown === text) {
    return { updated: false, text };
  }

  await updateLineItemPlenka(gql, lineItem.id, text);
  return { updated: true, text };
}

export async function refreshPlenkaForOpportunityLineItems(gql, opportunityId) {
  if (!opportunityId) return { refreshed: 0, updated: 0 };

  const lineItems = await listLineItemsInPrintStageForOpportunity(gql, opportunityId);
  let updated = 0;

  for (const lineItem of lineItems) {
    const result = await refreshPlenkaForLineItem(gql, lineItem);
    if (result.updated) updated += 1;
  }

  return { refreshed: lineItems.length, updated };
}
