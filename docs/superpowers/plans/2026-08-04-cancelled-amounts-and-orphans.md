# Cancelled amounts + stage create + orphans report — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `opportunity.amount` exclude cancelled (`OTMENA`) line items, zero line-item amounts on cancel, set `stage: NOVYY` on PARSER create, one-shot-recalc opportunity amounts, and fix analytics dealCount/expense; orphans stay report-only.

**Architecture:** Pure helpers for “cancelled stage” and Σ of non-cancelled Twenty line amounts; cancel mutations write `amount: 0`; after line-item sync, opportunity amount is set from Twenty (SoT); one-shot flagged job mirrors free-entry repair; BrandingTwentyView analytics filters out `OTMENA` opportunities for counts/expenses.

**Tech Stack:** Node ESM, Vitest, Twenty GraphQL, React/Vitest in BrandingTwentyView.

**Spec:** `docs/superpowers/specs/2026-08-04-cancelled-amounts-and-orphans-design.md`

## Global Constraints

- Work in `crmparserv2` on `staging` for parser tasks; BrandingTwentyView for analytics only.
- TDD: failing test → implement → pass → commit per task.
- Do not push unless asked.
- Cancelled stage value: `OTMENA` (`CANCELLED_OPPORTUNITY_STAGE`).
- Create default line stage: `NOVYY` (`DEFAULT_OPPORTUNITY_STAGE`).
- One-shot flag: `opportunity_amount_recalc_v1` (+ `_started_at`); stale `running` = 6h.
- One-shot does **not** zero existing `OTMENA` line amounts.
- Do not delete orphans; do not backfill null stages.
- Restore must not restore amounts (Tony sync does).
- Soft per-deal / hard auth-network on one-shot (same pattern as free-entry repair).

---

## File map

| File | Responsibility |
|------|----------------|
| `backend/src/services/twenty-line-item.js` | `stage: NOVYY` on create only |
| `backend/tests/twenty-line-item.test.js` | Create/update stage assertions |
| `backend/src/services/twenty-opportunity.js` | `isCancelledLineItemStage`, `sumNonCancelledLineAmountsRub` |
| `backend/tests/twenty-opportunity.test.js` | Helper unit tests |
| `backend/src/services/twenty-line-items-sync.js` | Cancel zeros amount; list includes amount |
| `backend/tests/twenty-line-items-sync.test.js` / `twenty-sync.test.js` | Cancel input assertions |
| `backend/src/services/twenty-sync.js` | Cancel opp amount 0; after sync set opp amount from Twenty |
| `backend/src/services/opportunity-amount-recalc.js` | One-shot job |
| `backend/tests/opportunity-amount-recalc.test.js` | Flag machine + recalc |
| `backend/src/index.js` | Kick one-shot after listen |
| `BrandingTwentyView/src/deals-board/analytics/compute.ts` | Exclude OTMENA deals from dealCount/expense |
| `BrandingTwentyView/src/deals-board/analytics/compute.test.ts` | Analytics cases |
| Spec CSV | Already present (orphans A report) |

---

### Task 1: `stage: NOVYY` on line-item create

**Files:**
- Modify: `backend/src/services/twenty-line-item.js`
- Modify: `backend/tests/twenty-line-item.test.js`

**Interfaces:**
- Produces: `buildLineItemCreateInput(...)` includes `stage: 'NOVYY'`
- Produces: `buildLineItemUpdateInput(...)` does **not** include `stage`

- [ ] **Step 1: Write failing tests**

```js
it('buildLineItemCreateInput sets stage NOVYY', () => {
  const input = buildLineItemCreateInput(
    { name: 'Наклейка', price: 1000, quantity: '1' },
    'wh-001',
    'opp-456',
  );
  expect(input.stage).toBe('NOVYY');
});

it('buildLineItemUpdateInput does not set stage', () => {
  const input = buildLineItemUpdateInput({ name: 'Наклейка', price: 1000, quantity: '1' });
  expect(input).not.toHaveProperty('stage');
});
```

Also update any existing create-input `toEqual` snapshots in this file to include `stage: 'NOVYY'`.

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd backend && npm test -- tests/twenty-line-item.test.js
```

- [ ] **Step 3: Implement**

In `buildLineItemCreateInput` only (not `buildLineItemFields` shared with update):

```js
export function buildLineItemCreateInput(item, warehouseItemId, opportunityId, position = 'first', options = {}) {
  return {
    name: item.name,
    position,
    warehouseItemId,
    opportunityId,
    stage: 'NOVYY',
    ...buildLineItemFields(item, options),
  };
}
```

Prefer importing `DEFAULT_OPPORTUNITY_STAGE` from `twenty-opportunity.js` instead of a string literal.

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/twenty-line-item.js backend/tests/twenty-line-item.test.js
git commit -m "Set NOVYY stage when creating PARSER deal line items."
```

