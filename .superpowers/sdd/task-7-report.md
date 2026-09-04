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
