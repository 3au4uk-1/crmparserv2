# Profiling findings — pg_stat_statements + deals-board front-components

**Captured:** 2026-07-31 (UTC+3)  
**Postgres:** `twenty-postgres` on LXC 103 (prod)  
**Front-components:** BrandingTwentyView `src/deals-board/*`, entry `src/front-components/deals-board.tsx`

---

## Data freshness note (pg_stat_statements)

| Signal | Value |
|--------|-------|
| `pg_postmaster_start_time()` | **2026-07-30 22:25 UTC** (~3 h before capture) |
| Total tracked calls | 3,559 across 205 distinct queries |
| Interpretation | **Cold stats** — rankings reflect post-restart traffic (app deploys, metadata sync, limited board usage), not a full production day. Re-run after ≥24 h for authoritative ranking. |

Query used:

```bash
ssh proxmox 'pct exec 103 -- docker exec twenty-postgres psql -U postgres -d default -c "
SELECT round(mean_exec_time::numeric,1) AS ms_mean, calls,
       round(total_exec_time::numeric,0) AS ms_total,
       left(query,120) AS q
FROM pg_stat_statements
ORDER BY total_exec_time DESC LIMIT 20;"'
```

### Top 20 by total time (cold snapshot)

| ms_mean | calls | ms_total | query (truncated) |
|--------:|------:|---------:|-------------------|
| 22.3 | 14 | 313 | `FieldMetadataEntity` workspace metadata load |
| 24.5 | 6 | 147 | `ViewFieldEntity` workspace metadata load |
| 0.6 | 252 | 141 | `ApplicationRegistrationEntity` read (Twenty app manifest sync) |
| 1.2 | 84 | 105 | `UPDATE applicationRegistration` (manifest push on apply) |
| 2.2 | 40 | 88 | `dealLineItem` column projection (board list) |
| 2.0 | 40 | 82 | `_dealLineItem` filter on `printSheetSessionId IS NOT NULL` |
| 1.9 | 40 | 77 | `dealLineItem` column projection (variant) |
| 11.3 | 6 | 68 | `workflowRun` searchVector load |
| 1.6 | 40 | 66 | `_dealLineItem` stage + printSheet compound filter |
| 1.2 | 36 | 42 | `FieldMetadataEntity` universalIdentifier lookup |
| 0.5 | 84 | 41 | `ApplicationRegistrationEntity` id lookup |
| 34.6 | 1 | 35 | `CREATE EXTENSION pg_stat_statements` (one-time) |
| 5.7 | 5 | 28 | `workflowRun` status poll |
| 3.2 | 8 | 26 | `opportunity` list projection (stage, loadDate, name, companyId) |
| 1.4 | 17 | 23 | `dealLineItem` expense/source fields |
| 1.0 | 20 | 21 | `dealBoardView` view config load |
| 3.4 | 6 | 20 | `ViewFieldGroupEntity` metadata |
| 0.1 | 336 | 20 | `KeyValuePairEntity` user prefs |
| 0.7 | 24 | 18 | `upgradeMigration` status |
| 8.6 | 2 | 17 | `INSERT appToken` |

### Deal-board–related queries (subset)

| ms_mean | calls | ms_total | notes |
|--------:|------:|---------:|-------|
| 2.2 | 40 | 88 | Line-item GraphQL/ORM list — dominant board SQL in cold window |
| 2.0 | 40 | 82 | Print-sheet session filter |
| 3.2 | 8 | 26 | Opportunity page fetch |
| 1.0 | 20 | 21 | `dealBoardView` config |
| 0.9 | 9 | 8 | Opportunity COUNT for pagination |
| 0.9 | 8 | 8 | Opportunity REST enrichment (`dizayn`, `stage`, …) |

No query exceeded ~25 ms mean in this window; totals are low because call counts are small. **Index candidates deferred** — insufficient volume/latency evidence (`RESERVE-SCOPE`).

---

## Browser profiling (deals board)

**Not performed** — staging «Реализация» requires authenticated Twenty session; no headless auth path in this task. Static code review + React Query behavior analysis used instead.

---

## Front-component findings (prioritized)

### P1 — Inline edit refetches entire visible line-item set

| | |
|---|---|
| **Symptom** | Each cell save triggers a full `lineItems` / `opportunities` refetch for all visible deals (~50 opps × N positions). |
| **Evidence** | `useUpdateLineItem.onSettled` and `useUpdateRecord.onSettled` called `invalidateQueries` on **every** success; optimistic patch already applied in `onMutate`. |
| **Fix** | Invalidate **only on error**; keep optimistic cache on success. Automations (`runAfterLineItemUpdate`, `syncDealStage`) patch cache directly. |
| **Owner** | BrandingTwentyView |
| **Impact** | High — removes 1–2 GraphQL round-trips per inline edit (primary interaction on «Реализация»). |
| **Status** | **Fixed** in this task |

### P2 — SSE realtime patch followed by redundant page invalidation

| | |
|---|---|
| **Symptom** | Remote opportunity update via SSE patches cache, then immediately invalidates `deals-board-page` → full cold-path refetch. |
| **Evidence** | `apply-object-record-event.ts` lines 88–102: successful `patchOpportunityInCache` still called `invalidateQueries(['deals-board-page'])`. Unit test asserted this behavior. |
| **Fix** | Skip invalidation when cache patch succeeds; retain invalidation for CREATED / cache miss / DELETE. |
| **Owner** | BrandingTwentyView |
| **Impact** | Medium — avoids refetch storm when multiple users edit concurrently or workflows update opportunities. |
| **Status** | **Fixed** in this task |

