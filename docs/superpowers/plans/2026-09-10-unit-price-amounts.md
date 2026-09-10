# Unit Price Amounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `dealLineItem.amount` stays unit price when quantity changes; deal total and toolbar turnover equal `Σ(unit × qty)` excluding `OTMENA`.

**Architecture:** Parser stores locked unit in `deal_items.price` and line total in `sum = price × qty`. Twenty `amount` is always unit. Quantity write-back updates qty (and locked `sum`) without rewriting Twenty amount. Opportunity amount is recalculated with `× kolichestvo`.

**Tech Stack:** crmparserv2 Vitest (`backend/`, `npm test`), TwentyView `yarn test:unit`, existing `/amount` write-back pattern.

**Spec:** `docs/superpowers/specs/2026-09-10-deal-stage-filter-unit-amounts-export-design.md` §2

**Repos:** `crmparserv2` first (Tasks 1–4), then `BrandingTwentyView` (Tasks 5–6).

## Global Constraints

- No new «Итого» column. «Сумма» remains unit price.
- Do not run a one-shot recalc of all `opportunity.amount` rows.
- Restoration / ne-nashe stay 0 and cannot amount-lock (existing 400).
- Qty empty or ≤0 counts as 1 in totals (`parseQuantityNum`).
- Changing qty must not PATCH `dealLineItem.amount` and must not set `amount_locked`.
- Unlock create/update from Tony/calendar still derives unit as source total / qty on first write; locked rows write `price` as unit and never `oldSum / newQty`.

## File structure

crmparserv2:
- `backend/src/services/twenty-opportunity.js` — `sumNonCancelledLineAmountsRub`, locked `computeLineItemTotal`
- `backend/src/services/deal-item-amount-lock.js`
- `backend/src/services/twenty-line-item.js` — locked unit
- `backend/src/services/manual-twenty-line-item.js`
- `backend/src/services/deal-item-quantity.js` (create) + `backend/src/routes/twenty.js`
- `backend/src/services/opportunity-amount-recalc.js` — fetch `kolichestvo`

BrandingTwentyView:
- `src/deals-board/analytics/compute.ts` — `lineItemSaleRub`
- `src/deals-board/BoardToolbar.tsx`
- `src/logic-functions/line-item-quantity.ts` (create)
- `src/deals-board/api/crmparser.ts` + `useUpdateRecord.ts`

---

### Task 1: Parser totals = unit × qty (crmparserv2)

**Files:**
- Modify: `backend/src/services/twenty-opportunity.js`
- Modify: `backend/tests/twenty-opportunity.test.js`
- Modify: `backend/src/services/opportunity-amount-recalc.js` (query selection only)

**Interfaces:**
- Consumes: Twenty line items `{ stage, amount: { amountMicros }, kolichestvo }`
- Produces: `sumNonCancelledLineAmountsRub(lineItems): number` = Σ unit×qty, skip `OTMENA`; qty missing/≤0 → 1
- Produces: locked `computeLineItemTotal` = `price * qty` (after lock writes `price` as unit in Task 2)

- [ ] **Step 1: Write the failing test**

Replace the existing `sumNonCancelledLineAmountsRub` example in `backend/tests/twenty-opportunity.test.js` with:

```js
it('sumNonCancelledLineAmountsRub multiplies unit by kolichestvo', () => {
  const sum = sumNonCancelledLineAmountsRub([
    { stage: 'NOVYY', kolichestvo: 2, amount: { amountMicros: 6_000_000_000 } },
    { stage: 'OTMENA', kolichestvo: 10, amount: { amountMicros: 5_000_000_000 } },
    { stage: 'GOTOVO', amount: { amountMicros: 1_000_000_000 } },
  ]);
  expect(sum).toBe(13000); // 6000*2 + 1000*1
});

it('buildOpportunityAmountInputFromLineItems uses unit × qty', () => {
  const input = buildOpportunityAmountInputFromLineItems([
    { stage: 'NOVYY', kolichestvo: 2, amount: { amountMicros: 6_000_000_000 } },
    { stage: 'OTMENA', kolichestvo: 2, amount: { amountMicros: 9_000_000_000 } },
  ]);
  expect(input).toEqual({ amountMicros: 12_000_000_000, currencyCode: 'RUB' });
});
```

