# Task 6 Report: Final verification

## Status: PARTIAL — feature tests green, full suite has pre-existing failures

## Full suite

```bash
cd backend && npm test
```

```
Test Files  2 failed | 99 passed (101)
Tests       9 failed | 686 passed (695)
Duration    9.79s
```

### Failures (unrelated to cancel/restore)

| File | Count | Cause |
|------|-------|-------|
| `tests/migrate-deal-identity.test.js` | 7 | `migrateDealIdentity` creates index on `deal_items(twenty_id)` but test fixtures lack that column |
| `tests/decor-mk-lists.test.js` | 2 | `/api/settings/decor-keywords` returns 404; mk-keywords GET returns `{}` instead of array |

### Feature-scoped suite (cancel/restore + miss streak)

```bash
npx vitest run tests/calendar-missing.test.js tests/twenty-sync.test.js
```

```
Test Files  2 passed (2)
Tests       24 passed (24)
```

## Spec coverage self-check

| Spec requirement | Covered | Evidence |
|------------------|---------|----------|
| streak ≥ 3 | ✅ | `CALENDAR_MISS_CANCEL_THRESHOLD = 3`, `collectDealsReadyToCancelFromCalendar` (`calendar-missing.js`) |
| title-driven immediate | ✅ | `parser.js` `removeDealIds` loop calls `cancelDealInTwenty` without streak gate |
| snapshot on cancel | ✅ | `cancelDealInTwenty` writes `pre_cancel_opportunity_stage` + `line_item_stage_snapshot_json` |
| restore line items | ✅ | `restoreDealInTwenty` iterates snapshot, restores opp + line-item stages |
| columns migrated | ✅ | `migrate.js` + `schema.sql`: `calendar_miss_streak`, `pre_cancel_opportunity_stage`, `line_item_stage_snapshot_json` |
| no overwrite snapshot | ✅ | UPDATE guarded by `line_item_stage_snapshot_json IS NULL OR = ''` |
| partial restore keeps snapshot | ✅ | GQL failure rethrows; snapshot columns untouched; test in `twenty-sync.test.js` |

Extended checklist from brief also satisfied: bump/reset streak, clear snapshot+streak on success, skip missing ids, non-goals untouched.

## Plan doc commit

Already committed: `3ad6a23` — *Add implementation plan for cancel/restore line-item snapshots.*

No new commit created.

## Concerns

1. **Full suite not green** — 9 failures in migrate-deal-identity and decor-mk-lists predate or are orthogonal to Tasks 1–5; cancel/restore work is verified via 24/24 targeted tests.
2. **`deal_items.twenty_id` index** — `migrateDealIdentity` assumes column exists; legacy test DBs without it fail at index creation.
3. **decor/mk keyword routes** — settings endpoints appear missing or miswired in current branch.

## Commits

None (this task).

## Final review fixes

Applied review findings for cancel/restore snapshots:

1. **Restore skip via list intersection** — `restoreDealInTwenty` lists line items once, skips snapshot ids absent from Twenty (logs `restore.line_item_skipped`); removed error-text regex heuristic; GQL/transport errors still abort and keep snapshot.
2. **Test mock branch ordering** — DB mock handlers re-ordered: restore clear-snapshot UPDATE first, create path (`twenty_id` + `approval_status`) before cancel final UPDATE (`twenty_stage` + `status = ?`).
3. **Empty calendar guard** — when `inRangeCount === 0`, parser skips calendar-driven cancel/restore queues with `parse.skip_calendar_cancel_restore` log.

### Verification

```bash
cd backend && npm test -- tests/twenty-sync.test.js tests/calendar-missing.test.js
```

```
Test Files  2 passed (2)
Tests       25 passed (25)
Duration    505ms
```

New test: `skips snapshot line items missing from Twenty list and clears snapshot on success`.
