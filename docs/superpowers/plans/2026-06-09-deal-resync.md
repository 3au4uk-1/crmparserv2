# Deal Re-sync to Twenty CRM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After parsing, automatically push deal changes to Twenty CRM for already-synced deals — updating Opportunity metadata and line items (add/update/delete), preserving manual overrides by item name.

**Architecture:** Extend `syncDealToTwenty` with an update branch (unified create/update). Extract shared Opportunity and line-item helpers. Parser collects `dealsToResync` during hash-changed updates and calls sync at end of `runParsing`. Override preservation lives in a small `deal-items-update.js` helper.

**Tech Stack:** Node.js 20, Express, better-sqlite3, axios (Twenty GraphQL), Vitest; React 18, TanStack Query, Tailwind CSS.

**Spec:** `docs/superpowers/specs/2026-06-09-deal-resync-design.md`

---

## File Structure

| File | Responsibility |
|------|----------------|
| `backend/src/db/schema.sql` | Add `action` column to `sync_runs` DDL |
| `backend/src/db/migrate.js` | `ensureColumn` for `sync_runs.action` |
| `backend/src/services/twenty-opportunity.js` | `buildOpportunityInput(deal, items, { includeStage })` |
| `backend/src/services/twenty-line-items-sync.js` | Line item diff: list, sync eligible, delete orphans |
| `backend/src/services/twenty-sync.js` | Unified create/update in `syncDealToTwenty`; updated `logSyncRun` |
| `backend/src/services/deal-items-update.js` | Override map + replace items preserving overrides |
| `backend/src/services/parser.js` | Use `deal-items-update`, collect `dealsToResync`, post-parse sync |
| `backend/src/routes/deals.js` | `POST /api/deals/:id/resync` |
| `backend/tests/twenty-opportunity.test.js` | Opportunity input builder |
| `backend/tests/deal-items-update.test.js` | Override preservation |
| `backend/tests/twenty-line-items-sync.test.js` | Diff logic with mocked gql |
| `backend/tests/twenty-sync.test.js` | Create vs update branch with mocked axios |
| `frontend/src/api.js` | `useResyncDeal` hook |
| `frontend/src/pages/Logs.jsx` | `action` column in sync logs table |
| `frontend/src/components/DealRow.jsx` | Resync button + `synced_at` hint |

---

### Task 1: Database — `sync_runs.action` column

**Files:**
- Modify: `backend/src/db/schema.sql`
- Modify: `backend/src/db/migrate.js`

- [ ] **Step 1: Add column to schema**

In `backend/src/db/schema.sql`, update `sync_runs` table:

```sql
CREATE TABLE IF NOT EXISTS sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  action TEXT,
  twenty_id TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- [ ] **Step 2: Add migrate guard**

In `backend/src/db/migrate.js`, after existing `ensureColumn` calls add:

```js
  ensureColumn(db, 'sync_runs', 'action', 'TEXT');
```

- [ ] **Step 3: Verify migration**

Run:

```bash
cd backend && node -e "import('./src/db/connection.js').then(m => { m.initDb(); import('./src/db/migrate.js').then(x => x.migrate()); const db = m.getDb(); console.log(db.prepare('PRAGMA table_info(sync_runs)').all().map(c => c.name)); })"
```

Expected: array includes `'action'`

- [ ] **Step 4: Commit**

```bash
git add backend/src/db/schema.sql backend/src/db/migrate.js
git commit -m "feat: add action column to sync_runs for re-sync logging"
```

---

### Task 2: Update `logSyncRun` signature

**Files:**
- Modify: `backend/src/services/twenty-sync.js`

- [ ] **Step 1: Change logSyncRun**

Replace `logSyncRun` in `twenty-sync.js`:

```js
function logSyncRun(dealId, status, twentyId, error, action = null) {
  const db = getDb();
  db.prepare(
    'INSERT INTO sync_runs (deal_id, status, action, twenty_id, error) VALUES (?, ?, ?, ?, ?)'
  ).run(dealId, status, action, twentyId || null, error || null);
}
```

- [ ] **Step 2: Pass action on existing create success/failure**

Update existing calls:

```js
logSyncRun(dealId, 'failed', null, message, 'created');
// ...
logSyncRun(dealId, 'success', oppId, null, 'created');
// ...
logSyncRun(dealId, 'failed', null, err.message, 'created');
```

- [ ] **Step 3: Run tests**

Run: `cd backend && npm test`

Expected: all existing tests PASS

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/twenty-sync.js
git commit -m "feat: log sync action on create runs"
```

