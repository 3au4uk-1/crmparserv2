# Task 3 Report: Cycle — claim-before-write + rollback

**Status:** DONE  
**Commit:** ec7bc79  
**Branch:** staging (crmparserv2)  
**Brief:** `crmparserv2/.superpowers/sdd/print-sheet-task-3-brief.md`

## Summary

Replaced write-then-mark export flow in `runPrintSheetCycle` with claim → write → row-meta. On Sheets write failure, rolls back the claim via `buildClaimRollbackPatch()` (clears session + re-sets `printSheetExportRequested: true`). Read-back and session-clear phases unchanged.

## Implementation

### Export loop (`print-sheet-cycle.js`)

1. `newPrintSheetSessionId()` → `buildClaimPatch(sessionId)` (Twenty update)
2. `writePrintSheetRow(tabName, rowValues)`
3. `buildRowMetaPatch(tabName, rowNumber)` (Twenty update)
4. On any error in try: log + `buildClaimRollbackPatch()` (nested try/catch for rollback failure)

Removed dependency on `buildSessionPatchAfterExport`.

### Files changed

- `backend/src/services/print-sheet-cycle.js` — claim-before-write + rollback
- `backend/tests/print-sheet-cycle.test.js` — mock builders + 2 new tests

## TDD evidence

| Phase | Command | Result |
|-------|---------|--------|
| RED | `npx vitest run tests/print-sheet-cycle.test.js` | 3 failed (still using `buildSessionPatchAfterExport`; new tests unmet) |
| GREEN | same | 4 passed |

## Commit

```
fix: claim print-sheet session before Sheets write to prevent dupes
```

## Self-review

| Check | Result |
|-------|--------|
| Claim before write (order test) | OK |
| Row meta after successful write | OK |
| Rollback on write failure | OK |
| Read-back + session-clear unchanged | OK |
| Only task files committed | OK |

## Concerns

- **Claim succeeds, row-meta fails:** Row exists in Sheets but CRM lacks tab/row — item stays claimed (`printSheetSessionId` set) and won't re-enter pending queue. No rollback on row-meta failure per brief; may need manual fix or a follow-up task.
- **Rollback failure:** Logged only; orphaned claim remains if rollback mutation fails.
- **Concurrent cycles:** Claim patch sets `printSheetExportRequested: false` atomically with session id; second cycle won't pick same row from pending filter — OK for dedupe intent.

## Review fix (Task 3 follow-up)

**Status:** DONE  
**Commit:** (see below)

### Changes

- **Critical:** Narrow rollback to Sheets write failures only — `writeSucceeded` flag prevents `buildClaimRollbackPatch()` after row-meta failure (avoids re-queue + duplicate sheet row).
- **Important:** New test — write succeeds, row-meta update rejects → no rollback / no `printSheetExportRequested: true`.
- **Strengthened:** Write-failure test asserts claim patch first, then rollback patch (order + contents).

### Test run

```
npx vitest run tests/print-sheet-cycle.test.js
Test Files  1 passed (1)
Tests       5 passed (5)
Duration    250ms
```
