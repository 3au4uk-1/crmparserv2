# Task 6 report: Profile GraphQL + deals-board front-components

**Date:** 2026-07-31 (UTC+3)  
**Author:** 3au4uk-1

## Status

**Done.** Cold pg_stat_statements captured; deals-board static review complete; four front-component fixes shipped; findings committed.

## Commits

| Repo | Commit message | Files |
|------|----------------|-------|
| crmparserv2 | `perf: profiling findings (pg_stat_statements + deals-board front-components)` | `ops/perf/findings-profiling.md` |
| BrandingTwentyView | `perf(deals-board): skip redundant refetch on edit and SSE patch` | `apply-object-record-event.ts`, `useLineItems.ts`, `useUpdateRecord.ts`, `DealsBoard.tsx`, test |

## Top findings (summary)

1. **Cold PG stats** — postmaster restarted ~3 h before capture; metadata + app-registration sync dominate, dealLineItem queries ~2 ms mean / 40 calls. No index action yet (`RESERVE-SCOPE`).
2. **Inline edit refetch (P1)** — fixed: invalidate queries only on mutation error.
3. **SSE double-fetch (P2)** — fixed: no `deals-board-page` invalidation after successful opportunity cache patch.
4. **Rashod prefetch (P3)** — fixed: REST enrichment deferred until analytics pane opens.
5. **Browser trace** — skipped (no easy staging auth).

## Concerns

- pg_stat_statements needs **≥24 h warm window** before index promotion.
- P6 (`syncDealStage` cache-first) left for follow-up — medium impact, needs tests.
- Unit tests not run locally (`yarn`/deps unavailable in agent shell); test updated for P2 behavior.

## Artifacts

- Findings: `ops/perf/findings-profiling.md`
- Report: `.superpowers/sdd/task-6-report.md`
