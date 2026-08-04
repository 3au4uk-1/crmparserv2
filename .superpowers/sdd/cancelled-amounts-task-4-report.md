# Task 4 Report: After sync, set opportunity.amount from Twenty non-OTMENA

**Status:** DONE  
**Commit:** f664db5  
**Branch:** staging  
**Base:** 133a36c

## Summary

- Added `buildOpportunityAmountInputFromLineItems(lineItems)` in `twenty-opportunity.js` — converts non-OTMENA line-item amounts to `{ amountMicros, currencyCode: 'RUB' }`.
- Extended `listLineItemsForOpportunity` GraphQL to fetch `amount { amountMicros currencyCode }`.
- After `syncLineItemsDiff` on both update and create paths: re-list line items and call `updateOpportunity` with amount only via new `updateOpportunityAmountFromLineItems` helper.
- Unit test for helper; sync test asserts second `updateOpportunity` excludes OTMENA amounts.

## TDD

| Step | Result |
|------|--------|
| 1. Failing tests | 2 failed (helper missing; no post-sync amount update) |
| 2. Run fail | Confirmed |
| 3. Implement | Helper + list query + sync wiring |
| 4. Run pass | 44/44 passed |
| 5. Commit | `f37b5bd` |

## Test command

```bash
cd backend && npm test -- tests/twenty-opportunity.test.js tests/twenty-sync.test.js
```

**Result:** 44 passed (44)

## Files changed

- `backend/src/services/twenty-opportunity.js`
- `backend/src/services/twenty-line-items-sync.js`
- `backend/src/services/twenty-sync.js`
- `backend/tests/twenty-opportunity.test.js`
- `backend/tests/twenty-sync.test.js`
