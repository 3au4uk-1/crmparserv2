# Tony → Twenty Line Items Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync Tony line items to Twenty with comment, numeric quantity, and effective unit price (`sum / quantity`), while calendar fallback keeps current behavior.

**Architecture:** Extend the parse → local DB → Twenty sync pipeline. Tony items gain `comment`, `sum`, and `quantity_num` in SQLite. Twenty gets two new custom fields (`kommentariy`, `kolichestvo`). `twenty-line-item.js` branches on `deal.data_source`: Tony uses new fields; calendar uses legacy `quantity` TEXT + raw `price`. Opportunity amount for Tony deals = Σ `item.sum`.

**Tech Stack:** Node.js (ESM), cheerio, better-sqlite3, vitest, Twenty GraphQL/MCP metadata API. Spec: `docs/superpowers/specs/2026-06-20-twenty-line-items-design.md`.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `backend/src/services/tony-parser.js` | Modify | Parse `.custom_text_value` → `comment` |
| `backend/src/services/tony-mapping.js` | Modify | Pass `sum`, `comment`, `quantity_num` through mapping + hash |
| `backend/src/db/migrate.js` | Modify | Add `comment`, `sum`, `quantity_num` columns |
| `backend/src/db/schema.sql` | Modify | Same columns for fresh installs |
| `backend/src/services/deal-items-update.js` | Modify | INSERT new columns on replace |
| `backend/src/services/parser.js` | Modify | INSERT new columns on Tony deal create |
| `backend/src/services/twenty-opportunity.js` | Modify | `parseQuantityNum`, `computeDealItemsTotal`, Tony budget |
| `backend/src/services/twenty-line-item.js` | Modify | Tony vs calendar input builders |
| `backend/src/services/twenty-line-items-sync.js` | Modify | Pass `dataSource` into line-item builders |
| `backend/src/services/twenty-sync.js` | Modify | Pass `deal` to sync; preview uses `computeDealItemsTotal` |
| `backend/tests/tony-parser.test.js` | Modify | Assert comment from fixture |
| `backend/tests/tony-mapping.test.js` | Modify | Assert sum/comment/hash |
| `backend/tests/deal-items-update.test.js` | Modify | Assert new columns persisted |
| `backend/tests/twenty-line-item.test.js` | Modify | Tony + calendar branches |
| `backend/tests/twenty-opportunity.test.js` | Modify | Tony budget from sum |

---

## Task 1: Twenty CRM metadata (one-time setup)

**Files:**
- Manual: Twenty workspace via MCP `create_field_metadata`

- [ ] **Step 1: Resolve `dealLineItem` object metadata ID**

Run via Twenty MCP `execute_tool` → `get_object_metadata` with `includeFullSystemFields: false` (or `list_object_metadata_names` + get). Record the UUID for object `dealLineItem`.

- [ ] **Step 2: Create field `kommentariy` (TEXT)**

```json
{
  "objectMetadataId": "<dealLineItem-uuid>",
  "type": "TEXT",
  "name": "kommentariy",
  "label": "Комментарий",
  "isNullable": true
}
```

Tool: `create_field_metadata`. Expected: field appears on Позиция сделки in Twenty UI.

- [ ] **Step 3: Create field `kolichestvo` (NUMBER)**

```json
{
  "objectMetadataId": "<dealLineItem-uuid>",
  "type": "NUMBER",
  "name": "kolichestvo",
  "label": "Количество",
  "isNullable": true
}
```

- [ ] **Step 4: Verify fields via MCP**

Run `find_many_deal_line_items` with `select: ["id", "name", "kommentariy", "kolichestvo"]`. Expected: no "Field not found" warnings.

- [ ] **Step 5: Commit (optional note in repo)**

No code change required. Skip commit or add a one-line note to spec status if desired.

---

## Task 2: Local DB columns

