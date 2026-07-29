# Amount lock + selective resync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write-back of line-item amount from TwentyView into the parser with `amount_locked`, recalc opportunity amount, and keep dates + `OTMENA` syncing even when amounts/stages are protected.

**Architecture:** Store lock on `deal_items`; expose `POST /api/twenty/line-items/:id/amount`; honor lock in totals and in `replaceDealItemsPreservingOverrides`. TwentyView calls write-back after amount save and patches opportunity amount from the response. Selective sync paths always push dates and cancel stages.

**Tech Stack:** Node ESM, better-sqlite3, Express, Vitest (crmparserv2); TypeScript + Vitest + Twenty logic-functions (BrandingTwentyView).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-29-amount-lock-and-selective-resync-design.md`
- Manual amount edit → `amount_locked = 1` (independent of stage)
- Locked amount never overwritten from Tony/calendar
- Always resync: load/event/dismantle dates; deal `OTMENA`; line-item `OTMENA`
- Ne-nashe / restoration → write-back **400**
- Unknown `twenty_id` → **404** (Twenty amount already saved)
- No unlock UI / badge in v1
- Tests: `cd backend && npm test -- <file>`; TwentyView: `npx vitest run --config vitest.unit.config.ts <path>`

## File map

### crmparserv2

| File | Responsibility |
|------|----------------|
| `backend/src/db/migrate.js` | `amount_locked` column on `deal_items` |
| `backend/src/services/deal-item-amount-lock.js` | `lockDealItemAmount`, helpers |
| `backend/src/services/twenty-opportunity.js` | Honor lock in `computeLineItemTotal` |
| `backend/src/services/deal-items-update.js` | Preserve lock + sum/price on replace |
| `backend/src/services/twenty-line-item-api.js` or amount service | Wire API helper |
| `backend/src/routes/twenty.js` | `POST .../amount` |
| `backend/src/services/twenty-sync.js` | Dates always; OTMENA line-item channel |
| `backend/tests/deal-item-amount-lock.test.js` | Lock + totals |
| `backend/tests/deal-items-update.test.js` | Preserve on replace |
| `backend/tests/twenty-routes.test.js` | API contracts |

### BrandingTwentyView

| File | Responsibility |
|------|----------------|
| `src/logic-functions/line-item-amount.ts` (or similar) | Proxy to parser `/amount` |
| `src/deals-board/api/crmparser.ts` | `writeBackLineItemAmount` |
| `src/deals-board/editors/CurrencyAmountCell.tsx` | Call write-back after save (line items only) |
| `src/deals-board/api/line-items.ts` / opportunity patch | Apply opportunity amount from response |
| Tests for write-back client + cell behavior if feasible |

---

### Task 1: Migration + lock service + totals (crmparserv2)

**Files:**
- Modify: `backend/src/db/migrate.js`
- Create: `backend/src/services/deal-item-amount-lock.js`
- Modify: `backend/src/services/twenty-opportunity.js`
- Create: `backend/tests/deal-item-amount-lock.test.js`

**Interfaces:**
- Produces:
  - `ensureAmountLockedColumn` via migrate (`ensureColumn(db, 'deal_items', 'amount_locked', 'INTEGER NOT NULL DEFAULT 0')` or equivalent pattern already used in migrate)
  - `lockDealItemAmount(db, twentyLineItemId, amountRub): { dealId, itemId, amountRub, opportunityAmountRub }`
  - Throws 404 if unknown twenty_id; 400 if ne-nashe/restoration match
  - Sets `amount_locked=1`, updates `sum` to `amountRub`, sets `price` consistently (prefer: `sum = amountRub`, keep `quantity`/`quantity_num`; if tony-style total is `sum`, that’s enough for `computeLineItemTotal`)
  - `computeLineItemTotal`: if `item.amount_locked` truthy → return locked total from `sum` (or `price` fallback) **before** ne-nashe/restoration? Spec says ne-nashe write-back forbidden; for compute, restoration/ne-nashe still zero **unless** we never lock those. Order: if restoration/ne-nashe → 0; else if locked → locked sum; else normal.

- [ ] **Step 1: Failing tests** for lock helper + `computeLineItemTotal` with `amount_locked: 1`.

- [ ] **Step 2: Run** `npm test -- deal-item-amount-lock` — FAIL.

- [ ] **Step 3: Migrate column + implement service + total branch.**

- [ ] **Step 4: Tests PASS. Commit**

```bash
git commit -am "feat: amount_locked on deal_items and lock helper"
```

---

### Task 2: Preserve lock across Tony replace (crmparserv2)

**Files:**
- Modify: `backend/src/services/deal-items-update.js`
- Modify or create: `backend/tests/deal-items-update.test.js`

**Interfaces:**
- Extend `buildOverrideMap` to also store when `amount_locked` or `twenty_id` / `sync_override`:
  ```js
  {
    sync_override,
    twenty_id,
    amount_locked: item.amount_locked ? 1 : 0,
    sum: item.amount_locked ? item.sum : undefined,
    price: item.amount_locked ? item.price : undefined,
  }
  ```
- After insert, if preserved.amount_locked: restore `sync_override`, `twenty_id`, `amount_locked`, `sum`, `price` (ignore Tony sum/price for that row).

- [ ] **Step 1: Failing test** — replace with Tony prices; locked row keeps old sum + amount_locked=1 + twenty_id.

- [ ] **Step 2: Implement preserve; tests PASS; commit**

```bash
git commit -am "feat: preserve amount_locked fields across deal item replace"
```

---

### Task 3: REST write-back + opportunity recalc sync (crmparserv2)

**Files:**
- Modify: `backend/src/routes/twenty.js`
- Modify: `backend/src/services/twenty-sync.js` (or call existing `syncDealToTwenty` after lock)
- Modify: `backend/tests/twenty-routes.test.js`

**Interfaces:**
- `POST /api/twenty/line-items/:twentyLineItemId/amount`
  - Body: `{ amountRub: number }` (finite, >= 0)
  - Calls `lockDealItemAmount`
  - Then `syncDealToTwenty(dealId, { ignoreLineItemStageProtection: true })` so opportunity amount + locked line amount push to Twenty (async or await — prefer **await** so response includes new opportunity amount)
  - Response: `{ success: true, amountRub, opportunityAmountRub, dealId }`
  - 400/404 via thrown err.status

- [ ] **Step 1: Route tests** — lock + 400 for restoration pattern item + 404 unknown.

- [ ] **Step 2: Implement route; PASS; commit**

```bash
git commit -am "feat: POST twenty line-item amount write-back API"
```

---

### Task 4: Selective resync — dates always; OTMENA always (crmparserv2)

**Files:**
- Modify: `backend/src/services/twenty-sync.js`
- Modify: `backend/src/services/twenty-line-items-sync.js` (if needed)
- Tests: `backend/tests/twenty-sync.test.js`, `backend/tests/twenty-line-items-sync.test.js`

**Interfaces / behavior:**

1. **Dates:** On every `syncDealToTwenty` update path, opportunity patch must include date fields from `buildOpportunityInput` even when line-item diff is empty. Verify current code already does this; if stage-protection skips whole opportunity update, **fix** so dates always apply.

2. **Deal OTMENA:** Keep/extend `cancelDealInTwenty` — no amount_locked interaction.

3. **Line-item OTMENA:** Add explicit step after/before diff:
   - If parser marks deal cancelled → cancel opportunity (existing).
   - If a Twenty line item should be cancelled (define trigger: deal cancelled → all unprotected? Spec: «источник/явная отмена»). Minimal v1: when opportunity is cancelled, also set each non-OTMENA line item stage to `OTMENA` via GraphQL (even protected). When deal restored, do **not** auto-un-cancel line items in v1.
   - Document this v1 rule in commit message.

- [ ] **Step 1: Tests** for opportunity date update with all line items protected; cancel sets line items OTMENA.

- [ ] **Step 2: Implement; PASS; commit**

```bash
git commit -am "feat: always sync opportunity dates and OTMENA past protections"
```

---

### Task 5: TwentyView proxy + CurrencyAmountCell write-back

**Files:**
- Create: `src/logic-functions/line-item-amount.ts` (mirror `line-item-list-status.ts` pattern → `/twenty/line-items/:id/amount`)
- Register in app manifest / logic function index if required by project convention (grep how `line-item-list-status` is registered)
- Modify: `src/deals-board/api/crmparser.ts` — `writeBackLineItemAmount(lineItemId, amountRub)`
- Modify: `src/deals-board/editors/CurrencyAmountCell.tsx` — after successful mutate for `objectName === 'dealLineItem'` && `fieldName === 'amount'`, call write-back; on failure `alert` with parser message but keep Twenty value; on success if response has `opportunityAmountRub`, patch opportunity amount in cache / `patchOpportunity`
- Tests: unit test for crmparser client; optional cell test

**Interfaces:**
```ts
writeBackLineItemAmount(lineItemId: string, amountRub: number): Promise<{
  success: true;
  amountRub: number;
  opportunityAmountRub: number;
}>
```

- [ ] **Step 1: Logic function + client.**

- [ ] **Step 2: Wire CurrencyAmountCell; only for dealLineItem amount.**

- [ ] **Step 3: Tests; commit**

```bash
git commit -am "feat(deals-board): write back line amount lock to parser"
```

**Note:** After logic-function add, run `yarn twenty apply` on staging when deploying (mention in smoke).

---

### Task 6: Smoke checklist

- [ ] Edit amount on branding board line item → parser `deal_items.amount_locked=1`, opportunity amount updates.
- [ ] Re-parse Tony → locked amount unchanged; load/event dates update.
- [ ] Cancel deal → opportunity + line items `OTMENA`.
- [ ] Ne-nashe item → write-back error message.
- [ ] Push both repos’ staging when green.

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| amount_locked column + write-back API | 1, 3 |
| computeLineItemTotal honors lock | 1 |
| Preserve lock on replace | 2 |
| Opportunity recalc | 3, 5 |
| TwentyView after amount save | 5 |
| Dates always | 4 |
| OTMENA always | 4 |
| Ne-nashe/restoration 400 | 1, 3 |
| No unlock UI | — (YAGNI) |

No placeholders remaining after self-review.