Add locked total test (will fully pass after Task 2 writes `price`; for now expect `price * qty`):

```js
it('computeLineItemTotal locked uses price × qty', () => {
  const item = {
    name: 'Баннер',
    price: 6000,
    quantity: '2',
    quantity_num: 2,
    sum: 6000,
    amount_locked: 1,
  };
  expect(computeLineItemTotal(item, { data_source: 'tony' })).toBe(12000);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- backend/tests/twenty-opportunity.test.js`

Expected: FAIL — sum is 7000 (no ×qty); locked still returns stale `sum` 6000.

Working directory: `crmparserv2/backend`.

- [ ] **Step 3: Implement**

`sumNonCancelledLineAmountsRub`:

```js
export function sumNonCancelledLineAmountsRub(lineItems) {
  let total = 0;
  for (const item of lineItems || []) {
    if (isCancelledLineItemStage(item?.stage)) continue;
    const micros = item?.amount?.amountMicros ?? item?.amountMicros;
    if (typeof micros !== 'number' || !Number.isFinite(micros)) continue;
    const qty = parseQuantityNum(item?.kolichestvo ?? item?.quantity_num ?? item?.quantity);
    total += (micros / 1_000_000) * qty;
  }
  return total;
}
```

Locked branch of `computeLineItemTotal` — replace `return locked sum` with:

```js
if (item.amount_locked) {
  const unit = Number(item.price);
  if (!Number.isFinite(unit) || unit < 0) return 0;
  const qty = item.quantity_num ?? parseQuantityNum(item.quantity);
  return unit * qty;
}
```

In `opportunity-amount-recalc.js` `LIST_LINE_ITEMS_QUERY` add `kolichestvo` next to `amount`.

- [ ] **Step 4: Run tests**

Run: `npm test -- backend/tests/twenty-opportunity.test.js`

Expected: PASS for ×qty tests. Locked test PASSES if `price` is used. Update any old locked tests that expected `sum` 18000 with `price` 10000 / qty 2 to expect `20000`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/twenty-opportunity.js backend/tests/twenty-opportunity.test.js backend/src/services/opportunity-amount-recalc.js
git commit -m "fix: opportunity totals multiply unit price by quantity"
```

---

### Task 2: Lock stores unit in `price` (crmparserv2)

**Files:**
- Modify: `backend/src/services/deal-item-amount-lock.js`
- Modify: `backend/tests/deal-item-amount-lock.test.js`

**Interfaces:**
- Consumes: `lockDealItemAmount(db, twentyLineItemId, amountRub)` where `amountRub` is **unit price**
- Produces: `price = amountRub`, `sum = amountRub * qty`, `amount_locked = 1`; `opportunityAmountRub` from `computeDealItemsTotal`

- [ ] **Step 1: Write the failing test**

Change `sets amount_locked and sum` in `deal-item-amount-lock.test.js`. Fixture `li-1` is qty 2. Locking `15000` as unit:

```js
it('sets amount_locked, unit price, and line sum', () => {
  const db = getDb();
  const result = lockDealItemAmount(db, 'li-1', 15000);

  const row = db.prepare(
    'SELECT amount_locked, sum, price, quantity, quantity_num FROM deal_items WHERE twenty_id = ?',
  ).get('li-1');
  expect(row.amount_locked).toBe(1);
  expect(row.price).toBe(15000);
  expect(row.sum).toBe(30000);
  expect(result.amountRub).toBe(15000);
  expect(result.opportunityAmountRub).toBe(35000); // 30000 + li-2 5000
});
```

Update `opportunityAmountRub uses eligible items only` accordingly (15000×2 = 30000 if li-2 excluded).

Keep restoration/ne-nashe 400 tests.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- backend/tests/deal-item-amount-lock.test.js`

Expected: FAIL — still writes `sum=15000` and leaves `price=10000`.

- [ ] **Step 3: Implement**

In `lockDealItemAmount`, after `assertAmountLockAllowed`:

