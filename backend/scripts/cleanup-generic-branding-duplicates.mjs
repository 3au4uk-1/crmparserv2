import { getDb, initDb } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { gql, assertHttpSuccess, assertGqlSuccess } from '../src/services/twenty-gql.js';
import { requireTwentyConfig } from '../src/services/twenty-config.js';
import { listLineItemsForOpportunity } from '../src/services/twenty-line-items-sync.js';
import { cleanupGenericBrandingDuplicates } from '../src/services/generic-branding-duplicates.js';

initDb();
migrate();

const deleteDuplicates = process.argv.includes('--delete');
const { apiUrl, apiToken } = requireTwentyConfig();
const result = await cleanupGenericBrandingDuplicates({
  db: getDb(),
  gql,
  apiUrl,
  apiToken,
  assertHttpSuccess,
  assertGqlSuccess,
  listLineItems: listLineItemsForOpportunity,
  deleteDuplicates,
});
console.log(JSON.stringify(result, null, 2));