---

### Task 2: Pure amount helpers (non-cancelled Σ)

**Files:**
- Modify: `backend/src/services/twenty-opportunity.js`
- Modify: `backend/tests/twenty-opportunity.test.js`

**Interfaces:**
- Produces: `export function isCancelledLineItemStage(stage): boolean` — true iff `stage === CANCELLED_OPPORTUNITY_STAGE` (`OTMENA`); `null`/`undefined` → false
- Produces: `export function sumNonCancelledLineAmountsRub(lineItems): number` — sums `amount.amountMicros / 1e6` (or numeric `amountMicros`) for items where `!isCancelledLineItemStage(item.stage)`; missing/invalid micros → 0
- Produces: `export const ZERO_RUB_AMOUNT = { amountMicros: 0, currencyCode: 'RUB' }`

- [ ] **Step 1: Write failing tests**

```js
describe('non-cancelled amount helpers', () => {
  it('isCancelledLineItemStage only for OTMENA', () => {
    expect(isCancelledLineItemStage('OTMENA')).toBe(true);
    expect(isCancelledLineItemStage('NOVYY')).toBe(false);
    expect(isCancelledLineItemStage(null)).toBe(false);
  });

  it('sumNonCancelledLineAmountsRub skips OTMENA', () => {
    const sum = sumNonCancelledLineAmountsRub([
      { stage: 'NOVYY', amount: { amountMicros: 10_000_000_000 } },
      { stage: 'OTMENA', amount: { amountMicros: 5_000_000_000 } },
      { stage: null, amount: { amountMicros: 2_000_000_000 } },
    ]);
    expect(sum).toBe(12000);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd backend && npm test -- tests/twenty-opportunity.test.js
```

- [ ] **Step 3: Implement** in `twenty-opportunity.js` (next to `CANCELLED_OPPORTUNITY_STAGE`)

```js
export const ZERO_RUB_AMOUNT = { amountMicros: 0, currencyCode: 'RUB' };

export function isCancelledLineItemStage(stage) {
  return stage === CANCELLED_OPPORTUNITY_STAGE;
}

export function sumNonCancelledLineAmountsRub(lineItems) {
  let total = 0;
  for (const item of lineItems || []) {
    if (isCancelledLineItemStage(item?.stage)) continue;
    const micros = item?.amount?.amountMicros ?? item?.amountMicros;
    if (typeof micros === 'number' && Number.isFinite(micros)) total += micros / 1_000_000;
  }
  return total;
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/twenty-opportunity.js backend/tests/twenty-opportunity.test.js
git commit -m "Add helpers to sum opportunity amount excluding OTMENA line items."
```

---

### Task 3: Cancel zeros line-item amount + opportunity amount

**Files:**
- Modify: `backend/src/services/twenty-line-items-sync.js` (`cancelLineItemsForOpportunity`)
- Modify: `backend/src/services/twenty-sync.js` (`cancelDealInTwenty`)
- Modify: `backend/tests/twenty-sync.test.js` (and/or line-items-sync tests covering cancel mutation variables)

**Interfaces:**
- Consumes: `ZERO_RUB_AMOUNT`, `CANCELLED_OPPORTUNITY_STAGE`
- Changes: cancel line mutation input `{ stage: OTMENA, amount: ZERO_RUB_AMOUNT }`
- Changes: cancel opportunity mutation input includes `amount: ZERO_RUB_AMOUNT` plus stage

- [ ] **Step 1: Write failing test** asserting cancel GraphQL variables include zero amount

In `twenty-sync.test.js` (extend existing cancel test): after `cancelDealInTwenty`, find mutation calls and expect:

```js
expect(lineItemInput).toMatchObject({
  stage: 'OTMENA',
  amount: { amountMicros: 0, currencyCode: 'RUB' },
});
expect(opportunityInput).toMatchObject({
  stage: 'OTMENA',
  amount: { amountMicros: 0, currencyCode: 'RUB' },
});
```

Adapt to how the test currently captures `axiosPost` / gql mocks.

