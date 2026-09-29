import { getDb } from '../src/db/connection.js';
import { gql, assertHttpSuccess, assertGqlSuccess } from '../src/services/twenty-gql.js';
import { requireTwentyConfig } from '../src/services/twenty-config.js';
import { runTonyAddressBackfill } from '../src/services/tony-address-backfill.js';

const { apiUrl, apiToken } = requireTwentyConfig();
const result = await runTonyAddressBackfill({
  db: getDb(),
  gql,
  apiUrl,
  apiToken,
  assertHttpSuccess,
  assertGqlSuccess,
});
console.log(JSON.stringify(result));