```js
const qty = Number(item.quantity_num) > 0
  ? Number(item.quantity_num)
  : parseQuantityNum(item.quantity);
const sum = amountRub * qty;

db.prepare(`
  UPDATE deal_items
  SET amount_locked = 1, price = ?, sum = ?, quantity_num = ?
  WHERE id = ?
`).run(amountRub, sum, qty, item.id);
```

Import `parseQuantityNum` from `twenty-opportunity.js`.

- [ ] **Step 4: Run tests**

Run: `npm test -- backend/tests/deal-item-amount-lock.test.js backend/tests/twenty-opportunity.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/deal-item-amount-lock.js backend/tests/deal-item-amount-lock.test.js
git commit -m "fix: amount lock stores unit price, not line total"
```

---

### Task 3: Sync and manual upsert keep unit (crmparserv2)

**Files:**
- Modify: `backend/src/services/twenty-line-item.js`
- Modify: `backend/tests/twenty-line-item.test.js`
- Modify: `backend/src/services/manual-twenty-line-item.js`
- Modify: `backend/tests/manual-twenty-line-item.test.js`

**Interfaces:**
- Consumes: `item.amount_locked`, `item.price`, `item.quantity_num`
- Produces: `buildLineItemFields` `amount.amountMicros` = unit. Locked: `Math.round(price * 1e6)`, never `sum/qty` from a stale sum. Manual upsert: `price = unit`, `sum = unit * qty`.

- [ ] **Step 1: Write the failing tests**

`twenty-line-item.test.js`:

```js
it('locked update writes unit price, not sum / new qty', () => {
  const input = buildLineItemUpdateInput(
    {
      name: 'Баннер',
      price: 6000,
      quantity: '2',
      quantity_num: 2,
      sum: 6000,
      amount_locked: 1,
    },
    { deal: { data_source: 'tony' } },
  );
  expect(input.kolichestvo).toBe(2);
  expect(input.amount.amountMicros).toBe(6_000_000_000);
});
```

`manual-twenty-line-item.test.js` — after create with `kolichestvo: 2`, `amountMicros: 1_500_000_000` (1500 ₽ unit):

```js
expect(row.price).toBe(1500);
expect(row.sum).toBe(3000);
expect(row.quantity_num).toBe(2);
```

