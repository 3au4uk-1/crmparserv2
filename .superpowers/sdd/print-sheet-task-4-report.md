# Task 4 Report: Mutex + cron logging

**Status:** DONE  
**Commit:** 0907fa8  
**Branch:** staging (crmparserv2)  
**Brief:** `crmparserv2/.superpowers/sdd/print-sheet-task-4-brief.md`

## Summary

Added `print-sheet-runner.js` as the shared single-flight entry for print-sheet refresh. Overlapping calls set a dirty flag and coalesce into one follow-up cycle. Each completed iteration logs `[print-sheet] cycle done` with `{ exported, readbackUpdated, sessionsCleared }`. Cron and `twenty-sync` both route through the runner (sync keeps a thin wrapper for `logTwentyStep` on bulk/post-sync paths).

## Implementation

### New `print-sheet-runner.js`

- Module-level `cycleInFlight` / `cycleDirty` mutex
- Config + Twenty GQL guard (same as former cron logic)
- `do { … } while (cycleDirty)` loop for dirty re-run
- `console.log('[print-sheet] cycle done', result)` after each cycle
- `__resetPrintSheetRunnerForTests()` for test isolation

### Updated consumers

- `print-sheet-cron.js` — re-exports `runPrintSheetRefresh` from runner; cron callback unchanged
- `twenty-sync.js` — `refreshPrintSheetAfterSync` and exported `runPrintSheetRefresh` delegate to runner (no direct `runPrintSheetCycle`)

### Tests

- `print-sheet-cron.test.js` — mutex/dirty re-run + logging tests; runner reset in `beforeEach`
- `twenty-sync.test.js` — mock `print-sheet-runner.js` instead of `print-sheet-cycle.js`

## TDD evidence

| Phase | Command | Result |
|-------|---------|--------|
| RED | `npx vitest run tests/print-sheet-cron.test.js` | 2 failed (mutex timeout before mock fix) |
| GREEN | `npx vitest run tests/print-sheet-cron.test.js tests/twenty-sync.test.js` | 21 passed |

## Commit

```
fix: single-flight print-sheet cycle with dirty re-run and logging
```

Files: `print-sheet-runner.js`, `print-sheet-cron.js`, `twenty-sync.js`, `print-sheet-cron.test.js`, `twenty-sync.test.js`

## Concerns

- Post-sync refresh now respects print-sheet config guard (sheet id + Google creds); if unset, refresh is skipped silently — same as cron.
- Brief mutex test mock needed a second-call auto-resolve; raw `release`-only pattern hangs on dirty re-run.

## Review fix (Task 4)

**Issue:** `refreshPrintSheetAfterSync` logged `print_sheet.refresh.done` even when `runPrintSheetRefreshLocked()` returned `undefined` (config skip).

**Fix:** Guard post-sync `.done` log with `if (result)` — same as exported `runPrintSheetRefresh` bulk path (already correct).

**Tests:** `npx vitest run tests/twenty-sync.test.js tests/print-sheet-cron.test.js` — 21 passed.
