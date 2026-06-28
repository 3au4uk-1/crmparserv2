# Restoration Items List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global restoration-items list (exact + substring) so eligible Tony positions that match sync to Twenty with **0 ₽** line amount and excluded opportunity total, without changing eligibility or line-item stage.

**Architecture:** New `restoration_items` SQLite table and `restoration.js` service mirror `blacklist.js`. Matching is read-time only (no `deal_items` column). `computeLineItemTotal` returns 0 when matched; `buildLineItem*` and `buildOpportunityInput` receive `restorationList`. `enrichDealItems` adds UI fields. Settings + deal shortcut mirror blacklist UX.

**Tech Stack:** Node.js 20, Express, better-sqlite3, Vitest; React 18, TanStack Query, Tailwind CSS.

**Spec:** `docs/superpowers/specs/2026-06-27-restoration-items-design.md`

---

## File Structure

| File | Responsibility |
|------|----------------|
| `backend/src/db/schema.sql` | DDL for `restoration_items` |
| `backend/src/db/migrate.js` | Ensure table on startup |
| `backend/src/services/restoration.js` | Match, load, create, delete (reuses `normalizePattern` from blacklist) |
| `backend/src/services/twenty-opportunity.js` | Zero totals for restoration matches |
| `backend/src/services/twenty-line-item.js` | Pass restoration list into amount builder |
| `backend/src/services/twenty-items.js` | Enrich with restoration fields (eligibility unchanged) |
| `backend/src/services/twenty-sync.js` | Load restoration list in sync/preview |
| `backend/src/routes/restoration.js` | CRUD API |
| `backend/src/routes/deals.js` | Pass restoration into enrich + shortcut endpoint |
| `backend/src/index.js` | Mount `/api/restoration` |
| `backend/tests/restoration.test.js` | Matching + DB helpers |
| `backend/tests/twenty-opportunity.test.js` | Zero totals |
| `backend/tests/twenty-line-item.test.js` | Zero line item amount |
| `backend/tests/twenty-items.test.js` | Eligibility unchanged + enrich fields |
| `frontend/src/api.js` | React Query hooks |
| `frontend/src/pages/Settings.jsx` | Restoration list UI |
| `frontend/src/components/DealItems.jsx` | Badge, button, Twenty amount hint |

---

### Task 1: Database — `restoration_items` table

**Files:**
- Modify: `backend/src/db/schema.sql`
- Modify: `backend/src/db/migrate.js`

- [ ] **Step 1: Add table to schema**

Append to `backend/src/db/schema.sql` (after `blacklist_items` block):

```sql
CREATE TABLE IF NOT EXISTS restoration_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern TEXT NOT NULL,
  match_type TEXT NOT NULL CHECK (match_type IN ('exact', 'substring')),
  source_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (pattern, match_type)
);
```

- [ ] **Step 2: Add migrate guard**

In `backend/src/db/migrate.js`, after the `blacklist_items` `CREATE TABLE IF NOT EXISTS` block, add:

```js
  db.exec(`
    CREATE TABLE IF NOT EXISTS restoration_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern TEXT NOT NULL,
      match_type TEXT NOT NULL CHECK (match_type IN ('exact', 'substring')),
      source_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (pattern, match_type)
    );
  `);
```

- [ ] **Step 3: Verify migration**

Run:

```bash
cd backend && node -e "import('./src/db/connection.js').then(m => { m.initDb(); import('./src/db/migrate.js').then(x => x.migrate()); const db = m.getDb(); console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE name='restoration_items'\").get()); })"
```

Expected: `{ name: 'restoration_items' }`

- [ ] **Step 4: Commit**

```bash
git add backend/src/db/schema.sql backend/src/db/migrate.js
git commit -m "feat: add restoration_items table"
```

---

### Task 2: Restoration service (TDD)

**Files:**
- Create: `backend/src/services/restoration.js`
- Create: `backend/tests/restoration.test.js`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/restoration.test.js`:

```js
import { describe, it, expect } from 'vitest';
import {
  matchesRestorationEntry,
  findRestorationMatch,
  isRestorationItem,
} from '../src/services/restoration.js';
import { normalizePattern } from '../src/services/blacklist.js';

