# Task 5 Report: Repair job runner + startup wire

**Date:** 2026-08-04  
**Branch:** `staging`  
**Commit:** `294be88` — Run one-shot free-entry duplicate repair after parser startup.

## Status: DONE

## Summary

Added `runFreeEntryDuplicateRepairIfNeeded` async runner with settings flag machine (`running`/`done`/`failed`, 6h stale `running` retry), per-deal repair orchestration (Twenty rename/disambiguate, local `twenty_id` untangle, opportunity amount update), `listLineItemsForRepair` GraphQL helper, and background `setImmediate` kick in `index.js` after listen.

## Files Changed

| File | Change |
|------|--------|
| `backend/src/services/free-entry-duplicate-repair.js` | Flag machine + `repairOneDeal` + `runFreeEntryDuplicateRepairIfNeeded` |
| `backend/src/services/twenty-line-items-sync.js` | `listLineItemsForRepair` (kommentariy, createdAt, amount) |
| `backend/src/index.js` | Background repair kick after `app.listen` |
| `backend/tests/free-entry-duplicate-repair.test.js` | 4 flag-machine tests + existing 11 planner tests |

## TDD Evidence

### RED — flag-machine tests before runner (Step 1)

Added 4 tests for `runFreeEntryDuplicateRepairIfNeeded`; runner not yet exported → import/symbol failures expected before implementation.

### GREEN — Step 4

```bash
cd backend && npm test -- tests/free-entry-duplicate-repair.test.js tests/tony-mapping.test.js tests/deal-items-update.test.js tests/twenty-line-items-sync.test.js
```

```
 Test Files  4 passed (4)
      Tests  51 passed (51)
   Duration  541ms
```

Flag-machine cases covered:
- skips when `free_entry_duplicate_repair_v1 = done`
- sets `failed` (not `done`) on hard Twenty auth error
- sets `done` after full pass with soft per-deal errors logged
- retries when `running` + `started_at` older than 6 hours

## Commit

```
Run one-shot free-entry duplicate repair after parser startup.
```

## Concerns

1. **`createdAt` on Twenty line items** — repair query requests `createdAt`; if workspace schema differs, list call may hard-fail until field name is confirmed.
2. **Concurrent startup** — two processes could both see non-`done` flag; `running` guard reduces but does not fully eliminate double-run on simultaneous boots.
3. **Soft failures silent to operators** — per-deal errors only hit console unless log aggregation is wired.

---

## Task 5 Review Fixes (2026-08-04)

### Critical: listLineItemsForRepair assert guards

`listLineItemsForRepair` now calls `assertHttpSuccess` + `assertGqlSuccess` (passed from `repairOneDeal`) before parsing edges. HTTP 401/5xx and GraphQL errors throw instead of silently returning `[]`.

### Important: isHardTwentyError coverage

Expanded regex to match assert throw patterns: HTTP 404/5xx, `ECONNABORTED`, and `Failed to … in Twenty` fallback messages.

### Tests added

- `running` + `started_at` 1h ago → skip, gql not called
- gql resolves `{ status: 401, data: {} }` on list → `status: failed`, flag `failed`
- flag `failed` → retry succeeds → `done`

```bash
cd backend && npm test -- tests/free-entry-duplicate-repair.test.js
```

```
 Test Files  1 passed (1)
      Tests  18 passed (18)
```
