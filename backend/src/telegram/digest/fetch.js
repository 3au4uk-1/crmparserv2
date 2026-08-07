const PAGE_SIZE = 200;
const OPPORTUNITY_ID_CHUNK = 50;

const DIGEST_OPPS = `
  query DigestOpps($filter: OpportunityFilterInput, $first: Int!, $after: String) {
    opportunities(filter: $filter, first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          name
          stage
          loadDate
          amount { amountMicros currencyCode }
          company { name }
          tonyLink { primaryLinkUrl }
          bitrixLink { primaryLinkUrl }
        }
      }
    }
  }
`;

const DIGEST_ITEMS = `
  query DigestItems($filter: DealLineItemFilterInput, $first: Int!, $after: String) {
    dealLineItems(filter: $filter, first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      edges { node { id opportunityId stage } }
    }
  }
`;

function mapOpportunity(node) {
  return {
    id: node.id,
    name: node.name,
    stage: node.stage,
    loadDate: node.loadDate,
    amount: node.amount,
    companyName: node.companyName ?? node.company?.name ?? '',
    tonyUrl: node.tonyLink?.primaryLinkUrl || node.tonyUrl || '',
    bitrixUrl: node.bitrixLink?.primaryLinkUrl || node.bitrixUrl || '',
  };
}

function groupLineItemsByOppId(items) {
  const byOppId = {};
  for (const item of items) {
    const oppId = item?.opportunityId;
    if (!oppId) continue;
    if (!byOppId[oppId]) byOppId[oppId] = [];
    byOppId[oppId].push(item);
  }
  return byOppId;
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

async function fetchPaginated(gqlClient, query, variables, connectionKey) {
  const items = [];
  let after = null;

  for (;;) {
    const resp = await gqlClient(query, { ...variables, first: PAGE_SIZE, after });
    const connection = resp.data?.data?.[connectionKey];
    if (!connection) {
      throw new Error(`Twenty GraphQL response is missing ${connectionKey}`);
    }

    const edges = connection.edges ?? [];
    for (const edge of edges) {
      if (edge?.node) items.push(edge.node);
    }

    const pageInfo = connection.pageInfo;
    if (pageInfo) {
      if (!pageInfo.hasNextPage) break;
      if (!pageInfo.endCursor) {
        throw new Error(
          `Twenty GraphQL response has hasNextPage but is missing endCursor for ${connectionKey}`
        );
      }
      after = pageInfo.endCursor;
      continue;
    }

    if (edges.length < PAGE_SIZE) break;
    break;
  }

  return items;
}

async function fetchOpportunities(gqlClient, { gte, lt }) {
  const filter = {
    and: [{ loadDate: { gte } }, { loadDate: { lt } }],
  };
  const nodes = await fetchPaginated(gqlClient, DIGEST_OPPS, { filter }, 'opportunities');
  return nodes.map(mapOpportunity);
}

async function fetchLineItemsForOpportunities(gqlClient, opportunityIds) {
  if (!opportunityIds.length) return [];

  const allItems = [];
  for (const idChunk of chunkArray(opportunityIds, OPPORTUNITY_ID_CHUNK)) {
    const filter = { opportunityId: { in: idChunk } };
    const nodes = await fetchPaginated(gqlClient, DIGEST_ITEMS, { filter }, 'dealLineItems');
    allItems.push(...nodes);
  }
  return allItems;
}

export async function fetchDigestDayData(gqlClient, { gte, lt }) {
  const deals = await fetchOpportunities(gqlClient, { gte, lt });
  const opportunityIds = deals.map((d) => d.id).filter(Boolean);
  const lineItems = await fetchLineItemsForOpportunities(gqlClient, opportunityIds);
  const lineItemsByOppId = groupLineItemsByOppId(lineItems);
  return { deals, lineItemsByOppId };
}