---

### Task 3: `buildOpportunityInput` helper (TDD)

**Files:**
- Create: `backend/src/services/twenty-opportunity.js`
- Create: `backend/tests/twenty-opportunity.test.js`
- Modify: `backend/src/services/twenty-sync.js` (wire in next step after tests pass)

- [ ] **Step 1: Write failing tests**

Create `backend/tests/twenty-opportunity.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { buildOpportunityInput } from '../src/services/twenty-opportunity.js';

describe('buildOpportunityInput', () => {
  const deal = {
    title: 'ПРО Иванов 12345',
    crm_event_id: 'evt-1',
    start_date: '2026-06-10',
    end_date: '2026-06-11',
    tony_order_id: '99',
    crm_lead_id: ' 42 ',
    arrival_time: '09:00',
    ready_time: '10:00',
    work_time: '11:00',
    dismantle_time: '18:00',
  };

  const items = [{ name: 'Баннер', price: 15000 }];

  it('builds create input with stage and amount', () => {
    const input = buildOpportunityInput(deal, items, {
      includeStage: true,
      stage: 'NEW',
      companyTwentyId: 'comp-1',
      personTwentyId: 'person-1',
    });

    expect(input.name).toBe('ПРО Иванов 12345');
    expect(input.stage).toBe('NEW');
    expect(input.closeDate).toBe('2026-06-10');
    expect(input.amount).toEqual({ amountMicros: 15000000000, currencyCode: 'RUB' });
    expect(input.companyId).toBe('comp-1');
    expect(input.pointOfContactId).toBe('person-1');
    expect(input.tonyLink.primaryLinkUrl).toContain('id=99');
    expect(input.bitrixLink.primaryLinkUrl).toContain('/42/?any');
    expect(input.arrivalTime).toBe('09:00');
  });

  it('omits stage when includeStage is false', () => {
    const input = buildOpportunityInput(deal, items, { includeStage: false });
    expect(input.stage).toBeUndefined();
    expect(input.amount.amountMicros).toBe(15000000000);
  });

  it('zero amount when no items', () => {
    const input = buildOpportunityInput(deal, [], { includeStage: false });
    expect(input.amount).toEqual({ amountMicros: 0, currencyCode: 'RUB' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/twenty-opportunity.test.js`

Expected: FAIL — module not found

- [ ] **Step 3: Implement helper**

Create `backend/src/services/twenty-opportunity.js`:

```js
export function buildOpportunityInput(deal, items, options = {}) {
  const {
    includeStage = false,
    stage = 'NEW',
    companyTwentyId = null,
    personTwentyId = null,
  } = options;

  const brandingBudget = items.reduce((sum, i) => sum + (i.price || 0), 0);

  const input = {
    name: deal.title || `Deal ${deal.crm_event_id}`,
    closeDate: deal.start_date || deal.end_date || new Date().toISOString(),
    amount: {
      amountMicros: Math.round(brandingBudget * 1_000_000),
      currencyCode: 'RUB',
    },
  };

  if (includeStage) input.stage = stage;
  if (companyTwentyId) input.companyId = companyTwentyId;
  if (personTwentyId) input.pointOfContactId = personTwentyId;

  if (deal.tony_order_id) {
    input.tonyLink = {
      primaryLinkUrl: `https://crm.apihide.com/orders/orders_edit/?id=${deal.tony_order_id}`,
      primaryLinkLabel: `Tony #${deal.tony_order_id}`,
    };
  }

  if (deal.crm_lead_id) {
    const leadId = deal.crm_lead_id.trim();
    input.bitrixLink = {
      primaryLinkUrl: `https://prointeractive.bitrix24.ru/crm/deal/details/${leadId}/?any`,
      primaryLinkLabel: `Bitrix #${leadId}`,
    };
  }

  if (deal.arrival_time) input.arrivalTime = deal.arrival_time;
  if (deal.ready_time) input.readyTime = deal.ready_time;
  if (deal.work_time) input.workTime = deal.work_time;
  if (deal.dismantle_time) input.dismantleTime = deal.dismantle_time;

  return input;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/twenty-opportunity.test.js`

Expected: PASS

- [ ] **Step 5: Refactor create path in twenty-sync.js**

In `syncDealToTwenty` create branch, replace inline `oppInput` with:

```js
import { buildOpportunityInput } from './twenty-opportunity.js';

