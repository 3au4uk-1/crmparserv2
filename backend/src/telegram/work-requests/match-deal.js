import { assertGqlSuccess } from '../../services/twenty-gql.js';

const SEARCH_OPPORTUNITIES_QUERY = `query SearchOpportunities($q: String!) {
  opportunities(filter: { name: { ilike: $q } }, first: 30) {
    edges { node { id name } }
  }
}`;

const SEARCH_OPPORTUNITIES_BY_NAME_QUERY = `query SearchOpportunitiesByName($q: String!) {
  opportunities(filter: { name: { eq: $q } }, first: 30) {
    edges { node { id name } }
  }
}`;

export function bookingInName(name, booking) {
  if (!name || !booking) return false;
  const pattern = new RegExp(`(^|\\D)${booking}(\\D|$)`);
  return pattern.test(String(name));
}

export function pickMatchedOpportunity(nodes, { booking, dealName }) {
  if (booking) {
    const matched = nodes.filter((node) => bookingInName(node.name, booking));
    if (matched.length === 1) {
      return { id: matched[0].id, name: matched[0].name };
    }
    return null;
  }

  if (dealName) {
    const matched = nodes.filter((node) => node.name === dealName);
    if (matched.length === 1) {
      return { id: matched[0].id, name: matched[0].name };
    }
    return null;
  }

  return null;
}

function extractNodes(resp) {
  return (resp.data?.data?.opportunities?.edges ?? []).map((edge) => edge.node);
}

export async function searchOpportunitiesByBooking(gql, booking) {
  const resp = await gql(SEARCH_OPPORTUNITIES_QUERY, { q: `%${booking}%` });
  assertGqlSuccess(resp, 'SearchOpportunities failed');
  return extractNodes(resp);
}

export async function matchOpportunity({ gql, booking, dealName }) {
  if (!gql) return null;

  if (booking) {
    const nodes = await searchOpportunitiesByBooking(gql, booking);
    return pickMatchedOpportunity(nodes, { booking });
  }

  if (dealName) {
    const resp = await gql(SEARCH_OPPORTUNITIES_BY_NAME_QUERY, { q: dealName });
    assertGqlSuccess(resp, 'SearchOpportunitiesByName failed');
    return pickMatchedOpportunity(extractNodes(resp), { dealName });
  }

  return null;
}
