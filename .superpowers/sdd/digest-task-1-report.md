# Task 1 Report: Digest compute (header + risks + score)

**Status:** DONE_WITH_CONCERNS  
**Branch:** staging  
**Commit:** `90607ee` — feat(telegram): digest compute for ready/not-ready and risk score

## Summary

Implemented pure compute layer for the Telegram morning digest: amount conversion, ready/not-ready partitioning (excluding OTMENA), risk detection (R0/R1/R2), scoring, sorting, and risk list slicing.

## Files created

| File | Purpose |
|------|---------|
| `backend/src/telegram/digest/compute.js` | `amountRubles`, `buildDigestModel`, `sliceRisksForMessage`, constants |
| `backend/src/telegram/digest/label.js` | `parseDealNameParts` (Tony-style name parsing) |
| `backend/tests/telegram-digest-compute.test.js` | Vitest suite (4 tests) |

## TDD cycle

1. **RED** — Wrote test file verbatim from brief (+ added `sliceRisksForMessage` import used by cap test). Ran `cd backend && npm test -- telegram-digest-compute.test.js` → FAIL (`Cannot find module '../src/telegram/digest/compute.js'`).
2. **GREEN** — Implemented `label.js` and `compute.js` per brief. First run: 3/4 passed; risk-sort test failed because `small` (1 position, 0 ready) was included via R0 (`pct=0 < 0.30`).
3. **Fix** — Added `total >= 2` guard on R0 so single-position deals are excluded (aligns with test intent: "0 ready 1 item — not R2" and expected `['big0','bigHalf']` only).
4. **GREEN** — Re-ran tests → 4/4 PASS.

## Exports

- `amountRubles(amount)` — `amountMicros / 1e6`, else `0`
- `buildDigestModel({ deals, lineItemsByOppId })` → `DigestModel`
- `sliceRisksForMessage(risks, limit = 7)` → `{ shown, hiddenCount }`
- Constants: `R1_MIN_RUBLES`, `RISK_PCT_LT`, `RISK_LIST_LIMIT`
- `parseDealNameParts(name)` → `{ manager, bookingNo }`

## Test results

```
Test Files  1 passed (1)
Tests       4 passed (4)
```

Command: `cd backend && npm test -- telegram-digest-compute.test.js`

## Self-review

### Correctness

- OTMENA deals and line items excluded from counts and risks ✓
- Ready/not-ready split by opportunity `stage === GOTOVO` ✓
- R1: amount ≥ 150k and pct < 1 ✓
- R2: ready === 0 and total ≥ 2 ✓
- Scoring: +3 R0, +2 R2, +2 top-25% among not-ready amounts, +1 R1 ✓
- Sort: score desc, then amount desc ✓
- `parseDealNameParts` wired into risk rows (`manager`, `bookingNo`) ✓

### Concern: R0 requires `total >= 2`

Brief Step 3 snippet had `const r0 = pct < RISK_PCT_LT` without a minimum position count. The bundled test expects a 1-position deal (`small`) to **not** appear in risks. Implementation uses:

```js
const r0 = total >= 2 && pct < RISK_PCT_LT;
```

This is implied by the test but not stated in the brief's code block or design spec (spec only documents "1 position with 0 ready → not R2"). Recommend confirming with product/design whether R0 should also require ≥2 positions, and updating the plan/brief if so.

### Scope

No Telegram I/O, no render, no cron — pure compute only, as required for Task 1.

## Next task

Task 2 can build on `label.js` and add `render.js` for message formatting.

---

## Fix: R0 aligned to approved SPEC (2026-08-07)

**Status:** DONE  
**Issue:** Initial implementation added `total >= 2` guard on R0 to satisfy a buggy plan test expectation. Approved SPEC requires R0 when `pct < 0.30` with no minimum position count. R2 unchanged (`ready === 0 && total >= 2`).

### Changes

1. `backend/src/telegram/digest/compute.js` — `r0 = pct < RISK_PCT_LT` (removed `total >= 2` guard).
2. `backend/tests/telegram-digest-compute.test.js` — risk-sort test updated:
   - `small` (1 position, 0 ready, ₽10k) now appears in risks with label `риск` only (no `0 готово`).
   - Order: `big0` → `small` → `bigHalf` (score desc, then amount desc).

### Test results (post-fix)

```
> backend@1.0.0 test
> vitest run telegram-digest-compute.test.js

 RUN  v4.1.8

 Test Files  1 passed (1)
      Tests  4 passed (4)
   Duration  246ms
```

Command: `cd backend && npm test -- telegram-digest-compute.test.js`