### P3 — Rashod REST enrichment runs on every board load

| | |
|---|---|
| **Symptom** | Extra REST batch fetch for `rashod*` fields on initial table render even though analytics pane is closed. |
| **Evidence** | `DealsBoard.tsx` called `useOpportunityRashodFields(visibleRecords)` unconditionally; only consumed by `AnalyticsPanel`. |
| **Fix** | Pass `enabled: boardPane === 'analytics'`. |
| **Owner** | BrandingTwentyView |
| **Impact** | Low–medium — saves one REST round-trip per page load / filter change when analytics closed. |
| **Status** | **Fixed** in this task |

### P4 — `lineItems` query had no explicit staleTime

| | |
|---|---|
| **Symptom** | Residual invalidations (StageSelect, manual sync, upload modal) always mark queries stale immediately. |
| **Evidence** | `useLineItems` omitted `staleTime`; parent `QueryClient` sets 30 s default but explicit hook config is clearer. |
| **Fix** | Add `staleTime: 30_000` on `useLineItems`. |
| **Owner** | BrandingTwentyView |
| **Impact** | Low — aligns with board defaults; helps when narrow invalidations remain. |
| **Status** | **Fixed** in this task |

### P5 — Duplicate company-name fetches in filter UI

| | |
|---|---|
| **Symptom** | `FilterBar`, `QuickFiltersBar`, and `DealsTable` each run `useQuery(['companyNames', ids])` with overlapping ID sets. |
| **Evidence** | Static review — React Query dedupes identical keys within one `QueryClient`, but three components mount separate observers; filter bars duplicate logic. |
| **Fix** | Extract shared `useCompanyNames(ids)` hook or lift company map to `DealsBoard` context. |
| **Owner** | BrandingTwentyView |
| **Impact** | Low — mostly deduped by RQ; refactor for clarity. |
| **Status** | Document only |

### P6 — `syncDealStage` refetches line items after every line-item save

| | |
|---|---|
| **Symptom** | After inline edit, `syncDealStage` calls `fetchLineItemsByOpportunityIds([oppId])` even when cache already has siblings. |
| **Evidence** | `utils/sync-deal-stage.ts` always network-fetches before computing stage. |
| **Fix** | Read siblings from `lineItems` cache first; fetch only on cache miss. |
| **Owner** | BrandingTwentyView |
| **Impact** | Medium — 1 extra GraphQL call per line-item save that triggers stage recompute. Needs careful test coverage. |
| **Status** | Document only |

### P7 — Metadata queries dominate cold pg_stat_statements

| | |
|---|---|
| **Symptom** | `FieldMetadataEntity` / `ViewFieldEntity` top total time (~460 ms combined, 20 calls). |
| **Evidence** | pg_stat_statements cold snapshot; correlates with Twenty app `yarn twenty apply` / manifest sync (84 `applicationRegistration` updates). |
| **Fix** | **RESERVE-SCOPE** — Twenty core metadata caching; not in current workstream. |
| **Owner** | Twenty core (reserve) |
| **Impact** | Unknown until warm stats; likely affects cold load after deploy, not steady-state board scrolling. |

### P8 — Print-sheet / workflow SQL filters

| | |
|---|---|
| **Symptom** | Repeated `_dealLineItem` filters on `printSheetSessionId`, stage combos (~40 calls each). |
| **Evidence** | pg_stat_statements deal subset; mean 1.6–2.2 ms. |
| **Fix** | **RESERVE-SCOPE** — partial index on `(printSheetSessionId)` or composite `(stage, printSheetSessionId)` if warm stats show high total time. |
| **Owner** | Twenty / workspace schema (reserve) |
| **Impact** | TBD after warm capture |

---

## Recommended follow-ups

1. Re-run pg_stat_statements query after **≥24 h** prod traffic; promote any query with ms_mean >50 or ms_total >10 s to index review (`RESERVE-SCOPE`).
2. Browser Performance trace on staging «Реализация» (scroll + inline edit) once auth is available — validate P1–P3 fixes via Network tab (GraphQL call count per edit).
3. Implement P6 (`syncDealStage` cache-first) in a follow-up PR with unit tests.

---

## Verification commands

```bash
# Warm stats (repeat later)
ssh proxmox 'pct exec 103 -- docker exec twenty-postgres psql -U postgres -d default -c "
SELECT round(mean_exec_time::numeric,1) AS ms_mean, calls,
       round(total_exec_time::numeric,0) AS ms_total,
       left(query,120) AS q
FROM pg_stat_statements
ORDER BY total_exec_time DESC LIMIT 20;"'

# Deal-board subset
ssh proxmox 'pct exec 103 -- docker exec twenty-postgres psql -U postgres -d default -c "
SELECT round(mean_exec_time::numeric,1) AS ms_mean, calls,
       round(total_exec_time::numeric,0) AS ms_total,
       left(query,150) AS q
FROM pg_stat_statements
WHERE query ILIKE '\''%dealLineItem%'\'' OR query ILIKE '\''%opportunity%'\''
ORDER BY total_exec_time DESC LIMIT 15;"'
```
