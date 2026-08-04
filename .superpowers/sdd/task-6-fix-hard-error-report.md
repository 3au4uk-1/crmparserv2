# Task 6 Fix Report: Narrow `isHardTwentyError` for per-deal soft failures

**Date:** 2026-08-04  
**Branch:** `staging`  
**Finding:** Whole-branch review — `isHardTwentyError` too broad

## Status: DONE

## Problem

`isHardTwentyError` matched `/Failed to .* in Twenty/` and bare `404|5\d{2}`, so a single deal's GQL mutation failure (e.g. `"Failed to update line item li-x in Twenty"`) aborted the entire repair job instead of logging and continuing.

## Fix

Narrowed hard-fail matcher to auth, network, and endpoint/config errors only:

| Before | After |
|--------|-------|
| `401\|403\|404\|5\d{2}\|not configured\|timeout\|ECONN*\|GraphQL endpoint not found\|Twenty API\|Failed to .* in Twenty` | `401\|403\|not configured\|timeout\|ECONNREFUSED\|ECONNRESET\|ECONNABORTED\|GraphQL endpoint not found` |

**Removed:** `404`, `5\d{2}`, `Twenty API` (would also match `Twenty API error: HTTP 500`), `Failed to .* in Twenty`

**Kept hard:** HTTP 401/403 (list auth still fails job), timeout, connection errors, missing config, wrong GraphQL endpoint (404 → "GraphQL endpoint not found")

**Now soft:** Per-deal `"Failed to update/create/… in Twenty"` GQL business errors; bare HTTP 404/5xx on single mutations

## Files changed

- `backend/src/services/free-entry-duplicate-repair.js` — narrowed `isHardTwentyError`
- `backend/tests/free-entry-duplicate-repair.test.js` — new test: line-item assertGql failure → `status: done`, `dealsFailed >= 1`, second deal still listed

## Tests

```bash
cd backend && npm test -- tests/free-entry-duplicate-repair.test.js tests/tony-mapping.test.js tests/deal-items-update.test.js tests/twenty-line-items-sync.test.js
```

```
 Test Files  4 passed (4)
      Tests  55 passed (55)
   Duration  645ms
```

Existing cases still pass: HTTP 401 on list → `failed`; soft deal error → `done`; fresh running skip; stale retry.

## Commit

See SHA below (not pushed).