// inside create try block, after company/person resolution:
const oppInput = buildOpportunityInput(deal, items, {
  includeStage: true,
  stage: getOpportunityStage(),
  companyTwentyId,
  personTwentyId,
});
```

Remove the old inline field mapping for `oppInput`.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/twenty-opportunity.js backend/tests/twenty-opportunity.test.js backend/src/services/twenty-sync.js
git commit -m "feat: extract buildOpportunityInput for Twenty sync"
```

---

### Task 4: Line items diff service (TDD)

**Files:**
- Create: `backend/src/services/twenty-line-items-sync.js`
- Create: `backend/tests/twenty-line-items-sync.test.js`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/twenty-line-items-sync.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeLineItemDiff } from '../src/services/twenty-line-items-sync.js';

describe('computeLineItemDiff', () => {
  it('marks existing names for update and new names for create', () => {
    const existing = [
      { id: 'li-1', name: 'Баннер' },
      { id: 'li-2', name: 'Ролл-ап' },
    ];
    const eligible = [
      { id: 10, name: 'Баннер', price: 100 },
      { id: 11, name: 'Наклейки', price: 50 },
    ];

    const diff = computeLineItemDiff(existing, eligible);

    expect(diff.toUpdate).toEqual([
      { twentyId: 'li-1', item: eligible[0] },
    ]);
    expect(diff.toCreate).toEqual([eligible[1]]);
    expect(diff.toDelete).toEqual(['li-2']);
  });

  it('deletes all when eligible is empty', () => {
    const existing = [{ id: 'li-1', name: 'Баннер' }];
    const diff = computeLineItemDiff(existing, []);
    expect(diff.toCreate).toEqual([]);
    expect(diff.toUpdate).toEqual([]);
    expect(diff.toDelete).toEqual(['li-1']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/twenty-line-items-sync.test.js`

Expected: FAIL

- [ ] **Step 3: Implement diff + GraphQL helpers**

Create `backend/src/services/twenty-line-items-sync.js`:

```js
import {
  buildLineItemCreateInput,
  buildLineItemUpdateInput,
} from './twenty-line-item.js';

export function computeLineItemDiff(existingLineItems, eligibleItems) {
  const eligibleNames = new Set(eligibleItems.map((i) => i.name));
  const existingByName = new Map(existingLineItems.map((li) => [li.name, li]));

  const toUpdate = [];
  const toCreate = [];

  for (const item of eligibleItems) {
    const existing = existingByName.get(item.name);
    if (existing) {
      toUpdate.push({ twentyId: existing.id, item });
    } else {
      toCreate.push(item);
    }
  }

  const toDelete = existingLineItems
    .filter((li) => !eligibleNames.has(li.name))
    .map((li) => li.id);

  return { toUpdate, toCreate, toDelete };
}

export async function listLineItemsForOpportunity(gql, apiUrl, apiToken, oppId) {
  const resp = await gql(
    apiUrl,
    apiToken,
    `query ListLineItems($oppId: ID!) {
      dealLineItems(filter: { opportunityId: { eq: $oppId } }) {
        edges { node { id name } }
      }
    }`,
    { oppId }
  );
  return resp.data?.data?.dealLineItems?.edges?.map((e) => e.node) || [];
}

export async function deleteLineItem(gql, apiUrl, apiToken, lineItemId) {
  return gql(
    apiUrl,
    apiToken,
    `mutation DeleteDealLineItem($id: ID!) {
      deleteDealLineItem(id: $id) { id }
    }`,
    { id: lineItemId }
  );
}

export async function syncLineItemsDiff({
  gql,
  assertHttpSuccess,
  assertGqlSuccess,
  apiUrl,
  apiToken,
  oppId,
  eligibleItems,
  existingLineItems,
  findOrCreateWarehouseItem,
  db,
}) {
  const { toUpdate, toCreate, toDelete } = computeLineItemDiff(
    existingLineItems,
    eligibleItems
  );

  for (const lineItemId of toDelete) {
    const resp = await deleteLineItem(gql, apiUrl, apiToken, lineItemId);
    assertHttpSuccess(resp, apiUrl);
    assertGqlSuccess(resp, 'Failed to delete line item in Twenty');
  }

  for (const { twentyId, item } of toUpdate) {
    const resp = await gql(
      apiUrl,
      apiToken,
      `mutation UpdateDealLineItem($id: ID!, $input: DealLineItemUpdateInput!) {
        updateDealLineItem(id: $id, data: $input) { id }
      }`,
      { id: twentyId, input: buildLineItemUpdateInput(item) }
    );
    assertHttpSuccess(resp, apiUrl);
    assertGqlSuccess(resp, `Failed to update line item "${item.name}" in Twenty`);
    db.prepare('UPDATE deal_items SET twenty_id = ? WHERE id = ?').run(twentyId, item.id);
  }

  let position = 0;
  for (const item of toCreate) {
    const warehouseItemId = await findOrCreateWarehouseItem(apiUrl, apiToken, item.name);
    const resp = await gql(
      apiUrl,
      apiToken,
      `mutation CreateDealLineItem($input: DealLineItemCreateInput!) {
        createDealLineItem(data: $input) { id }
      }`,
      {
        input: buildLineItemCreateInput(
          item,
          warehouseItemId,
          oppId,
          position === 0 ? 'first' : position
        ),
      }
    );
    assertHttpSuccess(resp, apiUrl);
    assertGqlSuccess(resp, `Failed to create line item "${item.name}" in Twenty`);
    const lineItemId = resp.data?.data?.createDealLineItem?.id;
    if (!lineItemId) throw new Error(`Failed to create line item "${item.name}" in Twenty`);
    db.prepare('UPDATE deal_items SET twenty_id = ? WHERE id = ?').run(lineItemId, item.id);
    position += 1;
  }

  return { updated: toUpdate.length, created: toCreate.length, deleted: toDelete.length };
}
```

- [ ] **Step 4: Run tests**

Run: `cd backend && npx vitest run tests/twenty-line-items-sync.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/twenty-line-items-sync.js backend/tests/twenty-line-items-sync.test.js
git commit -m "feat: add line items diff helpers for Twenty re-sync"
```

---

### Task 5: Implement update branch in `syncDealToTwenty` (TDD)

**Files:**
- Modify: `backend/src/services/twenty-sync.js`
- Create: `backend/tests/twenty-sync.test.js`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/twenty-sync.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const axiosPost = vi.fn();
vi.mock('axios', () => ({
  default: { post: (...args) => axiosPost(...args) },
}));

vi.mock('../src/db/connection.js', () => {
  const deals = new Map();
  const items = new Map();
  let dealSeq = 1;
  let itemSeq = 1;

  const db = {
    prepare(sql) {
      return {
        get(...params) {
          if (sql.includes('FROM deals WHERE id')) {
            return deals.get(params[0]) || null;
          }
          if (sql.includes("key = 'opportunity_stage'")) {
            return { value: 'NEW' };
          }
          return null;
        },
        all(...params) {
          if (sql.includes('FROM deal_items WHERE deal_id')) {
            return [...items.values()].filter((i) => i.deal_id === params[0]);
          }
          return [];
        },
        run(...params) {
          if (sql.includes('INSERT INTO sync_runs')) return { changes: 1 };
          if (sql.includes('UPDATE deals SET') && sql.includes('twenty_error')) {
            const deal = deals.get(params[params.length - 1]);
            if (deal) deal.twenty_error = params[0];
            return { changes: 1 };
          }
          if (sql.includes('UPDATE deals SET') && sql.includes('synced_at')) {
            const deal = deals.get(params[params.length - 1]);
            if (deal) {
              deal.synced_at = 'now';
              deal.twenty_error = null;
            }
            return { changes: 1 };
          }
          if (sql.includes('UPDATE deal_items SET twenty_id')) {
            const item = [...items.values()].find((i) => i.id === params[1]);
            if (item) item.twenty_id = params[0];
            return { changes: 1 };
          }
          return { changes: 1 };
        },
      };
    },
  };

  return {
    getDb: () => db,
    __seedDeal(deal) {
      const id = deal.id ?? dealSeq++;
      deals.set(id, { ...deal, id });
      return id;
    },
    __seedItem(item) {
      const id = item.id ?? itemSeq++;
      items.set(id, { ...item, id });
      return id;
    },
    __reset() {
      deals.clear();
      items.clear();
      dealSeq = 1;
      itemSeq = 1;
    },
  };
});

vi.mock('./twenty-config.js', () => ({
  requireTwentyConfig: () => ({ apiUrl: 'https://twenty.test/graphql', apiToken: 'token' }),
  getTwentyConfig: () => ({ apiUrl: 'https://twenty.test/graphql', apiToken: 'token', source: 'env' }),
}));

vi.mock('./blacklist.js', () => ({
  loadBlacklist: () => [],
}));

import * as dbMock from '../src/db/connection.js';
import { syncDealToTwenty } from '../src/services/twenty-sync.js';

function gqlOk(data) {
  return { status: 200, data: { data } };
}

describe('syncDealToTwenty update branch', () => {
  beforeEach(() => {
    axiosPost.mockReset();
    dbMock.__reset();
  });

  it('updates opportunity when twenty_id exists', async () => {
    const dealId = dbMock.__seedDeal({
      id: 1,
      twenty_id: 'opp-existing',
      approval_status: 'synced',
      title: 'Updated deal',
      start_date: '2026-06-10',
      crm_event_id: 'e1',
    });
    dbMock.__seedItem({
      deal_id: dealId,
      name: 'Баннер',
      price: 2000,
      classification: 'keyword_match',
      sync_override: null,
    });

    axiosPost
      .mockResolvedValueOnce(gqlOk({
        dealLineItems: { edges: [{ node: { id: 'li-1', name: 'Баннер' } }] },
      }))
      .mockResolvedValueOnce(gqlOk({ updateOpportunity: { id: 'opp-existing' } }))
      .mockResolvedValueOnce(gqlOk({ updateDealLineItem: { id: 'li-1' } }));

    const result = await syncDealToTwenty(dealId);

    expect(result.action).toBe('updated');
    expect(axiosPost.mock.calls.some(([_, body]) =>
      body.query.includes('updateOpportunity')
    )).toBe(true);
  });

  it('returns created when no twenty_id', async () => {
    const dealId = dbMock.__seedDeal({
      id: 2,
      twenty_id: null,
      title: 'New deal',
      start_date: '2026-06-10',
      crm_event_id: 'e2',
    });
    dbMock.__seedItem({
      deal_id: dealId,
      name: 'Баннер',
      price: 1000,
      classification: 'keyword_match',
    });

    axiosPost
      .mockResolvedValueOnce(gqlOk({ companies: { edges: [] } }))
      .mockResolvedValueOnce(gqlOk({ createOpportunity: { id: 'opp-new' } }))
      .mockResolvedValueOnce(gqlOk({ products: { edges: [] } }))
      .mockResolvedValueOnce(gqlOk({ createProduct: { id: 'wh-1' } }))
      .mockResolvedValueOnce(gqlOk({ dealLineItems: { edges: [] } }))
      .mockResolvedValueOnce(gqlOk({ createDealLineItem: { id: 'li-new' } }));

    const result = await syncDealToTwenty(dealId);
    expect(result.action).toBe('created');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/twenty-sync.test.js`

Expected: FAIL — `action: 'already_synced'` or missing `updateOpportunity`

- [ ] **Step 3: Implement update branch**

In `twenty-sync.js`:

1. Add imports:

```js
import { buildOpportunityInput } from './twenty-opportunity.js';
import {
  listLineItemsForOpportunity,
  syncLineItemsDiff,
} from './twenty-line-items-sync.js';
```

2. Extract `createDealInTwenty(dealId, deal, items, twenty)` from current create body (optional but keeps `syncDealToTwenty` readable).

3. Add `updateDealInTwenty(dealId, deal, items, twenty)`:

```js
async function updateDealInTwenty(dealId, deal, items, twenty) {
  const db = getDb();
  const oppId = deal.twenty_id;

  const companyTwentyId = deal.company_code
    ? await findOrCreateCompany(twenty.apiUrl, twenty.apiToken, deal.company_code)
    : null;

  const personTwentyId = deal.manager_name
    ? await findOrCreatePerson(twenty.apiUrl, twenty.apiToken, deal.manager_name, companyTwentyId)
    : null;

  const oppInput = buildOpportunityInput(deal, items, {
    includeStage: false,
    companyTwentyId,
    personTwentyId,
  });

  const oppResp = await gql(
    twenty.apiUrl,
    twenty.apiToken,
    `mutation UpdateOpportunity($id: ID!, $input: OpportunityUpdateInput!) {
      updateOpportunity(id: $id, data: $input) { id }
    }`,
    { id: oppId, input: oppInput }
  );
  assertHttpSuccess(oppResp, twenty.apiUrl);
  assertGqlSuccess(oppResp, 'Failed to update opportunity in Twenty');

  const existingLineItems = await listLineItemsForOpportunity(
    gql, twenty.apiUrl, twenty.apiToken, oppId
  );

  await syncLineItemsDiff({
    gql,
    assertHttpSuccess,
    assertGqlSuccess,
    apiUrl: twenty.apiUrl,
    apiToken: twenty.apiToken,
    oppId,
    eligibleItems: items,
    existingLineItems,
    findOrCreateWarehouseItem,
    db,
  });

  const action = items.length === 0 ? 'updated_empty' : 'updated';

  db.prepare(`
    UPDATE deals SET synced_at = datetime('now'), twenty_error = NULL WHERE id = ?
  `).run(dealId);

  logSyncRun(dealId, 'success', oppId, null, action);
  return { twentyId: oppId, action, itemCount: items.length };
}
```

4. Change `syncDealToTwenty` entry:

```js
export async function syncDealToTwenty(dealId) {
  const twenty = requireTwentyConfig();
  const db = getDb();
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(dealId);
  if (!deal) throw new Error(`Deal ${dealId} not found`);

  const allItems = db.prepare('SELECT * FROM deal_items WHERE deal_id = ?').all(dealId);
  const blacklist = loadBlacklist(db);
  const items = getItemsForTwenty(allItems, blacklist);

  if (deal.twenty_id) {
    try {
      return await updateDealInTwenty(dealId, deal, items, twenty);
    } catch (err) {
      db.prepare("UPDATE deals SET twenty_error = ? WHERE id = ?").run(err.message, dealId);
      logSyncRun(dealId, 'failed', deal.twenty_id, err.message, 'updated');
      throw err;
    }
  }

  if (items.length === 0) {
    const message = 'Нет позиций для переноса в Twenty';
    db.prepare("UPDATE deals SET twenty_error = ? WHERE id = ?").run(message, dealId);
    logSyncRun(dealId, 'failed', null, message, 'created');
    throw new Error(message);
  }

  // existing create path...
  // ensure return includes action: 'created'
}
```

5. Remove early return `if (deal.twenty_id) return { twentyId: deal.twenty_id, action: 'already_synced' };`

6. Refactor create path line-item loop to use `syncLineItemsDiff` OR keep existing create loop — either is fine if create tests still pass. Prefer reusing `syncLineItemsDiff` with empty `existingLineItems` for DRY.

- [ ] **Step 4: Run tests**

Run: `cd backend && npm test`

Expected: all PASS (adjust mocks if company/person lookups add extra axios calls)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/twenty-sync.js backend/tests/twenty-sync.test.js
git commit -m "feat: update synced deals in Twenty on re-sync"
```

---

### Task 6: Override preservation helper (TDD)

**Files:**
- Create: `backend/src/services/deal-items-update.js`
- Create: `backend/tests/deal-items-update.test.js`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/deal-items-update.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  buildOverrideMap,
  replaceDealItemsPreservingOverrides,
} from '../src/services/deal-items-update.js';

function createTestDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE deals (id INTEGER PRIMARY KEY, title TEXT);
    CREATE TABLE deal_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      price REAL,
      quantity TEXT,
      discount REAL,
      classification TEXT NOT NULL DEFAULT 'unclassified',
      classification_confidence REAL,
      sync_override TEXT,
      twenty_id TEXT
    );
    INSERT INTO deals (id, title) VALUES (1, 'Test');
  `);
  return db;
}

describe('deal-items-update', () => {
  let db;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it('buildOverrideMap keeps sync_override and twenty_id by name', () => {
    const map = buildOverrideMap([
      { name: 'Баннер', sync_override: 'exclude', twenty_id: 'li-1' },
      { name: 'Кейтеринг', sync_override: null, twenty_id: null },
    ]);
    expect(map['Баннер']).toEqual({ sync_override: 'exclude', twenty_id: 'li-1' });
    expect(map['Кейтеринг']).toBeUndefined();
  });

  it('restores overrides for matching names after replace', () => {
    db.prepare(`
      INSERT INTO deal_items (deal_id, name, price, classification, sync_override, twenty_id)
      VALUES (1, 'Баннер', 100, 'keyword_match', 'exclude', 'li-old')
    `).run();

    const existing = db.prepare('SELECT * FROM deal_items WHERE deal_id = 1').all();
    const overrideMap = buildOverrideMap(existing);

    replaceDealItemsPreservingOverrides(db, 1, [
      { name: 'Баннер', price: 200, quantity: null, discount: null, classification: 'keyword_match', classification_confidence: 1 },
      { name: 'Наклейки', price: 50, quantity: null, discount: null, classification: 'llm_confirmed', classification_confidence: 0.9 },
    ], overrideMap);

    const items = db.prepare('SELECT * FROM deal_items WHERE deal_id = 1 ORDER BY name').all();
    expect(items).toHaveLength(2);

    const banner = items.find((i) => i.name === 'Баннер');
    expect(banner.price).toBe(200);
    expect(banner.sync_override).toBe('exclude');
    expect(banner.twenty_id).toBe('li-old');

    const stickers = items.find((i) => i.name === 'Наклейки');
    expect(stickers.sync_override).toBeNull();
    expect(stickers.twenty_id).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run tests/deal-items-update.test.js`

Expected: FAIL

- [ ] **Step 3: Implement helper**

Create `backend/src/services/deal-items-update.js`:

```js
export function buildOverrideMap(existingItems) {
  const map = {};
  for (const item of existingItems) {
    if (item.sync_override || item.twenty_id) {
      map[item.name] = {
        sync_override: item.sync_override ?? null,
        twenty_id: item.twenty_id ?? null,
      };
    }
  }
  return map;
}

export function replaceDealItemsPreservingOverrides(db, dealId, classifiedItems, overrideMap) {
  db.prepare('DELETE FROM deal_items WHERE deal_id = ?').run(dealId);

  const insert = db.prepare(`
    INSERT INTO deal_items (deal_id, name, price, quantity, discount, classification, classification_confidence)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const restore = db.prepare(`
    UPDATE deal_items SET sync_override = ?, twenty_id = ? WHERE id = ?
  `);

  for (const item of classifiedItems) {
    const result = insert.run(
      dealId,
      item.name,
      item.price,
      item.quantity,
      item.discount,
      item.classification,
      item.classification_confidence
    );

    const preserved = overrideMap[item.name];
    if (preserved) {
      restore.run(preserved.sync_override, preserved.twenty_id, result.lastInsertRowid);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run tests/deal-items-update.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/deal-items-update.js backend/tests/deal-items-update.test.js
git commit -m "feat: preserve item overrides by name on deal re-parse"
```

---

### Task 7: Wire parser re-sync flow

**Files:**
- Modify: `backend/src/services/parser.js`

- [ ] **Step 1: Add imports and dealsToResync array**

At top of `parser.js`:

```js
import { syncDealToTwenty } from './twenty-sync.js';
import { buildOverrideMap, replaceDealItemsPreservingOverrides } from './deal-items-update.js';
```

Inside `runParsing`, after `let skippedDeals = 0;` add:

```js
const dealsToResync = [];
```

- [ ] **Step 2: Replace inline item delete/insert in update branch**

In the `if (existing)` block, replace `DELETE` + insert loop with:

```js
const existingDeal = db.prepare('SELECT twenty_id FROM deals WHERE id = ?').get(existing.id);
const existingItems = db.prepare('SELECT * FROM deal_items WHERE deal_id = ?').all(existing.id);
const overrideMap = buildOverrideMap(existingItems);

// ... existing UPDATE deals SET ... (unchanged)

replaceDealItemsPreservingOverrides(db, existing.id, classifiedItems, overrideMap);

if (existingDeal?.twenty_id) {
  dealsToResync.push(existing.id);
}

updatedDeals++;
```

- [ ] **Step 3: Post-parse sync phase**

Before `return { runId, ... }` (after parse_runs UPDATE):

```js
for (const dealId of dealsToResync) {
  try {
    await syncDealToTwenty(dealId);
  } catch (err) {
    console.error(`Re-sync failed for deal ${dealId}:`, err.message);
  }
}
```

- [ ] **Step 4: Run full test suite**

Run: `cd backend && npm test`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/parser.js
git commit -m "feat: auto re-sync to Twenty after parsing updated deals"
```

---

### Task 8: Manual resync API endpoint

**Files:**
- Modify: `backend/src/routes/deals.js`

- [ ] **Step 1: Add route**

After `router.patch('/:id/approve', ...)` add:

```js
router.post('/:id/resync', async (req, res, next) => {
  try {
    const db = getDb();
    const dealId = Number(req.params.id);
    const deal = db.prepare('SELECT id, twenty_id FROM deals WHERE id = ?').get(dealId);
    if (!deal) return res.status(404).json({ error: 'Deal not found' });
    if (!deal.twenty_id) {
      return res.status(400).json({ error: 'Deal is not synced to Twenty yet' });
    }
    const result = await syncDealToTwenty(dealId);
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});
```

Ensure `syncDealToTwenty` is imported at top of `deals.js`.

- [ ] **Step 2: Commit**

```bash
git add backend/src/routes/deals.js
git commit -m "feat: add POST /api/deals/:id/resync endpoint"
```

---

### Task 9: Frontend — sync logs action column

**Files:**
- Modify: `frontend/src/pages/Logs.jsx`

- [ ] **Step 1: Add action column**

In `SyncLogsTable` thead, after «Статус» add:

```jsx
<th className="p-3">Действие</th>
```

In tbody row, after status cell:

```jsx
<td className="p-3 text-xs text-gray-600">
  {log.action === 'created' ? 'создание'
    : log.action === 'updated' ? 'обновление'
    : log.action === 'updated_empty' ? 'обнуление'
    : '—'}
</td>
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/pages/Logs.jsx
git commit -m "feat: show sync action type in logs UI"
```

---

### Task 10: Frontend — resync button and synced_at hint

**Files:**
- Modify: `frontend/src/api.js`
- Modify: `frontend/src/components/DealRow.jsx`

- [ ] **Step 1: Add API hook**

In `frontend/src/api.js`:

```js
export function useResyncDeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dealId) =>
      fetch(`${API_BASE}/deals/${dealId}/resync`, { method: 'POST' }).then(handleResponse),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deals'] });
      queryClient.invalidateQueries({ queryKey: ['sync-logs'] });
    },
  });
}
```

- [ ] **Step 2: Add UI in DealRow**

Import `useResyncDeal`. In actions column, for `deal.approval_status === 'synced'`:

```jsx
{deal.approval_status === 'synced' && (
  <div className="flex flex-col gap-1">
    {deal.synced_at && (
      <span className="text-xs text-gray-500" title={deal.synced_at}>
        Синхр. {new Date(deal.synced_at).toLocaleString('ru-RU')}
      </span>
    )}
    <button
      onClick={() => resync.mutate(deal.id)}
      disabled={resync.isPending}
      className="px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 disabled:opacity-50"
    >
      Пересинхр.
    </button>
  </div>
)}
```

- [ ] **Step 3: Verify frontend builds**

Run: `cd frontend && npm run build`

Expected: build succeeds

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api.js frontend/src/components/DealRow.jsx
git commit -m "feat: add manual resync button and synced_at hint on deals"
```

---

### Task 11: Final verification

- [ ] **Step 1: Run backend tests**

Run: `cd backend && npm test`

Expected: all tests PASS

- [ ] **Step 2: Run frontend build**

Run: `cd frontend && npm run build`

Expected: success

- [ ] **Step 3: Smoke test checklist (manual)**

1. Start app with valid Twenty credentials
2. Parse a deal, approve → creates Opportunity (`action: created` in sync logs)
3. Change deal in source CRM, re-parse → Opportunity updates (`action: updated`)
4. Manually exclude all items via override before sync, re-parse synced deal → amount 0 (`action: updated_empty`)
5. Click «Пересинхр.» on synced deal → succeeds

- [ ] **Step 4: Commit plan doc**

```bash
git add docs/superpowers/plans/2026-06-09-deal-resync.md
git commit -m "docs: add deal re-sync implementation plan"
```

---

## Spec Coverage Checklist

| Spec requirement | Task |
|------------------|------|
| Auto push after parse for `twenty_id` deals | Task 7 |
| Update metadata + line items diff | Task 4, 5 |
| Preserve `sync_override` by name | Task 6, 7 |
| Zero eligible → amount 0, clear line items | Task 5 (`updated_empty`) |
| Independent of `approval_mode` | Task 7 (parser always resyncs) |
| No re-approval | Task 7 (status stays `synced`) |
| `sync_runs.action` logging | Task 1, 2, 5 |
| Manual resync endpoint | Task 8, 10 |
| UI sync log action column | Task 9 |
| UI synced_at / resync button | Task 10 |
| Tests | Tasks 3–7, 11 |
