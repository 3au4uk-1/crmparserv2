# Task 5 Report: Groups table, confirm/unlink, money, expense rollup

## Status
**Complete** — `deal_groups` / `deal_group_members` schema + pure money/membership layer; no Twenty GraphQL.

## Commits
- `34bb833` — `feat: persist confirmed deal groups and parent money rules`

## Tests
| Command | Result |
|---------|--------|
| RED: `npm test -- tests/deal-groups.test.js` | **FAIL** — module not found |
| GREEN: same | **PASS** — 9/9 |
| Related: bitrix + suggest + migrate | **PASS** — 20/20 |

## Path
- `backend/src/db/schema.sql`, `backend/src/db/migrate.js`
- `backend/src/services/deal-groups.js`
- `backend/tests/deal-groups.test.js`

## Self-review
1. No silent merge: only `confirmDealGroup` inserts groups; suggest remains read-only.
2. `ALREADY_GROUPED` (409) when `deal_id` already a member; `canonical_bitrix_id` must exist on canonical deal links.
3. Money: Σ `amountRub`; payments/`rashodItogo` from canonical only; expense rollup unique by `bitrixId`.
4. Locked canonical never auto-switched; two payments → no auto-pick / no auto-switch.
5. Unlink removes membership only; empty group dissolved; smeta `twenty_id` / links untouched.

## Concerns
- Singleton groups allowed until last member unlinked (empty → dissolve); no auto-dissolve at size 1.
- Positive auto-switch covered; two-payment auto-switch false path covered via locked + pickCanonical unit tests, not a separate unlocked two-pay DB case.

## Task 5 review fix — confirmDealGroup amountRub

**Fix:** `confirmDealGroup` now loads `amountRub` via `loadDealAmountRub` → `computeDealItemsTotal(deal, deal_items)` instead of hardcoded `0`.

**Regression test:** `auto-picks max-revenue deal when no payments and no canonicalDealId` — two deals, zero payments, item totals 1000 vs 50000 → canonical is deal 2.

**Tests:**
```
npm test -- tests/deal-groups.test.js
Test Files  1 passed (1)
Tests  10 passed (10)
```
