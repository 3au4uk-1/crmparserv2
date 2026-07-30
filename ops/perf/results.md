# Performance results — before vs after (Task 7)

**Captured:** 2026-07-31 UTC  
**Before reports:** `20260730T201725Z-prod-before.txt`, `20260730T201737Z-staging-before.txt`  
**After reports (final):** `20260730T223607Z-prod-after-final.txt`, `20260730T223607Z-staging-after-final.txt`  
**Workstreams applied:** swap→NVMe + swappiness (T1), PG tune (T2), mem caps (T3), immutable assets + gzip (T4), crmparser throttle (T5), GraphQL/front profiling (T6)

## Config verification (post-workstreams)

| Check | Expected | Observed | Status |
|-------|----------|----------|--------|
| Prod hashed JS `Cache-Control` | `immutable` + long max-age | `public, max-age=31536000, immutable` + `gzip` on `/assets/index-BPFStZql.js` | **PASS** |
| Staging hashed JS | same | `immutable` + `gzip` | **PASS** |
| PG `shared_buffers` (prod) | 256MB | 256MB | **PASS** |
| PG `random_page_cost` (prod) | 1.1 | 1.1 | **PASS** |
| crmparser throttle | `FETCH_CONCURRENCY=2`, `TWENTY_API_RATE_LIMIT_MAX=40`, `TONY_REQUEST_DELAY_MS=500` | all three match | **PASS** |

## Before / after vs success targets

Targets from plan §Global Constraints. **Judgement env:** prod (primary user-facing). Staging shown where it differs.

| Metric | Target | Before (prod) | After (prod) | Δ | Verdict |
|--------|--------|---------------|--------------|---|---------|
| Swap used | < ~1 GiB | 6.8 / 7.1 GiB (eMMC `pve-swap`) | 1.6 / 15 GiB (NVMe `/dev/zd48`) | −5.2 GiB | **FAIL** (still above 1 GiB; major improvement) |
| Swap I/O steady (`si`/`so`) | ≈0 | 56/68, 0/0, 12/0 | 298/1710†, 8/0, 0/0 | steady samples ≈0 | **PASS** (steady); †first vmstat row is cumulative since boot |
| Free RAM | > ~500 MiB | 411 MiB | 933 MiB | +522 MiB | **PASS** |
| Multi-second freezes | none | frequent swap-thrash (6.8 GiB swap) | intermittent ~16 s spikes on `/healthz` and hashed JS (3/8 samples); normal samples 0.22–0.48 s | spikes remain | **FAIL** |
| PG cache hit ratio | maintain high | 99.99% | 98.40% | −1.6 pp (post-restart cold) | **PASS** (acceptable) |
| PG `shared_buffers` | 256MB | 128MB | 256MB | +128MB | **PASS** |
| PG `random_page_cost` | 1.1 (NVMe) | 4 | 1.1 | tuned | **PASS** |
| Hashed asset delivery | immutable + compressed | `max-age=0`, 2.5 MB uncompressed | `immutable`, 754 KB gzip | −70% bytes | **PASS** |
| GraphQL p95 | < ~500 ms | no APM | `/healthz` proxy: 0.22–0.25 s (healthy), 16.2 s (spike) | proxy only | **DEFERRED** — no APM; proxy inconclusive due to spikes |
| Repeat / F5 TTI | < ~2 s | HTML 0.34 s + 2.5 MB JS 0.39 s | HTML ~0.27 s + cached JS ~0.38 s (curl network proxy) | faster transfer | **PASS**‡ (curl proxy; DevTools TTI not measured) |
| Cold TTI | < ~5 s | not captured | HTML 0.26 s + JS 0.35 s (cache-bust curl) | — | **PASS**‡ (network-only proxy; excludes parse/render/hydration) |
| Interaction p95 | < ~300 ms | not captured | not captured (auth required) | — | **DEFERRED** — needs DevTools on «Реализация» |

‡ True TTI requires browser Performance panel; curl timings are a lower-bound network proxy only.

### Staging snapshot (final)

| Metric | Before | After | Verdict |
|--------|--------|-------|---------|
| Swap used | 6.8 GiB | 1.6 GiB (shared node) | same as prod |
| Free RAM | 450 MiB | 932 MiB | **PASS** |
| HTML TTFB | 0.26 s | 0.30 s | **PASS** |
| Hashed JS | `max-age=0` | `immutable` + gzip 0.35 s | **PASS** |
| PG tune | 128MB / rpc=4 | 256MB / rpc=1.1 | **PASS** |

## Workstream impact summary

| Workstream | Key change | Measurable effect |
|------------|------------|-------------------|
| A — Infra | Swap moved to 16 GiB NVMe; swappiness lowered; container mem caps | Swap 6.8→1.6 GiB; free RAM 411→933 MiB; swap device off eMMC |
| B — Delivery | Traefik immutable cache + gzip for `/assets/*` | JS 2.5 MB→754 KB; repeat asset fetch ~0.35 s |
| C — App | PG `shared_buffers`/`random_page_cost`; crmparser 2/40/500; deals-board refetch fixes (BrandingTwentyView) | PG tuned and verified; throttle env verified; front fixes deployed but interaction latency not re-measured |

## FAIL / DEFERRED — reserve-scope recommendations

Only promote if user approves reserve scope (plan §2):

1. **Add RAM (+4–8 GiB)** — swap still 1.6 GiB resident after all tunings; target was <1 GiB. Would reduce remaining swap footprint and headroom pressure from twenty-server/worker (~1.5 GiB combined).
2. **Investigate ~16 s latency spikes** — observed on prod `/healthz` and hashed JS (intermittent, ~25–40% of rapid samples during Task 7 capture). Likely event-loop or upstream blocking, not swap-thrash. Recommend: enable request logging + `docker stats` correlation during spike; consider Twenty upgrade if upstream issue.
3. **GraphQL APM / pg_stat_statements warm capture** — re-run after ≥24 h prod traffic (see `findings-profiling.md`); promote index candidates only if ms_mean >50 or ms_total >10 s.
4. **DevTools validation** — authenticated Performance trace on prod «Реализация» (scroll + inline edit) to confirm interaction p95 <300 ms after Task 6 cache fixes.

## Report artifacts

```
ops/perf/reports/20260730T201725Z-prod-before.txt
ops/perf/reports/20260730T201737Z-staging-before.txt
ops/perf/reports/20260730T214341Z-staging-after-pg.txt
ops/perf/reports/20260730T214812Z-staging-after-pg-warm.txt
ops/perf/reports/20260730T214823Z-prod-after-pg-warm.txt
ops/perf/reports/20260730T222852Z-prod-after-throttle-idle.txt
ops/perf/reports/20260730T223607Z-prod-after-final.txt
ops/perf/reports/20260730T223607Z-staging-after-final.txt
```