describe('restoration matching', () => {
  const entries = [
    { id: 1, pattern: 'колесо фортуны', matchType: 'exact' },
    { id: 2, pattern: 'реставр', matchType: 'substring' },
  ];

  it('reuses normalizePattern from blacklist', () => {
    expect(normalizePattern('  Колесо  ')).toBe('колесо');
  });

  it('exact match is case-insensitive', () => {
    expect(matchesRestorationEntry('Колесо фортуны', entries[0])).toBe(true);
    expect(matchesRestorationEntry('Колесо фортуны XL', entries[0])).toBe(false);
  });

  it('substring match finds fragment', () => {
    expect(matchesRestorationEntry('Проверка реставрации стойки', entries[1])).toBe(true);
    expect(matchesRestorationEntry('Новая стойка', entries[1])).toBe(false);
  });

  it('findRestorationMatch returns first entry by list order', () => {
    const match = findRestorationMatch('Колесо фортуны', entries);
    expect(match?.id).toBe(1);
  });

  it('isRestorationItem returns boolean', () => {
    expect(isRestorationItem('Баннер 3x6', entries)).toBe(false);
    expect(isRestorationItem('Колесо фортуны', entries)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- tests/restoration.test.js`

Expected: FAIL — module `../src/services/restoration.js` not found

- [ ] **Step 3: Implement restoration service**

Create `backend/src/services/restoration.js`:

```js
import { normalizePattern } from './blacklist.js';

const VALID_MATCH_TYPES = new Set(['exact', 'substring']);

export function matchesRestorationEntry(itemName, entry) {
  const name = normalizePattern(itemName);
  const pattern = normalizePattern(entry.pattern);
  if (!name || !pattern) return false;
  if (entry.matchType === 'exact') return name === pattern;
  if (entry.matchType === 'substring') return name.includes(pattern);
  return false;
}

export function findRestorationMatch(itemName, entries = []) {
  for (const entry of entries) {
    if (matchesRestorationEntry(itemName, entry)) return entry;
  }
  return null;
}

export function isRestorationItem(itemName, entries = []) {
  return findRestorationMatch(itemName, entries) !== null;
}

function mapRow(row) {
  return {
    id: row.id,
    pattern: row.pattern,
    matchType: row.match_type,
    sourceName: row.source_name,
    createdAt: row.created_at,
  };
}

export function loadRestorationList(db) {
  return db
    .prepare('SELECT * FROM restoration_items ORDER BY created_at ASC')
    .all()
    .map(mapRow);
}

export function findRestorationByPattern(db, pattern, matchType) {
  const normalized = normalizePattern(pattern);
  return db
    .prepare('SELECT * FROM restoration_items WHERE pattern = ? AND match_type = ?')
    .get(normalized, matchType);
}

export function createRestorationEntry(db, { pattern, matchType, sourceName = null }) {
  const normalized = normalizePattern(pattern);
  if (!normalized) {
    const err = new Error('pattern is required');
    err.status = 400;
    throw err;
  }
  if (!VALID_MATCH_TYPES.has(matchType)) {
    const err = new Error('matchType must be exact or substring');
    err.status = 400;
    throw err;
  }
  if (findRestorationByPattern(db, normalized, matchType)) {
    const err = new Error('Restoration entry already exists');
    err.status = 409;
    throw err;
  }

  const result = db
    .prepare(
      'INSERT INTO restoration_items (pattern, match_type, source_name) VALUES (?, ?, ?)'
    )
    .run(normalized, matchType, sourceName);

  return mapRow(
    db.prepare('SELECT * FROM restoration_items WHERE id = ?').get(result.lastInsertRowid)
  );
}

export function deleteRestorationEntry(db, id) {
  const existing = db.prepare('SELECT id FROM restoration_items WHERE id = ?').get(id);
  if (!existing) {
    const err = new Error('Restoration entry not found');
    err.status = 404;
    throw err;
  }
  db.prepare('DELETE FROM restoration_items WHERE id = ?').run(id);
}
```

- [ ] **Step 4: Run tests**

Run: `cd backend && npm test -- tests/restoration.test.js`

Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/restoration.js backend/tests/restoration.test.js
git commit -m "feat: add restoration list matching service"
```

---

### Task 3: Zero amounts in opportunity + line item builders (TDD)

**Files:**
- Modify: `backend/src/services/twenty-opportunity.js`
- Modify: `backend/src/services/twenty-line-item.js`
- Modify: `backend/tests/twenty-opportunity.test.js`
- Modify: `backend/tests/twenty-line-item.test.js`

- [ ] **Step 1: Add failing tests for opportunity totals**

Append to `backend/tests/twenty-opportunity.test.js`:

```js
import { computeLineItemTotal } from '../src/services/twenty-opportunity.js';

const restorationList = [
  { id: 1, pattern: 'колесо фортуны', matchType: 'exact' },
];

describe('restoration pricing', () => {
  const deal = { data_source: 'tony' };
  const item = { name: 'Колесо фортуны', price: 18900, quantity: '1', sum: 18900 };

  it('computeLineItemTotal returns 0 for restoration match', () => {
    expect(computeLineItemTotal(item, deal, restorationList)).toBe(0);
  });

  it('computeLineItemTotal unchanged without match', () => {
    expect(
      computeLineItemTotal({ ...item, name: 'Баннер' }, deal, restorationList)
    ).toBe(18900);
  });

  it('computeDealItemsTotal excludes restoration rubles', () => {
    const items = [
      item,
      { name: 'Баннер', price: 10000, quantity: '1', sum: 10000 },
    ];
    expect(computeDealItemsTotal(deal, items, restorationList)).toBe(10000);
  });

  it('buildOpportunityInput amount excludes restoration', () => {
    const d = { data_source: 'tony', title: 'T', crm_event_id: 'e1', start_date: '2026-06-16' };
    const input = buildOpportunityInput(d, [item, { name: 'Баннер', price: 5000, sum: 5000 }], {
      includeStage: false,
      restorationList,
    });
    expect(input.amount.amountMicros).toBe(5000 * 1_000_000);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npm test -- tests/twenty-opportunity.test.js`

Expected: FAIL — `computeLineItemTotal` does not accept third arg / returns non-zero

- [ ] **Step 3: Update twenty-opportunity.js**

At top add import:

```js
import { isRestorationItem } from './restoration.js';
```

Change signatures and logic:

```js
export function computeLineItemTotal(item, deal, restorationList = []) {
  if (isRestorationItem(item.name, restorationList)) return 0;
  const isTony = deal?.data_source === 'tony';
  if (isTony && item.sum != null && Number.isFinite(item.sum)) {
    return item.sum;
  }
  if (item.sum != null && item.sum > 0) {
    return item.sum;
  }
  const qty = item.quantity_num ?? parseQuantityNum(item.quantity);
  return (item.price || 0) * qty;
}

export function computeDealItemsTotal(deal, items, restorationList = []) {
  return items.reduce(
    (total, item) => total + computeLineItemTotal(item, deal, restorationList),
    0
  );
}
```

In `buildOpportunityInput`, destructure `restorationList = []` from `options` and pass to `computeDealItemsTotal`:

```js
export function buildOpportunityInput(deal, items, options = {}) {
  const {
    includeStage = false,
    stage = DEFAULT_OPPORTUNITY_STAGE,
    companyTwentyId = null,
    personTwentyId = null,
    restorationList = [],
  } = options;

  const brandingBudget = computeDealItemsTotal(deal, items, restorationList);
  // ... rest unchanged
}
```

- [ ] **Step 4: Update twenty-line-item.js**

At top:

```js
import { computeLineItemTotal, parseQuantityNum } from './twenty-opportunity.js';
```

Replace `buildLineItemFields`:

```js
function buildLineItemFields(item, options = {}) {
  const { deal = null, restorationList = [] } = options;
  const qty = item.quantity_num ?? parseQuantityNum(item.quantity);
  const lineTotal = computeLineItemTotal(item, deal, restorationList);
  const unitPrice = qty > 0 ? lineTotal / qty : 0;

  const fields = {
    kolichestvo: qty,
    amount: {
      amountMicros: Math.round(unitPrice * 1_000_000),
      currencyCode: 'RUB',
    },
  };

  const comment = (item.comment || '').trim();
  if (comment) fields.kommentariy = comment;

  return fields;
}

export function buildLineItemCreateInput(item, warehouseItemId, opportunityId, position = 'first', options = {}) {
  return {
    name: item.name,
    position,
    warehouseItemId,
    opportunityId,
    ...buildLineItemFields(item, options),
  };
}

export function buildLineItemUpdateInput(item, options = {}) {
  return buildLineItemFields(item, options);
}
```

Remove duplicate `computeLineItemTotal` import from twenty-opportunity if it was only used inline — keep single import path.

- [ ] **Step 5: Add failing line-item test**

Append to `backend/tests/twenty-line-item.test.js`:

```js
describe('restoration line items', () => {
  const restorationList = [{ id: 1, pattern: 'колесо фортуны', matchType: 'exact' }];
  const tonyDeal = { data_source: 'tony' };
  const item = {
    name: 'Колесо фортуны',
    price: 18900,
    quantity: '1',
    sum: 18900,
    quantity_num: 1,
  };

  it('builds create input with zero amount when restoration match', () => {
    const input = buildLineItemCreateInput(
      item, 'wh-001', 'opp-456', 'first', { deal: tonyDeal, restorationList }
    );
    expect(input.amount.amountMicros).toBe(0);
    expect(input.kolichestvo).toBe(1);
    expect(input.stage).toBeUndefined();
  });

  it('builds update input with zero amount when restoration match', () => {
    const input = buildLineItemUpdateInput(item, { deal: tonyDeal, restorationList });
    expect(input.amount.amountMicros).toBe(0);
  });
});
```

- [ ] **Step 6: Run tests**

Run: `cd backend && npm test -- tests/twenty-opportunity.test.js tests/twenty-line-item.test.js`

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/twenty-opportunity.js backend/src/services/twenty-line-item.js backend/tests/twenty-opportunity.test.js backend/tests/twenty-line-item.test.js
git commit -m "feat: zero Twenty amounts for restoration list matches"
```

---

### Task 4: Enrich deal items (TDD)

**Files:**
- Modify: `backend/src/services/twenty-items.js`
- Modify: `backend/tests/twenty-items.test.js`

- [ ] **Step 1: Add failing tests**

Append to `backend/tests/twenty-items.test.js`:

```js
import { enrichDealItems, getItemsForTwenty } from '../src/services/twenty-items.js';

const restorationList = [
  { id: 1, pattern: 'колесо фортуны', matchType: 'exact' },
];

describe('restoration enrich', () => {
  it('adds restorationMatch and twentyLineAmount=0 without changing eligibility', () => {
    const items = [
      {
        id: 1,
        name: 'Колесо фортуны',
        price: 18900,
        sum: 18900,
        classification: 'keyword_match',
        sync_override: null,
      },
    ];
    const enriched = enrichDealItems(items, [], restorationList);
    expect(enriched[0].restorationMatch).toBe(true);
    expect(enriched[0].twentyLineAmount).toBe(0);
    expect(enriched[0].eligibleForTwenty).toBe(true);
  });

  it('ineligible item with restoration pattern stays ineligible', () => {
    const items = [
      {
        id: 2,
        name: 'Колесо фортуны',
        classification: 'unclassified',
        sync_override: null,
      },
    ];
    expect(getItemsForTwenty(items, [], restorationList)).toEqual([]);
    const enriched = enrichDealItems(items, [], restorationList);
    expect(enriched[0].restorationMatch).toBe(true);
    expect(enriched[0].eligibleForTwenty).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npm test -- tests/twenty-items.test.js`

Expected: FAIL — `restorationMatch` undefined

- [ ] **Step 3: Update enrichDealItems**

In `backend/src/services/twenty-items.js`:

```js
import { findBlacklistMatch, isBlacklisted } from './blacklist.js';
import { findRestorationMatch, isRestorationItem } from './restoration.js';
import { computeLineItemTotal } from './twenty-opportunity.js';

// isItemEligibleForTwenty, getItemEligibleReason, getItemsForTwenty — unchanged

export function enrichDealItems(items, blacklist = [], restorationList = []) {
  return items.map((item) => {
    const blacklistHit = findBlacklistMatch(item.name, blacklist);
    const restorationHit = findRestorationMatch(item.name, restorationList);
    const dealContext = { data_source: item._dealDataSource };
    const twentyLineAmount = computeLineItemTotal(
      item,
      dealContext,
      restorationList
    );
    return {
      ...item,
      blacklisted: Boolean(blacklistHit),
      blacklistMatch: blacklistHit
        ? { id: blacklistHit.id, pattern: blacklistHit.pattern, matchType: blacklistHit.matchType }
        : null,
      restorationMatch: Boolean(restorationHit),
      restorationMatchEntry: restorationHit
        ? { id: restorationHit.id, pattern: restorationHit.pattern, matchType: restorationHit.matchType }
        : null,
      twentyLineAmount,
      eligibleForTwenty: isItemEligibleForTwenty(item, blacklist),
      syncMode: item.sync_override ? 'manual' : 'auto',
      eligibleReason: getItemEligibleReason(item, blacklist),
    };
  });
}
```

**Note:** `twentyLineAmount` for enrich uses item-only context. Pass deal data source from routes — update `attachDealItemCounts` and GET `/deals/:id` to set `_dealDataSource` on each item before enrich, OR change signature to `enrichDealItems(items, { blacklist, restorationList, deal })`. Preferred minimal change:

In `deals.js` when enriching:

```js
const enrichedItems = enrichDealItems(
  items.map((i) => ({ ...i, _dealDataSource: deal.data_source })),
  blacklist,
  restorationList
);
```

Same in `attachDealItemCounts` — spread `deal.data_source` onto items before enrich.

- [ ] **Step 4: Run twenty-items tests**

Run: `cd backend && npm test -- tests/twenty-items.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/twenty-items.js backend/tests/twenty-items.test.js
git commit -m "feat: enrich deal items with restoration match and Twenty amount"
```

---

### Task 5: Restoration API routes

**Files:**
- Create: `backend/src/routes/restoration.js`
- Modify: `backend/src/index.js`

- [ ] **Step 1: Create restoration router**

Create `backend/src/routes/restoration.js`:

```js
import { Router } from 'express';
import { getDb } from '../db/connection.js';
import {
  loadRestorationList,
  createRestorationEntry,
  deleteRestorationEntry,
} from '../services/restoration.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDb();
  res.json({ items: loadRestorationList(db) });
});

router.post('/', (req, res) => {
  const { pattern, matchType, sourceName } = req.body ?? {};
  try {
    const db = getDb();
    const item = createRestorationEntry(db, { pattern, matchType, sourceName });
    res.status(201).json({ item });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const db = getDb();
    deleteRestorationEntry(db, Number(req.params.id));
    res.json({ success: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

export default router;
```

- [ ] **Step 2: Mount router**

In `backend/src/index.js`:

```js
import restorationRouter from './routes/restoration.js';
```

After `app.use('/api/blacklist', blacklistRouter);`:

```js
app.use('/api/restoration', restorationRouter);
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/restoration.js backend/src/index.js
git commit -m "feat: add restoration list CRUD API"
```

---

### Task 6: Deals routes + Twenty sync wiring

**Files:**
- Modify: `backend/src/routes/deals.js`
- Modify: `backend/src/services/twenty-sync.js`
- Modify: `backend/src/services/twenty-line-items-sync.js`

- [ ] **Step 1: Update deals.js imports and attachDealItemCounts**

```js
import { loadRestorationList, createRestorationEntry } from '../services/restoration.js';
```

In `attachDealItemCounts`:

```js
  const blacklist = loadBlacklist(db);
  const restorationList = loadRestorationList(db);
  // ...
  return deals.map((deal) => {
    const rawItems = byDeal.get(deal.id) || [];
    const itemsWithSource = rawItems.map((i) => ({ ...i, _dealDataSource: deal.data_source }));
    const enriched = enrichDealItems(itemsWithSource, blacklist, restorationList);
```

In GET `/deals/:id`:

```js
  const restorationList = loadRestorationList(db);
  const items = db.prepare('SELECT * FROM deal_items WHERE deal_id = ?').all(req.params.id);
  const itemsWithSource = items.map((i) => ({ ...i, _dealDataSource: deal.data_source }));
  const enrichedItems = enrichDealItems(itemsWithSource, blacklist, restorationList);
```

- [ ] **Step 2: Add shortcut endpoint**

After blacklist shortcut:

```js
router.post('/:dealId/items/:itemId/restoration', (req, res) => {
  const db = getDb();
  const item = db
    .prepare('SELECT id, name FROM deal_items WHERE id = ? AND deal_id = ?')
    .get(req.params.itemId, req.params.dealId);
  if (!item) return res.status(404).json({ error: 'Item not found' });

  try {
    const entry = createRestorationEntry(db, {
      pattern: item.name,
      matchType: 'exact',
      sourceName: item.name,
    });
    res.status(201).json({ item: entry });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});
```

- [ ] **Step 3: Update twenty-sync.js**

```js
import { loadRestorationList } from './restoration.js';
```

In `buildSyncPreview`:

```js
  const blacklist = loadBlacklist(db);
  const restorationList = loadRestorationList(db);
  const eligibleItems = getItemsForTwenty(allItems, blacklist);
```

Add to preview map:

```js
    eligibleItems: eligibleItems.map((item) => ({
      id: item.id,
      name: item.name,
      reason: getItemEligibleReason(item, blacklist),
      twentyLineAmount: computeLineItemTotal(item, deal, restorationList),
      restorationMatch: isRestorationItem(item.name, restorationList),
    })),
```

Add imports: `computeLineItemTotal` from twenty-opportunity, `isRestorationItem` from restoration.

In `updateDealInTwenty` / `createDealInTwenty`, load restoration list and pass through:

```js
  const restorationList = loadRestorationList(db);
  const oppInput = buildOpportunityInput(deal, items, {
    includeStage: false, // or true for create
    companyTwentyId,
    personTwentyId,
    restorationList,
  });
```

Pass `restorationList` into `syncLineItemsDiff` via new param; thread to `buildLineItemUpdateInput(item, { deal, restorationList })` and create calls.

In `syncLineItemsDiff` (`twenty-line-items-sync.js`), add `restorationList = []` param and pass `{ deal, restorationList }` to buildLineItem* calls.

Optional log in sync:

```js
  const zeroed = eligibleItems.filter((i) => isRestorationItem(i.name, restorationList));
  if (zeroed.length) {
    logTwentyStep('line_items.restoration_zero', { names: zeroed.map((i) => i.name) });
  }
```

- [ ] **Step 4: Run full backend tests**

Run: `cd backend && npm test`

Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/deals.js backend/src/services/twenty-sync.js backend/src/services/twenty-line-items-sync.js
git commit -m "feat: wire restoration list into deals and Twenty sync"
```

---

### Task 7: Frontend API hooks

**Files:**
- Modify: `frontend/src/api.js`

- [ ] **Step 1: Add hooks after blacklist hooks**

```js
export function useRestorationList() {
  return useQuery({
    queryKey: ['restoration'],
    queryFn: () => api.get('/restoration').then((r) => r.data.items),
  });
}

export function useAddRestorationItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ pattern, matchType, sourceName }) =>
      api.post('/restoration', { pattern, matchType, sourceName }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['restoration'] });
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['deal'] });
    },
  });
}

export function useRemoveRestorationItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.delete(`/restoration/${id}`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['restoration'] });
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['deal'] });
    },
  });
}

export function useAddItemToRestoration() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId, itemId }) =>
      api.post(`/deals/${dealId}/items/${itemId}/restoration`).then((r) => r.data),
    onSuccess: (_, { dealId }) => {
      qc.invalidateQueries({ queryKey: ['restoration'] });
      qc.invalidateQueries({ queryKey: ['deal', dealId] });
      qc.invalidateQueries({ queryKey: ['deals'] });
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/api.js
git commit -m "feat: add restoration list React Query hooks"
```

---

### Task 8: Settings UI — restoration section

**Files:**
- Modify: `frontend/src/pages/Settings.jsx`

- [ ] **Step 1: Add imports and state**

Mirror blacklist section with amber styling instead of red:

```js
import {
  // ...existing
  useRestorationList,
  useAddRestorationItem,
  useRemoveRestorationItem,
} from '../api';
```

```js
  const { data: restorationList } = useRestorationList();
  const addRestorationItem = useAddRestorationItem();
  const removeRestorationItem = useRemoveRestorationItem();
  const [newRestorationPattern, setNewRestorationPattern] = useState('');
  const [newRestorationMatchType, setNewRestorationMatchType] = useState('exact');
  const [restorationError, setRestorationError] = useState('');
```

- [ ] **Step 2: Add section after blacklist**

```jsx
      <Section title="Реставрация">
        <p className="text-xs text-ink-muted mb-3">
          Eligible-позиции из списка попадают в Twenty с суммой 0 ₽. Не eligible — не синкаются. Стадия не меняется.
        </p>
        <div className="flex flex-wrap gap-2 mb-3">
          {(restorationList || []).map((entry) => (
            <span
              key={entry.id}
              className="inline-flex items-center gap-1 bg-pastel-amber-bg text-pastel-amber-text px-2 py-1 rounded-md text-sm"
            >
              {entry.sourceName || entry.pattern}
              <span className="text-xs opacity-70">
                ({entry.matchType === 'exact' ? 'точное' : 'фрагмент'})
              </span>
              <button
                type="button"
                onClick={() => removeRestorationItem.mutate(entry.id)}
                className="hover:opacity-70"
              >
                &times;
              </button>
            </span>
          ))}
        </div>
        {restorationError && (
          <p className="text-sm text-pastel-red-text bg-pastel-red-bg px-3 py-2 rounded-md mb-3">{restorationError}</p>
        )}
        <div className="flex flex-wrap gap-2 items-end">
          <input
            type="text"
            value={newRestorationPattern}
            onChange={(e) => setNewRestorationPattern(e.target.value)}
            className="border border-border rounded-md px-3 py-1.5 text-sm flex-1 min-w-[12rem] max-w-lg"
            placeholder="Колесо фортуны"
          />
          <select
            value={newRestorationMatchType}
            onChange={(e) => setNewRestorationMatchType(e.target.value)}
            className="border border-border rounded-md px-3 py-1.5 text-sm"
          >
            <option value="exact">Точное</option>
            <option value="substring">Фрагмент</option>
          </select>
          <button
            type="button"
            onClick={() => {
              setRestorationError('');
              addRestorationItem.mutate(
                { pattern: newRestorationPattern, matchType: newRestorationMatchType },
                {
                  onSuccess: () => setNewRestorationPattern(''),
                  onError: (err) => {
                    setRestorationError(
                      err.response?.status === 409
                        ? 'Уже в списке реставрации'
                        : err.response?.data?.error || 'Ошибка добавления'
                    );
                  },
                }
              );
            }}
            disabled={!newRestorationPattern.trim() || addRestorationItem.isPending}
            className="px-3 py-1.5 bg-pastel-amber-text text-white text-sm rounded-md hover:opacity-90 disabled:opacity-50"
          >
            Добавить
          </button>
        </div>
      </Section>
```

Use existing pastel token classes from the project; adjust if `pastel-amber-*` tokens differ — grep `Settings.jsx` blacklist section for reference.

- [ ] **Step 3: Build frontend**

Run: `cd frontend && npm run build`

Expected: build succeeds

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/Settings.jsx
git commit -m "feat: add restoration list management in Settings"
```

---

### Task 9: DealItems UI

**Files:**
- Modify: `frontend/src/components/DealItems.jsx`

- [ ] **Step 1: Add hook and display**

```js
import { useUpdateItemSyncOverride, useResetSyncOverrides, useAddItemToBlacklist, useAddItemToRestoration } from '../api';
```

```js
  const addToRestoration = useAddItemToRestoration();
```

Add column or extend actions cell — for eligible rows with restoration match show badge; button when not matched:

```jsx
                <td className="font-medium">
                  {item.name}
                  {item.restorationMatch && item.eligibleForTwenty && (
                    <span className="ml-2 text-xs text-pastel-amber-text">реставрация · 0 ₽</span>
                  )}
                </td>
```

In actions cell (alongside blacklist button):

```jsx
                    {!item.blacklisted && item.eligibleForTwenty && (
                      item.restorationMatch ? (
                        <span className="text-xs text-pastel-amber-text">реставрация</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => addToRestoration.mutate({ dealId, itemId: item.id })}
                          disabled={addToRestoration.isPending}
                          className="text-xs text-pastel-amber-text hover:opacity-80 disabled:opacity-50 mr-2"
                        >
                          В реставрацию
                        </button>
                      )
                    )}
```

Widen actions column if needed (`w-40`).

- [ ] **Step 2: Rebuild public assets**

Run: `cd backend && npm run build:public`

Expected: frontend copied to `backend/public`

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/DealItems.jsx
git commit -m "feat: restoration badge and shortcut in deal items"
```

---

### Task 10: Final verification

- [ ] **Step 1: Run all backend tests**

Run: `cd backend && npm test`

Expected: all PASS

- [ ] **Step 2: Manual smoke test**

1. Settings → add exact «Колесо фортуны»
2. Parse/open deal with that eligible item → badge «реставрация · 0 ₽»
3. Sync preview shows `twentyLineAmount: 0` for matched item
4. Sync to Twenty → line item amount 0, no stage set
5. Opportunity amount excludes restoration rubles
6. Ineligible item with same name → not in Twenty
7. Remove from Settings → normal amount on re-sync
8. «В реставрацию» from deal row → appears in Settings

- [ ] **Step 3: Update spec status**

In `docs/superpowers/specs/2026-06-27-restoration-items-design.md` set `Status: Approved (implemented)` or keep Approved.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-06-27-restoration-items-design.md
git commit -m "docs: mark restoration items spec implemented"
```

---

## Spec Coverage Checklist

| Spec requirement | Task |
|------------------|------|
| `restoration_items` table | Task 1 |
| exact + substring matching | Task 2 |
| Eligibility unchanged | Task 4 (tests) |
| Zero line item amount | Tasks 3, 6 |
| Zero opportunity total | Task 3 |
| No stage change | Task 3 (assert no stage in input) |
| Local Tony price preserved | By design — no parse changes |
| CRUD `/api/restoration` | Task 5 |
| Shortcut from deal item | Task 6 |
| Settings UI | Task 8 |
| DealItems button + badge | Task 9 |
| sync/preview uses restoration list | Task 6 |

---

## Follow-up Task 11: Line item stage protection (отдельная фича)

**Spec:** `docs/superpowers/specs/2026-06-27-line-item-stage-protection-design.md`

**Goal:** Не удалять line items в Twenty при re-parse, если `stage !== NOVYY` и `stage != null`; не обновлять такие позиции.

**Files:**
- Modify: `backend/src/services/twenty-line-items-sync.js`
- Modify: `backend/tests/twenty-line-items-sync.test.js`

- [ ] **Step 1:** Запросить `stage` в `listLineItemsForOpportunity`
- [ ] **Step 2:** Добавить `isProtectedLineItemStage`; фильтровать `toDelete` и `toUpdate` в `computeLineItemDiff`; вернуть `preserved`
- [ ] **Step 3:** Лог `line_items.preserved` в `syncLineItemsDiff`
- [ ] **Step 4:** Тесты: protected vs deletable stages, skip update for protected
- [ ] **Step 5:** `npm test -- tests/twenty-line-items-sync.test.js`
- [ ] **Step 6:** Ручная проверка — позиция «В печати» сохраняется после исчезновения из Tony

```bash
git add backend/src/services/twenty-line-items-sync.js backend/tests/twenty-line-items-sync.test.js docs/superpowers/specs/2026-06-27-line-item-stage-protection-design.md
git commit -m "feat: preserve Twenty line items when stage is not NOVYY"
```
| Tests | Tasks 2–4, 10 |