**Files:**
- Modify: `backend/src/db/migrate.js`
- Modify: `backend/src/db/schema.sql`
- Test: `backend/tests/migrate-deal-identity.test.js` (add column assertion)

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/migrate-deal-identity.test.js`:

```js
it('adds comment, sum, quantity_num columns to deal_items', () => {
  migrate();
  const cols = db.prepare('PRAGMA table_info(deal_items)').all().map((c) => c.name);
  expect(cols).toContain('comment');
  expect(cols).toContain('sum');
  expect(cols).toContain('quantity_num');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix backend -- migrate-deal-identity`
Expected: FAIL — columns missing.

- [ ] **Step 3: Add columns in migrate.js**

In `migrate()` after existing `ensureColumn` calls for `deal_items`:

```js
ensureColumn(db, 'deal_items', 'comment', 'TEXT');
ensureColumn(db, 'deal_items', 'sum', 'REAL');
ensureColumn(db, 'deal_items', 'quantity_num', 'REAL');
```

- [ ] **Step 4: Update schema.sql**

In `CREATE TABLE deal_items`, add after `discount`:

```sql
comment TEXT,
sum REAL,
quantity_num REAL,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test --prefix backend -- migrate-deal-identity`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/db/migrate.js backend/src/db/schema.sql backend/tests/migrate-deal-identity.test.js
git commit -m "feat: add comment, sum, quantity_num columns to deal_items"
```

---

## Task 3: Parse Tony comment

**Files:**
- Modify: `backend/src/services/tony-parser.js:45-50`
- Test: `backend/tests/tony-parser.test.js`

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/tony-parser.test.js`:

```js
it('parses comment from custom_text_value', () => {
  const banner = parsed.items.find((i) => i.name === 'Навигационные наклейки');
  expect(banner.comment).toBe('+ монтаж');

  const rollup = parsed.items.find((i) => i.name === 'Ролл апп 85х200');
  expect(rollup.comment).toBe('');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix backend -- tony-parser`
Expected: FAIL — `banner.comment` is undefined.

- [ ] **Step 3: Implement comment parsing**

In `tony-parser.js`, inside the `tr[data-id]` loop before `items.push`:

```js
const comment = ($tr.find('.custom_text_value').first().attr('value') || '').trim();
// ...
items.push({ name, price, quantity, discount, sum, category, comment });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --prefix backend -- tony-parser`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/tony-parser.js backend/tests/tony-parser.test.js
git commit -m "feat: parse Tony line item comment from custom_text_value"
```

---

## Task 4: Tony mapping and content hash

**Files:**
- Modify: `backend/src/services/tony-mapping.js`
- Test: `backend/tests/tony-mapping.test.js`

- [ ] **Step 1: Write the failing tests**

Update/add in `backend/tests/tony-mapping.test.js`:

```js
const parsedWithComment = {
  ...parsed,
  items: parsed.items.map((i, idx) =>
    idx === 0 ? { ...i, comment: '+ монтаж' } : { ...i, comment: '' }
  ),
};

it('builds item rows with sum, comment, and quantity_num', () => {
  const items = buildTonyItems(parsedWithComment);
  expect(items[0]).toMatchObject({
    name: 'Навигационные наклейки',
    price: 2640,
    quantity: '9',
    discount: 0,
    sum: 23760,
    comment: '+ монтаж',
    quantity_num: 9,
  });
});

it('hash changes when comment or sum changes', () => {
  const h1 = tonyContentHash(parsedWithComment);
  const changedComment = {
    ...parsedWithComment,
    items: parsedWithComment.items.map((i, idx) =>
      idx === 0 ? { ...i, comment: 'changed' } : i
    ),
  };
  expect(tonyContentHash(changedComment)).not.toBe(h1);
  const changedSum = {
    ...parsedWithComment,
    items: parsedWithComment.items.map((i, idx) =>
      idx === 0 ? { ...i, sum: 1 } : i
    ),
  };
  expect(tonyContentHash(changedSum)).not.toBe(h1);
});
```

Import `parseQuantityNum` from `twenty-opportunity.js` in mapping OR define locally — prefer import from Task 5. If Task 5 not done yet, inline in mapping temporarily:

```js
function parseQuantityNum(value) {
  const n = Number.parseFloat(String(value ?? '').replace(',', '.').replace(/\s/g, ''));
  return Number.isFinite(n) && n > 0 ? n : 1;
}
```

Move to `twenty-opportunity.js` in Task 5 and re-import.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix backend -- tony-mapping`
Expected: FAIL — missing fields on items[0].

- [ ] **Step 3: Update buildTonyItems and tonyContentHash**

```js
import { parseQuantityNum } from './twenty-opportunity.js';

export function buildTonyItems(parsed) {
  return parsed.items.map((i) => ({
    name: i.name,
    price: i.price,
    quantity: i.quantity,
    discount: i.discount ?? 0,
    sum: i.sum ?? 0,
    comment: i.comment ?? '',
    quantity_num: parseQuantityNum(i.quantity),
  }));
}

export function tonyContentHash(parsed) {
  const snapshot = JSON.stringify({
    items: parsed.items.map((i) => [
      i.name, i.price, i.quantity, i.discount, i.sum, i.comment, i.category,
    ]),
    dates: parsed.dates,
    address: parsed.address,
    budget: parsed.budget,
  });
  return crypto.createHash('sha256').update(snapshot).digest('hex');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --prefix backend -- tony-mapping`
Expected: PASS (may need Task 5 `parseQuantityNum` export first)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/tony-mapping.js backend/tests/tony-mapping.test.js
git commit -m "feat: map Tony item sum, comment, and quantity_num"
```

---

## Task 5: Budget helpers and persist new columns

**Files:**
- Modify: `backend/src/services/twenty-opportunity.js`
- Modify: `backend/src/services/deal-items-update.js`
- Modify: `backend/src/services/parser.js:291`
- Test: `backend/tests/twenty-opportunity.test.js`
- Test: `backend/tests/deal-items-update.test.js`

- [ ] **Step 1: Write failing tests for parseQuantityNum and computeDealItemsTotal**

Add to `backend/tests/twenty-opportunity.test.js`:

```js
import { parseQuantityNum, computeDealItemsTotal } from '../src/services/twenty-opportunity.js';

describe('parseQuantityNum', () => {
  it('parses floats and defaults invalid to 1', () => {
    expect(parseQuantityNum('9')).toBe(9);
    expect(parseQuantityNum('1.5')).toBe(1.5);
    expect(parseQuantityNum('')).toBe(1);
    expect(parseQuantityNum('0')).toBe(1);
  });
});

describe('computeDealItemsTotal', () => {
  it('sums item.sum for Tony deals', () => {
    const deal = { data_source: 'tony' };
    const items = [{ sum: 23760 }, { sum: 5000 }];
    expect(computeDealItemsTotal(deal, items)).toBe(28760);
  });

  it('uses price * quantity for calendar deals', () => {
    const deal = { data_source: 'calendar' };
    const items = [{ price: 2640, quantity: '9' }, { price: 5000, quantity: '1' }];
    expect(computeDealItemsTotal(deal, items)).toBe(2640 * 9 + 5000);
  });
});
```

Add to `backend/tests/deal-items-update.test.js` — extend test DB schema with new columns and assert persistence:

```js
// In createTestDb(), add comment TEXT, sum REAL, quantity_num REAL to deal_items

it('persists comment, sum, quantity_num for Tony items', () => {
  replaceDealItemsPreservingOverrides(db, 1, [
    {
      name: 'Баннер',
      price: 2640,
      quantity: '9',
      discount: 0,
      sum: 23760,
      comment: '+ монтаж',
      quantity_num: 9,
      classification: 'keyword_match',
      classification_confidence: 1,
    },
  ], {});

  const row = db.prepare('SELECT * FROM deal_items WHERE name = ?').get('Баннер');
  expect(row.comment).toBe('+ монтаж');
  expect(row.sum).toBe(23760);
  expect(row.quantity_num).toBe(9);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --prefix backend -- twenty-opportunity deal-items-update`
Expected: FAIL — exports/SQL missing.

- [ ] **Step 3: Implement helpers in twenty-opportunity.js**

```js
export function parseQuantityNum(value) {
  const normalized = String(value ?? '').replace(',', '.').replace(/\s/g, '');
  const n = Number.parseFloat(normalized);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function computeDealItemsTotal(deal, items) {
  if (deal?.data_source === 'tony') {
    return items.reduce((sum, i) => sum + (i.sum || 0), 0);
  }
  return items.reduce((sum, i) => sum + (i.price || 0) * parseQuantity(i.quantity), 0);
}
```

Update `buildOpportunityInput`:

```js
const brandingBudget = computeDealItemsTotal(deal, items);
```

- [ ] **Step 4: Update deal-items-update.js INSERT**

```js
const insert = db.prepare(`
  INSERT INTO deal_items (
    deal_id, name, price, quantity, discount,
    comment, sum, quantity_num,
    classification, classification_confidence
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const result = insert.run(
  dealId,
  item.name,
  item.price,
  item.quantity,
  item.discount,
  item.comment ?? null,
  item.sum ?? null,
  item.quantity_num ?? null,
  item.classification,
  item.classification_confidence
);
```

- [ ] **Step 5: Update parser.js Tony INSERT loop (~line 291)**

```js
db.prepare(`
  INSERT INTO deal_items (
    deal_id, name, price, quantity, discount,
    comment, sum, quantity_num,
    classification, classification_confidence
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  dealId, item.name, item.price, item.quantity, item.discount,
  item.comment ?? null, item.sum ?? null, item.quantity_num ?? null,
  item.classification, item.classification_confidence
);
```

Calendar INSERT loops (~348) stay unchanged (NULL for new columns).

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test --prefix backend -- twenty-opportunity deal-items-update tony-mapping`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/twenty-opportunity.js backend/src/services/deal-items-update.js backend/src/services/parser.js backend/tests/twenty-opportunity.test.js backend/tests/deal-items-update.test.js
git commit -m "feat: persist Tony line item sum, comment, quantity_num and compute deal total"
```

---

## Task 6: Twenty line item sync (Tony vs calendar)

**Files:**
- Modify: `backend/src/services/twenty-line-item.js`
- Modify: `backend/src/services/twenty-line-items-sync.js`
- Modify: `backend/src/services/twenty-sync.js`
- Test: `backend/tests/twenty-line-item.test.js`

- [ ] **Step 1: Write failing tests**

Replace/extend `backend/tests/twenty-line-item.test.js`:

```js
describe('Tony line items', () => {
  const tonyItem = {
    name: 'Навигационные наклейки',
    price: 2640,
    quantity: '9',
    sum: 23760,
    comment: '+ монтаж',
    quantity_num: 9,
  };

  it('builds create input with kolichestvo, kommentariy, effective amount', () => {
    const input = buildLineItemCreateInput(
      tonyItem, 'wh-001', 'opp-456', 'first', { dataSource: 'tony' }
    );
    expect(input).toEqual({
      name: 'Навигационные наклейки',
      position: 'first',
      warehouseItemId: 'wh-001',
      opportunityId: 'opp-456',
      kolichestvo: 9,
      kommentariy: '+ монтаж',
      amount: { amountMicros: 2640000000, currencyCode: 'RUB' },
    });
    expect(input.quantity).toBeUndefined();
  });

  it('omits kommentariy when comment is empty', () => {
    const input = buildLineItemCreateInput(
      { ...tonyItem, comment: '' }, 'wh-001', 'opp-456', 'first', { dataSource: 'tony' }
    );
    expect(input.kommentariy).toBeUndefined();
  });

  it('effective price is 0 when sum is 0', () => {
    const input = buildLineItemCreateInput(
      { ...tonyItem, sum: 0, price: 100 }, 'wh-001', 'opp-456', 'first', { dataSource: 'tony' }
    );
    expect(input.amount.amountMicros).toBe(0);
  });

  it('builds update input for Tony items', () => {
    const input = buildLineItemUpdateInput(tonyItem, { dataSource: 'tony' });
    expect(input).toEqual({
      kolichestvo: 9,
      kommentariy: '+ монтаж',
      amount: { amountMicros: 2640000000, currencyCode: 'RUB' },
    });
  });
});

describe('calendar line items (unchanged)', () => {
  it('builds create input with quantity TEXT and raw price', () => {
    const input = buildLineItemCreateInput(
      { name: 'Наклейка', price: 15000, quantity: '3 шт.' },
      'wh-001', 'opp-456'
    );
    expect(input.quantity).toBe('3 шт.');
    expect(input.amount.amountMicros).toBe(15000000000);
    expect(input.kolichestvo).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix backend -- twenty-line-item`
Expected: FAIL

- [ ] **Step 3: Implement twenty-line-item.js**

```js
import { parseQuantity, parseQuantityNum } from './twenty-opportunity.js';

function effectiveTonyUnitPrice(item) {
  const qty = item.quantity_num ?? parseQuantityNum(item.quantity);
  const sum = item.sum ?? 0;
  return qty > 0 ? sum / qty : 0;
}

function buildTonyLineItemFields(item) {
  const fields = {};
  const qty = item.quantity_num ?? parseQuantityNum(item.quantity);
  fields.kolichestvo = qty;

  const comment = (item.comment || '').trim();
  if (comment) fields.kommentariy = comment;

  const unitPrice = effectiveTonyUnitPrice(item);
  fields.amount = {
    amountMicros: Math.round(unitPrice * 1_000_000),
    currencyCode: 'RUB',
  };
  return fields;
}

export function buildLineItemCreateInput(item, warehouseItemId, opportunityId, position = 'first', options = {}) {
  const { dataSource = 'calendar' } = options;
  const input = { name: item.name, position, warehouseItemId, opportunityId };

  if (dataSource === 'tony') {
    Object.assign(input, buildTonyLineItemFields(item));
  } else {
    if (item.quantity != null && item.quantity !== '') {
      input.quantity = String(item.quantity);
    }
    if (item.price != null && !Number.isNaN(item.price)) {
      input.amount = {
        amountMicros: Math.round(item.price * 1_000_000),
        currencyCode: 'RUB',
      };
    }
  }
  return input;
}

export function buildLineItemUpdateInput(item, options = {}) {
  const { dataSource = 'calendar' } = options;
  if (dataSource === 'tony') return buildTonyLineItemFields(item);

  const input = {};
  if (item.quantity != null && item.quantity !== '') {
    input.quantity = String(item.quantity);
  }
  if (item.price != null && !Number.isNaN(item.price)) {
    input.amount = {
      amountMicros: Math.round(item.price * 1_000_000),
      currencyCode: 'RUB',
    };
  }
  return input;
}
```

- [ ] **Step 4: Pass dataSource through sync**

In `twenty-line-items-sync.js`, add `dataSource` param to `syncLineItemsDiff`:

```js
export async function syncLineItemsDiff({ /* existing */, dataSource = 'calendar' }) {
  // ...
  { id: twentyId, input: buildLineItemUpdateInput(item, { dataSource }) }
  // ...
  input: buildLineItemCreateInput(item, warehouseItemId, oppId, position, { dataSource })
}
```

In `twenty-sync.js`, both `syncLineItemsDiff` calls add:

```js
dataSource: deal.data_source || 'calendar',
```

Update `buildSyncPreview`:

```js
import { computeDealItemsTotal } from './twenty-opportunity.js';
// ...
const eligibleAmount = computeDealItemsTotal(deal, eligibleItems);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test --prefix backend -- twenty-line-item twenty-opportunity twenty-sync`
Expected: PASS (fix any broken twenty-sync tests expecting old amount logic for Tony)

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/twenty-line-item.js backend/src/services/twenty-line-items-sync.js backend/src/services/twenty-sync.js backend/tests/twenty-line-item.test.js
git commit -m "feat: sync Tony line items with kolichestvo, kommentariy, and effective price"
```

---

## Task 7: Tony opportunity amount test + full suite

**Files:**
- Modify: `backend/tests/twenty-opportunity.test.js`

- [ ] **Step 1: Add Tony budget test**

```js
it('computes Tony deal amount from sum of item.sum', () => {
  const deal = { title: 'T', crm_event_id: 'e1', data_source: 'tony' };
  const items = [
    { sum: 23760, price: 2640, quantity: '9' },
    { sum: 5000, price: 5000, quantity: '1' },
  ];
  const input = buildOpportunityInput(deal, items);
  expect(input.amount.amountMicros).toBe(28760000000);
});
```

- [ ] **Step 2: Run full backend test suite**

Run: `npm test --prefix backend`
Expected: ALL PASS

- [ ] **Step 3: Commit if any test-only changes remain**

```bash
git add backend/tests/twenty-opportunity.test.js
git commit -m "test: assert Tony opportunity amount uses item.sum"
```

---

## Task 8: Manual verification

- [ ] **Step 1: Re-parse one Tony deal**

Run parser for a date range containing a known Tony order (e.g. #169120 from fixture). Confirm `deal_items` rows have `comment`, `sum`, `quantity_num` populated:

```bash
node backend/scripts/debug-tony-parse.mjs
# or trigger parse via API/UI for a short range
```

- [ ] **Step 2: Sync deal to Twenty**

Sync one Tony deal that has eligible items. Check in Twenty UI (Позиция сделки):

- `Количество` (`kolichestvo`) = numeric (e.g. 9)
- `Комментарий` = «+ монтаж» where applicable
- `amount` = sum/qty (баннер: 2640 ₽)
- Opportunity `amount` = sum of line totals (28760 for fixture order)

- [ ] **Step 3: Re-sync existing deal**

Re-sync a deal that already had line items in Twenty. Confirm existing positions **update** (not skip) with new field values.

---

## Spec Coverage Checklist

| Spec requirement | Task |
|------------------|------|
| Parse comment | Task 3 |
| buildTonyItems includes sum, comment, quantity_num | Task 4 |
| DB columns comment, sum, quantity_num | Task 2, 5 |
| Twenty fields kommentariy, kolichestvo | Task 1 |
| effectivePrice = sum / qty | Task 6 |
| Tony vs calendar branch | Task 6 |
| Opportunity amount = Σ sum | Task 5, 7 |
| Update existing Twenty line items | Task 6 (update path) |
| Edge: qty 0 → 1 | Task 6 via parseQuantityNum |
| Edge: sum 0 → amount 0 | Task 6 test |
| Edge: empty comment omitted | Task 6 test |
| Calendar unchanged | Task 6 calendar tests |
