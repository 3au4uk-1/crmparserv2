const ADDRESS_QUERY = `query OpportunityAddress($id: ID!) {
  opportunities(filter: { id: { eq: $id } }, first: 1) {
    edges { node { id clientAddress } }
  }
}`;

const UPDATE_ADDRESS = `mutation UpdateOpportunityAddress($id: ID!, $input: OpportunityUpdateInput!) {
  updateOpportunity(id: $id, data: $input) { id }
}`;

export function tonyAddressBackfillRows(deals) {
  return deals.flatMap((deal) => {
    const twentyId = String(deal.twenty_id ?? '').trim();
    const address = String(deal.address ?? '').trim();
    if (deal.data_source !== 'tony' || !twentyId || !address) return [];
    return [{ twentyId, address }];
  });
}

function isHardTwentyError(err) {
  const message = err?.message || String(err);
  return /401|403|not configured|timeout|ECONNREFUSED|ECONNRESET|ECONNABORTED|GraphQL endpoint not found/i.test(message);
}

export async function runTonyAddressBackfill({
  db,
  gql,
  apiUrl,
  apiToken,
  assertHttpSuccess,
  assertGqlSuccess,
}) {
  const deals = db.prepare(`
    SELECT twenty_id, data_source, address
    FROM deals
    WHERE twenty_id IS NOT NULL AND TRIM(twenty_id) != ''
    ORDER BY id ASC
  `).all();
  const rows = tonyAddressBackfillRows(deals);
  const result = { updated: 0, skipped: 0, failed: [] };

  for (const row of rows) {
    try {
      const read = await gql(apiUrl, apiToken, ADDRESS_QUERY, { id: row.twentyId });
      assertHttpSuccess(read, apiUrl);
      assertGqlSuccess(read, 'Failed to read opportunity address');
      const current = String(read.data?.data?.opportunities?.edges?.[0]?.node?.clientAddress ?? '').trim();
      if (current === row.address) {
        result.skipped += 1;
        continue;
      }
      const variables = { id: row.twentyId, input: { clientAddress: row.address } };
      const write = await gql(apiUrl, apiToken, UPDATE_ADDRESS, variables);
      assertHttpSuccess(write, apiUrl);
      assertGqlSuccess(write, 'Failed to update opportunity address');
      result.updated += 1;
    } catch (err) {
      if (isHardTwentyError(err)) throw err;
      result.failed.push({ twentyId: row.twentyId, message: err?.message || String(err) });
    }
  }

  return result;
}