- [ ] **Step 2: Run — expect FAIL**

```bash
cd backend && npm test -- tests/twenty-sync.test.js
```

- [ ] **Step 3: Implement**

`cancelLineItemsForOpportunity` input:

```js
{ id: li.id, input: { stage: cancelledStage, amount: ZERO_RUB_AMOUNT } }
```

`cancelDealInTwenty` opportunity cancel:

```js
{ id: deal.twenty_id, input: { stage: CANCELLED_OPPORTUNITY_STAGE, amount: ZERO_RUB_AMOUNT } }
```

Import `ZERO_RUB_AMOUNT` from `twenty-opportunity.js`.

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/twenty-line-items-sync.js backend/src/services/twenty-sync.js backend/tests/twenty-sync.test.js
git commit -m "Zero line and opportunity amounts when cancelling a deal in Twenty."
```

---

### Task 4: After sync, set opportunity.amount from Twenty non-OTMENA

**Files:**
- Modify: `backend/src/services/twenty-line-items-sync.js` — extend `listLineItemsForOpportunity` (and repair list if needed) to return `amount { amountMicros currencyCode }`
- Modify: `backend/src/services/twenty-sync.js` — after `syncLineItemsDiff` on update (and after create line sync), write opportunity amount from `sumNonCancelledLineAmountsRub`
- Modify: tests that mock list query / update amount

**Interfaces:**
- Consumes: `sumNonCancelledLineAmountsRub`, `listLineItemsForOpportunity`
- Produces: post-sync `updateOpportunity` with `amount: { amountMicros: Math.round(rub * 1e6), currencyCode: 'RUB' }`

- [ ] **Step 1: Failing test** — sync update path: existing Twenty items include one `OTMENA` with money and one `NOVYY`; after sync, opportunity update amount equals only NOVYY (plus any created). Prefer a focused unit test that calls a small exported helper:

```js
export function buildOpportunityAmountInputFromLineItems(lineItems) {
  const rub = sumNonCancelledLineAmountsRub(lineItems);
  return { amountMicros: Math.round(rub * 1_000_000), currencyCode: 'RUB' };
}
```

Place helper in `twenty-opportunity.js`. Wire sync to: re-list line items after diff → `updateOpportunity({ amount: buildOpportunityAmountInputFromLineItems(listed) })`.

- [ ] **Step 2: Run FAIL → implement → PASS**

Wire in `updateDealInTwenty` after `syncLineItemsDiff`:

```js
const after = await listLineItemsForOpportunity(...);
const amount = buildOpportunityAmountInputFromLineItems(after);
await gql(..., { id: oppId, input: { amount } });
```

Same after create path line-item sync.

Note: first opportunity update in the function may still send local-computed amount; the post-sync write is the SoT correction. Optionally remove amount from the first `buildOpportunityInput` later (YAGNI — leave both if simpler).

- [ ] **Step 3: Commit**

```bash
git commit -m "Recalculate opportunity amount from non-OTMENA Twenty line items after sync."
```

---

### Task 5: One-shot `opportunity_amount_recalc_v1`

**Files:**
- Create: `backend/src/services/opportunity-amount-recalc.js`
- Create: `backend/tests/opportunity-amount-recalc.test.js`
- Modify: `backend/src/index.js` — `setImmediate` kick (alongside free-entry repair)

**Interfaces:**
- Produces: `export async function runOpportunityAmountRecalcIfNeeded(deps?): Promise<{ status: 'skipped'|'done'|'failed', reason?: string, updated?: number, dealsFailed?: number }>`
- Settings keys: `opportunity_amount_recalc_v1`, `opportunity_amount_recalc_v1_started_at`
- Per deal: list line items with amounts → `expected = buildOpportunityAmountInputFromLineItems` → if differs from current opp amount by ≥ 1 ₽ (1e6 micros), update
- Does **not** mutate line-item amounts
- Hard vs soft errors: reuse narrow matcher pattern from free-entry (`401|403|timeout|ECONN*|not configured|endpoint not found`)

- [ ] **Step 1: Failing tests** for: skip when `done`; skip fresh `running`; retry stale `running`; updates mismatched opp; skips equal; soft deal continue; hard 401 → `failed`

- [ ] **Step 2: Implement runner** (DI: `getDb`, `requireTwentyConfig`, `gql`, asserts, list fn)

Load deals with non-null `twenty_id`. For each: find opportunity amount (via `find` query or pass from list of opportunities — prefer `gql` query one opportunity amount + list line items). Soft-catch per deal.

- [ ] **Step 3: Wire `index.js`**

```js
setImmediate(() => {
  runOpportunityAmountRecalcIfNeeded().catch((err) => {
    console.error('[opportunity-amount-recalc] startup failed', err);
  });
});
```

(Keep existing free-entry `setImmediate`; can share one callback that awaits both.)

- [ ] **Step 4: Run focused suite PASS**

```bash
cd backend && npm test -- tests/opportunity-amount-recalc.test.js
```

- [ ] **Step 5: Commit**

```bash
git commit -m "Add one-shot opportunity amount recalc excluding OTMENA line items."
```

---

### Task 6: Analytics — exclude OTMENA deals from dealCount/expense

**Files:**
- Modify: `BrandingTwentyView/src/deals-board/analytics/compute.ts`
- Modify: `BrandingTwentyView/src/deals-board/analytics/compute.test.ts`

**Interfaces:**
- Change: `deals` filter adds `opportunity.stage !== 'OTMENA'` (turnover already excludes OTMENA positions)

- [ ] **Step 1: Failing test**

```ts
it('excludes OTMENA opportunities from dealCount and expense', () => {
  const monthKey = getMonthKey(new Date(2026, 6, 15));
  const finance = computeMonthlyFinance(
    [
      {
        id: 'd1',
        name: 'Active',
        stage: 'NOVYY',
        loadDate: '2026-07-10T10:00:00.000Z',
        rashodItogo: { amountMicros: 200_000_000 },
      },
      {
        id: 'd2',
        name: 'Cancelled',
        stage: 'OTMENA',
        loadDate: '2026-07-11T10:00:00.000Z',
        rashodItogo: { amountMicros: 999_000_000 },
      },
    ],
    [
      {
        id: 'i1',
        opportunityId: 'd1',
        name: 'A',
        stage: 'NOVYY',
        amount: { amountMicros: 1_000_000_000, currencyCode: 'RUB' },
      },
    ],
    monthKey,
  );
  expect(finance.dealCount).toBe(1);
  expect(finance.expenseRub).toBe(200);
  expect(finance.turnoverRub).toBe(1000);
});
```

- [ ] **Step 2: Implement**

```ts
const deals = opportunities.filter(
  (opportunity) =>
    opportunityInMonth(opportunity, monthKey) && opportunity.stage !== 'OTMENA',
);
```

- [ ] **Step 3: Run**

```bash
cd BrandingTwentyView && yarn test:unit src/deals-board/analytics/compute.test.ts
```

(Use the repo’s actual unit test command if different.)

- [ ] **Step 4: Commit** in BrandingTwentyView

```bash
git commit -m "Exclude cancelled opportunities from analytics deal count and expenses."
```

---

### Task 7: Final verification

**Files:** none (verification)

- [ ] **Step 1: Run parser suites**

```bash
cd backend && npm test -- tests/twenty-line-item.test.js tests/twenty-opportunity.test.js tests/twenty-sync.test.js tests/twenty-line-items-sync.test.js tests/opportunity-amount-recalc.test.js
```

Expected: all PASS.

- [ ] **Step 2: Spec checklist**

| Spec requirement | Task |
|------------------|------|
| Create `stage: NOVYY` | 1 |
| Σ without OTMENA helpers | 2 |
| Cancel zeros amounts | 3 |
| Sync SoT opportunity amount | 4 |
| One-shot recalc only opp amount | 5 |
| Analytics OTMENA deals out | 6 |
| Orphans report only (no delete) | — (spec + CSV already) |

- [ ] **Step 3: Commit plan if untracked**

```bash
git add docs/superpowers/plans/2026-08-04-cancelled-amounts-and-orphans.md docs/superpowers/specs/2026-08-04-cancelled-amounts-and-orphans-design.md docs/superpowers/specs/2026-08-04-orphan-line-items-class-a.csv
git commit -m "Add design and plan for cancelled amounts and orphan audit."
```

---

## Spec coverage self-review

- Opportunity amount excludes OTMENA: Tasks 2, 4, 5  
- Zero on cancel: Task 3  
- Restore amounts via sync only: no restore-amount code (constraint)  
- One-shot without mass line zero: Task 5  
- Stage create fix: Task 1  
- Analytics: Task 6  
- Orphans A/B/C report: already in approved spec + CSV; no mutation task  

No TBD placeholders. Flag key and stale window match free-entry pattern.
