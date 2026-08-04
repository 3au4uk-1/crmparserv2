# Task 4 Report: Snapshot on cancel (TDD)

## Status: DONE

## Summary

`cancelDealInTwenty` now lists line items first, writes `pre_cancel_opportunity_stage` + `line_item_stage_snapshot_json` to local SQLite (guarded by SQL `WHERE` and early skip when already `OTMENA`), logs `cancel.snapshot`, then cancels opportunity + line items as before. `cancelLineItemsForOpportunity` signature unchanged (re-list inside). Restore not implemented (Task 5).

## Commits

- `a309182` — Snapshot line-item stages before cancelling a deal in Twenty.

## Files Changed

| File | Change |
|------|--------|
| `backend/src/services/twenty-sync.js` | Snapshot list + SQLite write before Twenty cancel mutations |
| `backend/tests/twenty-sync.test.js` | Db mock snapshot handler, seed defaults, 2 new tests, existing cancel mock order fix |

## TDD Evidence

### RED (tests before implementation)

```bash
cd backend && npm test -- tests/twenty-sync.test.js
```

```
 Test Files  1 failed (1)
      Tests  2 failed | 9 passed (11)

 FAIL  cancels opportunity when deal disappears from calendar
   TypeError: Cannot read properties of undefined (reading 'stage')  # calls[1] expected list-first order

 FAIL  writes line-item stage snapshot before cancelling
   AssertionError: expected null to be 'V_RABOTE'  # pre_cancel_opportunity_stage not written
```

### GREEN (after implementation + mock handler reorder)

```bash
cd backend && npm test -- tests/twenty-sync.test.js
```

```
 Test Files  1 passed (1)
      Tests  11 passed (11)
```

## Self-Review

### Correctness
- Lists line items via `listLineItemsForOpportunity` before any Twenty cancel mutation.
- Snapshot JSON shape: `[{ id, stage }]` with `stage ?? null`.
- SQL guard `AND (line_item_stage_snapshot_json IS NULL OR = '')` prevents overwrite at DB level.
- In-memory guard `if (!existingSnapshot)` skips write when deal row already has snapshot.
- Early return when `twenty_stage === OTMENA` preserves existing snapshot (no axios calls).
- `cancel.snapshot` logged with `{ lineItemCount, opportunityStage }`.
- `cancelLineItemsForOpportunity` still re-lists internally (v1, per brief).

### Test mock fix
- Moved `twenty_stage = ?` handler before generic `synced_at` handler so cancel final UPDATE sets stage correctly (pre-existing mock ordering bug surfaced by new snapshot assertion).

### Scope
- No restore logic (Task 5).
- No push.
- `listLineItemsForOpportunity` import was already present in `twenty-sync.js`.

## Tests one-liner

`npm test -- tests/twenty-sync.test.js` → **11/11 pass**

## Task 4 Review Fix (2026-08-04)

### Changes
1. **`cancel.snapshot` log gated on SQL write** — `logTwentyStep('cancel.snapshot', …)` only fires when snapshot UPDATE returns `changes > 0` (no-op race skips log).
2. **Test assertion for `cancel.snapshot`** — `vi.mock` of `twenty-sync-log.js` spies `logTwentyStep`; snapshot test expects `('cancel.snapshot', { lineItemCount: 3, opportunityStage: 'V_RABOTE' })`.

### Verification

```bash
cd backend && npm test -- tests/twenty-sync.test.js
```

```
 Test Files  1 passed (1)
      Tests  11 passed (11)
```

## Concerns

1. **Double list API call** — cancel now lists line items twice (snapshot + `cancelLineItemsForOpportunity`); acceptable for v1 per design.
2. **Partial cancel failure** — if opp update fails after snapshot write, snapshot persists (intended for restore in Task 5).
3. **Mock handler ordering** — `synced_at` catch-all remains; only cancel path fixed by reorder; restore/clear handlers in Task 5 should follow same pattern.
