import { requireTwentyConfig } from './twenty-config.js';
import { gql } from './twenty-gql.js';

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

  if (resp.status >= 400) {
    throw new Error(`Twenty lookup failed: HTTP ${resp.status}`);
  }
  const errors = resp.data?.errors;
  if (errors?.length) throw new Error(errors[0].message);

  return resp.data?.data?.opportunities?.edges?.[0]?.node?.id ?? null;
}