(Replace current `expect(row.sum).toBe(1500)`.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- backend/tests/twenty-line-item.test.js backend/tests/manual-twenty-line-item.test.js`

Expected: FAIL — locked unit becomes 3000 ₽ (6000/2); manual `sum` is 1500.

- [ ] **Step 3: Implement**

`buildLineItemFields` — after `qty` is known:

```js
let unitPrice;
if (item.amount_locked) {
  const unit = Number(item.price);
  unitPrice = Number.isFinite(unit) && unit >= 0 ? unit : 0;
} else {
  const lineTotal = computeLineItemTotal(item, deal, restorationList, neNasheLists);
  unitPrice = qty > 0 ? lineTotal / qty : 0;
}
```

Keep restoration/ne-nashe zero via `computeLineItemTotal` / `shouldZeroLineItemAmount` before this (if restoration, `computeLineItemTotal` is 0; locked restoration is already forbidden). If `shouldZeroLineItemAmount(item.name, …)` then `unitPrice = 0`.

`upsertManualTwentyLineItem`:

```js
const qty = Number(payload.kolichestvo) > 0 ? Number(payload.kolichestvo) : 1;
const unitPrice = amountMicrosToRubles(payload.amountMicros);
const totalRub = unitPrice * qty;
```

Write `price = unitPrice`, `sum = totalRub` (remove `unit = total/qty`).

- [ ] **Step 4: Run tests**

Run: `npm test -- backend/tests/twenty-line-item.test.js backend/tests/manual-twenty-line-item.test.js`

Expected: PASS. Calendar unlocked still derives unit as total/qty (existing tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/twenty-line-item.js backend/src/services/manual-twenty-line-item.js backend/tests/twenty-line-item.test.js backend/tests/manual-twenty-line-item.test.js
git commit -m "fix: keep Twenty amount as unit price on sync and manual upsert"
```

---

### Task 4: POST quantity write-back (crmparserv2)

**Files:**
- Create: `backend/src/services/deal-item-quantity.js`
- Create: `backend/tests/deal-item-quantity.test.js`
- Modify: `backend/src/routes/twenty.js`

**Interfaces:**
- Consumes: `writeDealItemQuantity(db, twentyLineItemId, kolichestvo)`
- Produces: `{ dealId, itemId, kolichestvo, opportunityAmountRub }`. Updates `quantity`/`quantity_num`. If `amount_locked`, `sum = price * qty`, do not change `price`. Never sets `amount_locked`. Invalid qty → 400. Missing id → 404.

- [ ] **Step 1: Write the failing test**

`backend/tests/deal-item-quantity.test.js` — same DB setup as amount-lock tests (deal + li-1 qty 2 price 10000). Then:

```js
import { writeDealItemQuantity } from '../src/services/deal-item-quantity.js';
import { lockDealItemAmount } from '../src/services/deal-item-amount-lock.js';

it('updates qty without locking', () => {
  const db = getDb();
  const result = writeDealItemQuantity(db, 'li-1', 3);
  const row = db.prepare('SELECT * FROM deal_items WHERE twenty_id = ?').get('li-1');
  expect(row.quantity_num).toBe(3);
  expect(row.amount_locked).toBe(0);
  expect(result.kolichestvo).toBe(3);
});

it('locked row keeps unit price and refreshes sum', () => {
  const db = getDb();
  lockDealItemAmount(db, 'li-1', 6000);
  writeDealItemQuantity(db, 'li-1', 2);
  const row = db.prepare('SELECT price, sum, amount_locked FROM deal_items WHERE twenty_id = ?').get('li-1');
  expect(row.amount_locked).toBe(1);
  expect(row.price).toBe(6000);
  expect(row.sum).toBe(12000);
});

it('throws 400 for non-positive qty', () => {
  expectHttpError(() => writeDealItemQuantity(getDb(), 'li-1', 0), 400, 'kolichestvo');
});
```

Copy `expectHttpError` from the amount-lock test file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- backend/tests/deal-item-quantity.test.js`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement service + route**

`deal-item-quantity.js`:

```js
import { findDealItemByTwentyId } from './twenty-line-item-api.js';
import { parseQuantityNum } from './twenty-opportunity.js';
import { getCachedPatternLists } from './pattern-lists-cache.js';
import { getItemsForTwenty } from './twenty-items.js';
import { computeDealItemsTotal } from './twenty-opportunity.js';

function computeOpportunityAmountRub(db, deal) {
  const allItems = db.prepare('SELECT * FROM deal_items WHERE deal_id = ?').all(deal.id);
  const { streamContext, restorationList, neNasheBrandingList, neNasheDecorMkList } =
    getCachedPatternLists(db);
  const eligibleItems = getItemsForTwenty(allItems, streamContext);
  return computeDealItemsTotal(
    deal,
    eligibleItems,
    restorationList,
    { neNasheBrandingList, neNasheDecorMkList },
  );
}

export function writeDealItemQuantity(db, twentyLineItemId, kolichestvo) {
  const qty = Number(kolichestvo);
  if (!Number.isFinite(qty) || qty <= 0) {
    const err = new Error('kolichestvo must be a finite number > 0');
    err.status = 400;
    throw err;
  }
  const { item, deal } = findDealItemByTwentyId(db, twentyLineItemId);
  if (item.amount_locked) {
    const unit = Number(item.price);
    const price = Number.isFinite(unit) && unit >= 0 ? unit : 0;
    db.prepare(`
      UPDATE deal_items
      SET quantity = ?, quantity_num = ?, sum = ?
      WHERE id = ?
    `).run(String(qty), qty, price * qty, item.id);
  } else {
    db.prepare(`
      UPDATE deal_items SET quantity = ?, quantity_num = ? WHERE id = ?
    `).run(String(qty), qty, item.id);
  }
  return {
    dealId: deal.id,
    itemId: item.id,
    kolichestvo: qty,
    opportunityAmountRub: computeOpportunityAmountRub(db, deal),
  };
}
```

Prefer extracting `computeOpportunityAmountRub` from `deal-item-amount-lock.js` into a tiny shared helper if both files would otherwise duplicate it — only if the extract is mechanical.

Route next to the amount handler:

```js
import { writeDealItemQuantity } from '../services/deal-item-quantity.js';

router.post('/line-items/:twentyLineItemId/quantity', async (req, res, next) => {
  try {
    const db = getDb();
    const result = writeDealItemQuantity(db, req.params.twentyLineItemId, req.body?.kolichestvo);
    const sync = await syncDealToTwenty(result.dealId, { ignoreLineItemStageProtection: true });
    res.json({
      success: true,
      kolichestvo: result.kolichestvo,
      opportunityAmountRub: result.opportunityAmountRub,
      dealId: result.dealId,
      sync,
    });
  } catch (err) {
    next(err);
  }
});
```

`syncDealToTwenty` with lock must not rewrite Twenty `amount` (Task 3). Qty on protected stages: existing stage-protection still applies to Tony overwrites; this route is a user write-back.

- [ ] **Step 4: Run tests**

Run: `npm test -- backend/tests/deal-item-quantity.test.js backend/tests/deal-item-amount-lock.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/deal-item-quantity.js backend/tests/deal-item-quantity.test.js backend/src/routes/twenty.js backend/src/services/deal-item-amount-lock.js
git commit -m "feat: write back line-item quantity without changing unit price"
```

---

### Task 5: TwentyView sale helper + toolbar (BrandingTwentyView)

**Files:**
- Modify: `src/deals-board/analytics/compute.ts`
- Modify: `src/deals-board/analytics/compute.test.ts`
- Modify: `src/deals-board/BoardToolbar.tsx`

**Interfaces:**
- Produces: `lineItemQty(item): number` — `kolichestvo > 0` else 1
- Produces: `lineItemSaleRub(item): number` — 0 if `stage === 'OTMENA'`, else `currencyToRub(amount) * qty`

- [ ] **Step 1: Write the failing test**

In `analytics/compute.test.ts`:

```ts
import { lineItemSaleRub } from './compute';

it('lineItemSaleRub multiplies unit by qty and skips OTMENA', () => {
  expect(
    lineItemSaleRub({
      stage: 'NOVYY',
      kolichestvo: 2,
      amount: { amountMicros: 6_000_000_000, currencyCode: 'RUB' },
    }),
  ).toBe(12000);
  expect(
    lineItemSaleRub({
      stage: 'OTMENA',
      kolichestvo: 9,
      amount: { amountMicros: 6_000_000_000, currencyCode: 'RUB' },
    }),
  ).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test:unit src/deals-board/analytics/compute.test.ts`

Expected: FAIL — `lineItemSaleRub` not exported.

- [ ] **Step 3: Implement**

```ts
export const lineItemQty = (item: { kolichestvo?: number }): number =>
  typeof item.kolichestvo === 'number' && item.kolichestvo > 0 ? item.kolichestvo : 1;

export const lineItemSaleRub = (item: {
  stage?: string | null;
  kolichestvo?: number;
  amount?: CurrencyAmount;
}): number => {
  if (item.stage === 'OTMENA') return 0;
  return currencyToRub(item.amount) * lineItemQty(item);
};
```

`BoardToolbar.tsx` turnover:

```ts
lineItems.reduce((sum, item) => sum + lineItemSaleRub(item), 0)
```

Analytics monthly `turnoverRub`:

```ts
positions.reduce((sum, item) => sum + lineItemSaleRub(item), 0)
```

(`positions` is already non-OTMENA; helper still safe.)

- [ ] **Step 4: Run tests**

Run: `yarn test:unit src/deals-board/analytics/compute.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/deals-board/analytics/compute.ts src/deals-board/analytics/compute.test.ts src/deals-board/BoardToolbar.tsx
git commit -m "fix: board turnover multiplies unit price by quantity"
```

---

### Task 6: Quantity proxy + write-back after save (BrandingTwentyView)

**Files:**
- Modify: `src/constants/universal-identifiers.ts`
- Create: `src/logic-functions/line-item-quantity.ts` (copy `line-item-amount.ts`)
- Modify: `src/deals-board/api/crmparser.ts`
- Modify: `src/deals-board/api/crmparser.test.ts`
- Modify: `src/deals-board/hooks/useUpdateRecord.ts`

**Interfaces:**
- Produces: UUID `LINE_ITEM_QUANTITY_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER = 'c8e1a4b2-7d3f-4a91-b6c0-2e9f8d1a5b73'`
- Produces: POST `/crmparser/line-items/:lineItemId/quantity` `{ kolichestvo }`
- Produces: `writeBackLineItemQuantity(id, kolichestvo): { opportunityAmountRub }`
- After successful `dealLineItem` save, if `'kolichestvo' in patch`, call write-back and patch `opportunity.amount` like `CurrencyAmountCell`.

- [ ] **Step 1: Write the failing client test**

In `crmparser.test.ts` next to amount write-back:

```ts
it('writeBackLineItemQuantity posts kolichestvo to logic function', async () => {
  // same fetch mock pattern as writeBackLineItemAmount
  const result = await writeBackLineItemQuantity('li-42', 2);
  expect(result.opportunityAmountRub).toBe(12000);
  expect(fetchMock).toHaveBeenCalledWith(
    'https://twenty.test/functions/crmparser/line-items/li-42/quantity',
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ kolichestvo: 2 }),
    }),
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test:unit src/deals-board/api/crmparser.test.ts`

Expected: FAIL — `writeBackLineItemQuantity` missing.

- [ ] **Step 3: Implement proxy, client, hook**

Logic function: clone `line-item-amount.ts`, parse `{ kolichestvo?: number }`, reject if not a finite number `> 0`, POST parser `/twenty/line-items/:id/quantity`.

`crmparser.ts`:

```ts
export async function writeBackLineItemQuantity(
  lineItemId: string,
  kolichestvo: number,
): Promise<{ success: true; kolichestvo: number; opportunityAmountRub: number }> {
  return logicFunctionFetch(
    `/crmparser/line-items/${encodeURIComponent(lineItemId)}/quantity`,
    { method: 'POST', body: JSON.stringify({ kolichestvo }) },
  );
}
```

In `useUpdateRecord` `onSettled`, after `syncManualLineItemAfterUpdate`, if `objectName === 'dealLineItem' && !error && 'kolichestvo' in variables.data`:

```ts
const qty = variables.data.kolichestvo;
if (typeof qty === 'number' && Number.isFinite(qty) && qty > 0) {
  try {
    const result = await writeBackLineItemQuantity(variables.id, qty);
    if (typeof result.opportunityAmountRub === 'number') {
      const opportunityId = findLineItemOpportunityId(queryClient, variables.id);
      if (opportunityId) {
        patchOpportunityInCache(queryClient, opportunityId, {
          amount: {
            amountMicros: Math.round(result.opportunityAmountRub * 1_000_000),
            currencyCode: 'RUB',
          },
        });
      }
    }
  } catch (writeBackError) {
    window.alert(
      writeBackError instanceof Error
        ? writeBackError.message
        : 'Не удалось записать количество в парсер. Значение в Twenty сохранено.',
    );
  }
}
```

Import `findLineItemOpportunityId` / `patchOpportunityInCache` from `../utils/opportunity-cache` (same as `CurrencyAmountCell`). Do **not** write `amount` on the line item.

404 from parser: existing `logicFunctionFetch` throws; alert as above; Twenty qty stays.

After adding the logic function run `yarn twenty apply` before claiming UI write-back works against a live CRM.

- [ ] **Step 4: Run tests**

Run: `yarn test:unit src/deals-board/api/crmparser.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/constants/universal-identifiers.ts src/logic-functions/line-item-quantity.ts src/deals-board/api/crmparser.ts src/deals-board/api/crmparser.test.ts src/deals-board/hooks/useUpdateRecord.ts
git commit -m "feat: write back quantity to parser after Twenty save"
```
