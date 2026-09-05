# Task 7 Report: Publish DONE work-request answers

**Date:** 2026-09-05
**Branch:** `feat/telegram-bot-work-requests`
**Commit:** `6fca983` — feat: publish work-request answers when Twenty stage is DONE

## Status: DONE

Implemented escaped Telegram HTML publication by editing the original acceptance message, with manager mentions on the first DONE transition and optional mentions on requested republish.

The Twenty webhook now handles `telegramRequest` updates immediately after signature verification without adding the object to the board event journal. Empty DONE answers are reverted, duplicate DONE updates are no-ops, non-DONE stages are ignored, and publication failures are written to `publishError`.

## TDD Evidence

RED:

```text
Error: Cannot find module '../src/telegram/work-requests/publish.js'
Test Files 1 failed (1)
```

GREEN — requested command:

```text
Test Files  2 passed (2)
Tests       11 passed (11)
```

Command: `cd backend && npm test -- tests/telegram-work-request-publish.test.js tests/telegram-events-route.test.js`

Scoped formatting check:

```text
git diff --check -- backend/src/routes/twenty-webhook.js backend/src/telegram/work-requests/publish.js backend/src/telegram/work-requests/handle-twenty-update.js backend/tests/telegram-work-request-publish.test.js
Exit code: 0
```

## Concerns

- The webhook deliberately awaits Telegram publication before returning 200; a slow Telegram request can approach Twenty's five-second retry deadline.
- Repository-wide `git diff --check` still reports pre-existing trailing whitespace in `.superpowers/sdd/task-2-report.md`; Task 7 files are clean.
# Task 7 Report: Backfill job, schema, routes, 409

**Status:** DONE  
**Date:** 2026-09-04  
**Repo:** crmparserv2

## Summary

Added `product_stream_backfill_runs` job orchestration that updates only `productStream` on Twenty line items (no `syncDealToTwenty`, no print sheet), with mutual 409 against bulk-resync and restore-missing-twenty.

## Files

| Path | Action |
|------|--------|
| `backend/src/db/schema.sql` | Added `product_stream_backfill_runs` |
| `backend/src/db/migrate.js` | `CREATE TABLE IF NOT EXISTS` clone |
| `backend/src/services/product-stream-backfill-jobs.js` | Created |
| `backend/src/services/twenty-line-items-sync.js` | Added `updateDealLineItemProductStreams` |
| `backend/src/routes/deals.js` | preview/POST/active/:id + mutual 409 |
| `backend/tests/product-stream-backfill-jobs.test.js` | Created |
| `backend/tests/bulk-resync-jobs.test.js` | In-memory table for 409 check |
| `backend/tests/restore-missing-twenty-jobs.test.js` | In-memory table for 409 check |

## API

- `countProductStreamBackfillDeals()` / `listProductStreamBackfillDealIds()` — `twenty_id` non-empty AND `approval_status != 'rejected'`
- Job: `requireTwentyConfig()` once → per deal: sqlite `deal_items` + `listLineItemsForOpportunity` + `planProductStreamBackfill` + GraphQL `{ productStream }` only
- Delay 1000ms after first deal; `MAX_ERRORS` 50; `completed_with_errors` on per-deal failures
- Routes under `/deals/product-stream-backfill/*`; mutual 409 with bulk-resync / restore-missing-twenty

## Tests

```
cd backend && npx vitest run tests/product-stream-backfill-jobs.test.js tests/bulk-resync-jobs.test.js tests/product-stream-backfill.test.js
```

- RED: FAIL — module missing  
- GREEN: 23 passed (incl. restore-missing suite for mutual 409 table)

## Commit

`feat: product-stream backfill job updates Twenty without full resync`

## Concerns

- Related job test DBs needed `product_stream_backfill_runs` so `getActiveProductStreamBackfillJob()` does not explode on POST.
- `gql` identity in assertions is the module export wrapper, not the `vi.fn` spy itself.

## Review fix: assert after productStream GraphQL writes

`updateDealLineItemProductStreams` now calls `assertHttpSuccess` / `assertGqlSuccess` after `gql`, matching `syncLineItemsDiff` line-item updates. `executeProductStreamBackfillJob` imports and passes those helpers from `twenty-gql.js`.

### Tests

```
cd backend && npx vitest run tests/product-stream-backfill-jobs.test.js
```

```
 RUN  v4.1.8 C:/Users/Василий/Documents/projects/crmparserv2/backend

 Test Files  1 passed (1)
      Tests  7 passed (7)
   Start at  14:20:40
   Duration  1.96s (transform 319ms, setup 0ms, import 1.71s, tests 60ms, environment 0ms)
```

```
cd backend && npx vitest run tests/twenty-line-items-sync.test.js
```

```
 RUN  v4.1.8 C:/Users/Василий/Documents/projects/crmparserv2/backend

 Test Files  1 passed (1)
      Tests  19 passed (19)
   Start at  14:20:43
   Duration  415ms (transform 97ms, setup 0ms, import 235ms, tests 9ms, environment 0ms)
```

## Review fix: listLineItemsForOpportunity must not swallow HTTP/GQL errors in backfill

Backfill now passes `assertHttpSuccess` / `assertGqlSuccess` into `listLineItemsForOpportunity` (same pattern as `listLineItemsForRepair`). Failed list throws into the per-deal catch instead of looking like an empty opportunity.

### Tests

```
cd backend && npx vitest run tests/product-stream-backfill-jobs.test.js tests/twenty-line-items-sync.test.js
```

```
 RUN  v4.1.8 C:/Users/Василий/Documents/projects/crmparserv2/backend

 Test Files  2 passed (2)
      Tests  29 passed (29)
   Start at  14:32:28
   Duration  3.30s (transform 481ms, setup 0ms, import 3.38s, tests 177ms, environment 0ms)
```

## Task 7 review fix: resolve links before stage handling

Moved work-request link lookup ahead of the stage guard. Any record with an ID but no SQLite link now returns `no_link`, writes `publishError: 'нет связки с чатом'` when an updater is available, and never edits Telegram. Linked `IN_PROGRESS` and `NEW` records remain ignored.

TDD RED:

```text
expected 'ignore' to be 'no_link'
Test Files 1 failed (1)
Tests      1 failed | 9 passed (10)
```

GREEN:

```text
Test Files 1 passed (1)
Tests      10 passed (10)
```

Command: `cd backend && npm test -- tests/telegram-work-request-publish.test.js`
