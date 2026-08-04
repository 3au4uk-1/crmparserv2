# Task 5 Report: One-shot opportunity_amount_recalc_v1

**Status:** DONE  
**Commit:** e3f71b3  
**Branch:** staging  
**Base:** f664db5

## Summary

- Added `backend/src/services/opportunity-amount-recalc.js` — one-shot job mirroring free-entry repair flag machine (`opportunity_amount_recalc_v1`, `_started_at`, 6h stale retry).
- Per synced deal: list line items with amounts → `buildOpportunityAmountInputFromLineItems` → fetch current opportunity amount → update only when |diff| ≥ 1 RUB (1e6 micros).
- Does **not** mutate line-item amounts (no `updateDealLineItem` calls); OTMENA line amounts are left unchanged — only opportunity.amount is corrected.
- Narrow `isHardTwentyError` matcher (401/403/timeout/ECONN*/not configured/GraphQL endpoint not found) — no broad `Failed to .*` pattern.
- Wired startup kick in `index.js` alongside free-entry repair (shared `setImmediate` callback).

## TDD

| Step | Result |
|------|--------|
| 1. Failing tests | Module missing — import error |
| 2. Implement | Service + flag machine + recalcOneDeal |
| 3. Run pass | 13/13 passed |
| 4. Wire index.js | Shared setImmediate callback |
| 5. Commit | See SHA |

## Test command

```bash
cd backend && npm test -- tests/opportunity-amount-recalc.test.js
```

**Result:** 13 passed (13)

## Files changed

- `backend/src/services/opportunity-amount-recalc.js` (new)
- `backend/tests/opportunity-amount-recalc.test.js` (new)
- `backend/src/index.js`

## Key exports

- `runOpportunityAmountRecalcIfNeeded(deps?)` → `{ status, reason?, updated?, dealsFailed?, dealsTotal? }`
- `resolveRecalcFlagState`, `opportunityAmountNeedsUpdate`, `recalcOneDeal`
- `RECALC_FLAG_KEY`, `RECALC_STARTED_AT_KEY`, `ONE_RUB_MICROS`
