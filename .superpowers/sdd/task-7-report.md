# Task 7 Report: Bulk jobs drop the 1s delay

**Status:** DONE_WITH_CONCERNS  
**Branch:** `feat/twenty-sync-speed`  
**Commit:** `2283cca` feat: run bulk Twenty jobs on the shared deal pool

## What landed

Bulk-resync, decor-mk scan, restore-missing, and product-stream backfill no longer sleep 1s between deals. Each job runs its per-deal work through `runDealSyncPool`; `dealsDone` increments in `onDealSettled`.

- Deleted `DELAY_MS`, `delay()`, and `if (i > 0) await delay` from all four job files
- Bulk-resync and decor-mk keep `syncDealToTwenty(..., { skipPrintSheetRefresh: true, ignoreLineItemStageProtection: true })`; decor-mk also keeps `productStreams: ['DECOR', 'MK']`
- Restore-missing wraps `restoreMissingDealInTwenty` (not `syncDealToTwenty`); success still counts `skipped` vs restored (`created` / `adopted`)
- Product-stream backfill wraps the existing per-deal body; it does not call `syncDealToTwenty` or `runPostParseTwentySync`
- `runPrintSheetRefresh()` once after the pool for bulk-resync and restore-missing, including when `dealsFailed > 0` (dropped `anyUpdated` / `anyRestored` guards)
- Decor-mk and product-stream still do not refresh the print sheet (they never did)

## What was tested and results

```
cd backend && npm test -- bulk-resync-jobs.test.js -t "does not delay"
```

**RED (before production change):** FAIL — `expected 1000 to be less than 500` (the 1s `DELAY_MS` sleep).

```
cd backend && npm test -- bulk-resync-jobs.test.js decor-mk-scan-jobs.test.js restore-missing-twenty-jobs.test.js product-stream-backfill-jobs.test.js
```

**GREEN:** 4 files, 43 tests — all PASS (2.67s).

Full `cd backend && npm test` still has 12 failures in unrelated files (`migrate-deal-identity`, `twenty-line-item`, `twenty-line-item-api`, `twenty-routes`, `telegram-polling`). Those fail on HEAD without this task’s changes.

## TDD Evidence

### RED

Added `does not delay 1s between deals…` to `bulk-resync-jobs.test.js` (and DELAY_MS-gone assertions on the other three job files) before replacing the loops.

```
cd backend && npm test -- bulk-resync-jobs.test.js -t "does not delay"
```

```
FAIL  tests/bulk-resync-jobs.test.js > bulk-resync-jobs > does not delay 1s between deals and uses skipPrintSheetRefresh
AssertionError: expected 1000 to be less than 500
 ❯ tests/bulk-resync-jobs.test.js:231:34
```

Failure reason: the 1s delay was still in source (fake timers advanced `Date.now()` by `DELAY_MS`), not a typo.

### GREEN

Replaced the four serial loops with `runDealSyncPool` and deleted `DELAY_MS` / `delay()`.

```
cd backend && npm test -- bulk-resync-jobs.test.js decor-mk-scan-jobs.test.js restore-missing-twenty-jobs.test.js product-stream-backfill-jobs.test.js
```

```
Test Files  4 passed (4)
      Tests  43 passed (43)
Duration  2.67s
```

Two route tests (`starts restore job`, `POST when idle returns 201 with jobId`) already failed on HEAD: missing `decor_mk_scan_runs` / `product_stream_backfill_runs` in those in-memory schemas (`getActive*` in the POST handlers). Added those tables so the four-file suite matches the brief’s Expected: PASS.

## Files

| File | Change |
| ---- | ------ |
| `backend/src/services/bulk-resync-jobs.js` | Pool + skipPrintSheetRefresh; print sheet once after pool |
| `backend/src/services/decor-mk-scan-jobs.js` | Pool + DECOR/MK streams; keep `created` in updated count |
| `backend/src/services/restore-missing-twenty-jobs.js` | Pool around `restoreMissingDealInTwenty`; print sheet once after pool |
| `backend/src/services/product-stream-backfill-jobs.js` | Pool around existing backfill body; DELAY_MS removed only |
| `backend/tests/bulk-resync-jobs.test.js` | Timing + skipPrintSheetRefresh + DELAY_MS gone |
| `backend/tests/decor-mk-scan-jobs.test.js` | Same delay assertions; product-stream-backfill_runs fixture |
| `backend/tests/restore-missing-twenty-jobs.test.js` | Delay + print sheet once; decor_mk_scan_runs fixture |
| `backend/tests/product-stream-backfill-jobs.test.js` | Delay + DELAY_MS gone |

## Self-review

- `DELAY_MS` / `delay()` / `if (i > 0) await delay` are gone from all four job sources
- `skipPrintSheetRefresh: true` still passed where it was (bulk-resync, decor-mk)
- Success-action checks kept per file (`updated`/`updated_empty`; decor-mk also `created`; restore skipped vs restored; backfill `toUpdate.length`)
- Print sheet once after the pool for jobs that already did that, including `dealsFailed > 0`
- Product-stream does not go through `syncDealToTwenty` / `runPostParseTwentySync`
- Tests assert DELAY_MS is gone from source and skipPrintSheetRefresh still used where it was

## Concerns

1. **Print sheet always runs** after bulk-resync / restore-missing even when every deal was a no-op skip (dropped `anyUpdated` / `anyRestored`). Matches the brief (“including when dealsFailed > 0”) and post-parse, but is a behavior change vs HEAD.
2. **Per-deal `console.error` dropped** — the brief’s `onDealSettled` template does not log; failures still increment `dealsFailed` and `job.errors`.
3. **Restore still calls `syncDealToTwenty(dealId)` without `skipPrintSheetRefresh`** inside `restoreMissingDealInTwenty`. Kept as existing per-deal body; only the job loop was pooled.
4. **Pre-existing route fixture gap** — two POST 201 tests needed extra run tables that HEAD already queried. Unrelated to the delay, but required for the four-file suite to pass.
5. Full backend suite still has 12 unrelated failures on this branch.

## Review fix: restore-missing skipPrintSheetRefresh

**Finding:** `restoreMissingDealInTwenty` called `syncDealToTwenty(dealId)` without `{ skipPrintSheetRefresh: true }`, so under concurrency 6 each deal could trigger a parallel print-sheet refresh in addition to the post-pool refresh.

**Fix:** Both inner `syncDealToTwenty` calls (adopt + recreate paths) now pass `{ skipPrintSheetRefresh: true }`. Post-pool `runPrintSheetRefresh()` unchanged.

**Tests:**

```
cd backend && npm test -- restore-missing-twenty-jobs.test.js
```

```
Test Files  1 passed (1)
      Tests  10 passed (10)
   Duration  903ms
```

Assertions added/updated: per-deal `syncDealToTwenty` mock calls include `{ skipPrintSheetRefresh: true }`; new test confirms all pool sync calls use the flag and print sheet runs once after the pool.
