# Task 6 — Smoke verification

## Automated

```
npx vitest run tests/print-sheet-*.test.js tests/twenty-sync.test.js
→ 12 files, 75 passed
```

## MCP prod smoke

`find_many_deal_line_items` with `printSheetExportRequested: { eq: true }` → **0 records** (no stray pending flags).

## Manual QA (deferred to deploy)

Not run in this session — requires deployed crmparser + TwentyView UI:

1. Date+time, stage NOVYY, press button → requested=true, no sheet row yet
2. Set V_PECHATI → ~1 min one sheet row
3. V_PECHATI + date/time without button → no new row
4. Overlapping sync+cron → no duplicate for one send

## Status

DONE_WITH_CONCERNS — automated green; end-to-end sheet write needs deploy + operator QA.

## Fix — empty `printSheetSessionId` (`''`) re-export (2026-08-05)

**Problem:** Pending GraphQL used `{ printSheetSessionId: { is: NULL } }` only; legacy rows with `''` never re-entered export.

**Change:**
- Removed session NULL filter from `LIST_PENDING_EXPORT`; client-side `isEmptyPrintSheetSessionId` filter on pending results.
- `listActivePrintSheetSessions` excludes empty session ids so `''` rows are not treated as active (they can re-enter pending after request).

**Tests:** `npx vitest run tests/print-sheet-export-twenty.test.js tests/print-sheet-cycle.test.js` — all passed.
