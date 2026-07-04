import { requireTwentyConfig } from './twenty-config.js';
import { gql } from './twenty-gql.js';

function assertTwentyResponse(resp, context) {
  if (resp.status >= 400) {
    throw new Error(`${context}: HTTP ${resp.status}`);
  }
  const errors = resp.data?.errors;
  if (errors?.length) throw new Error(errors[0].message);
}

export async function opportunityExistsInTwenty(opportunityId) {
  const twenty = requireTwentyConfig();
  const resp = await gql(
    twenty.apiUrl,
    twenty.apiToken,
    `query ($id: ID!) {
       opportunities(filter: { id: { eq: $id } }, first: 1) {
         edges { node { id } }
       }
     }`,
    { id: opportunityId },
  );

  assertTwentyResponse(resp, 'Twenty opportunity lookup failed');
  return Boolean(resp.data?.data?.opportunities?.edges?.[0]?.node?.id);
}

export async function findTwentyOpportunityIdByBooking(bookingNumber) {
  const twenty = requireTwentyConfig();
  const resp = await gql(
    twenty.apiUrl,
    twenty.apiToken,
    `query ($b: String!) {
       opportunities(filter: { tonyLink: { primaryLinkUrl: { ilike: $b } } }, first: 1) {
         edges { node { id } }
       }
     }`,
    { b: `%${bookingNumber}` },
  );

  assertTwentyResponse(resp, 'Twenty lookup failed');
  return resp.data?.data?.opportunities?.edges?.[0]?.node?.id ?? null;
}
