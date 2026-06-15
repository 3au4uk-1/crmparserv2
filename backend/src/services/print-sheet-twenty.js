import { formatPlenkaText, lookupFilmsForOrder } from './print-sheet-lookup.js';

const LIST_IN_PRINT_QUERY = `
  query ListOpportunitiesInPrintStage($limit: Int!) {
    opportunities(
      filter: { stage: { eq: V_PECHATI } }
      first: $limit
    ) {
      edges {
        node {
          id
          name
          stage
          closeDate
          plenka {
            markdown
          }
        }
      }
    }
  }
`;

const UPDATE_PLENKA_MUTATION = `
  mutation UpdateOpportunityPlenka($id: ID!, $input: OpportunityUpdateInput!) {
    updateOpportunity(id: $id, data: $input) {
      id
      plenka {
        markdown
      }
    }
  }
`;

export async function listOpportunitiesInPrintStage(gql, limit = 200) {
  const resp = await gql(LIST_IN_PRINT_QUERY, { limit });
  const edges = resp.data?.data?.opportunities?.edges || [];
  return edges.map((edge) => edge.node);
}

export async function updateOpportunityPlenka(gql, id, plenkaText) {
  const input = { plenka: { markdown: plenkaText } };
  await gql(UPDATE_PLENKA_MUTATION, { id, input });
}

export async function refreshPlenkaForOpportunity(gql, opportunity) {
  if (!opportunity?.id || !opportunity?.name) {
    return { updated: false, text: '', reason: 'missing opportunity id or name' };
  }

  const matches = await lookupFilmsForOrder(opportunity.name, opportunity.closeDate);
  const text = formatPlenkaText(matches);
  const currentMarkdown = opportunity.plenka?.markdown ?? '';

  if (currentMarkdown === text) {
    return { updated: false, text };
  }

  await updateOpportunityPlenka(gql, opportunity.id, text);
  return { updated: true, text };
}
