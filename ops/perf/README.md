# Twenty CRM performance toolkit

Read-only measurement and deployment helpers for the [Twenty performance optimization plan](../../docs/superpowers/plans/2026-07-30-twenty-performance-optimization.md). All infra changes are applied **staging first, then prod**, with before/after captures stored under `reports/`.

## Quick start

```bash
# Capture a baseline (stdout + optional tee to reports/)
bash ops/perf/baseline.sh prod
bash ops/perf/baseline.sh staging

# Save a timestamped report
bash ops/perf/baseline.sh prod | tee ops/perf/reports/$(date -u +%Y%m%dT%H%M%SZ)-prod.txt
```

**Requirements:** SSH host `proxmox` (BatchMode), `curl`, and network access to `https://twenty.dosugmayak.ru` / `https://twenty-staging.dosugmayak.ru`.

**Report sections:** `NODE` (load, RAM, swap, vmstat), `LXC103` (top Docker memory consumers), `PG` (cache hit ratio, `shared_buffers`, `random_page_cost`), `FRONTEND` (HTML + main JS TTFB and cache headers).

Override SSH target: `SSH_HOST=proxmox bash ops/perf/baseline.sh prod`.

## Task order (0 → 7)

| Task | What | Key artifacts / scripts |
|------|------|-------------------------|
| **0** | Baseline capture toolkit | `baseline.sh`, `lib/measure.sh`, `reports/*-before.txt` |
| **1** | Move swap to NVMe + lower swappiness | `host/swap-to-nvme.sh`, `host/sysctl-perf.conf` |
| **2** | Tune Postgres (staging → prod) | `compose/twenty-db-command.yaml`, `apply-compose.mjs` |
| **3** | Memory limits / reservations | `compose/twenty-mem-limits.yaml`, `apply-compose.mjs` |
| **4** | Traefik asset caching + compression | `traefik/perf-middlewares.yml`, `compose/twenty-traefik-labels.yaml`, `apply-compose.mjs` |
| **5** | crmparser background throttle | `crmparser-throttle.md`, Dokploy env on crmparser compose |
| **6** | GraphQL + deals-board profiling | `findings-profiling.md` |
| **7** | Final verification vs targets | `results.md`, `reports/*-after.txt` |

After each infra task, re-run `baseline.sh` for the affected env and compare against the Task 0 captures.

## Rollback index

| Task | Rollback |
|------|----------|
| **1** | `ssh proxmox 'bash /root/perf/swap-to-nvme.sh --rollback'`; revert `/etc/fstab` swap lines |
| **2** | Re-apply pre-edit `*.full.yaml` via `node ops/perf/apply-compose.mjs <composeId> --set-compose <saved.yaml> --deploy` |
| **3** | Re-apply pre-edit `*.full.yaml` (remove `mem_limit` / `mem_reservation` fragments) |
| **4** | Remove `/etc/dokploy/traefik/dynamic/perf-middlewares.yml` on LXC 103; re-apply pre-edit compose |
| **5** | Restore prior crmparser env values documented in `crmparser-throttle.md`; redeploy crmparser |
| **6** | N/A (findings only; code fixes revert via git in BrandingTwentyView) |
| **7** | N/A (measurement doc only) |

## Dokploy compose IDs

- Twenty prod: `oI7-NCBTpfyrxJBitrJrd0`
- Twenty staging: `eMjWv7p-ovnfQ7XnpFKTe`
- crmparser prod: `JWIhULvt6slzDxT8AQXyWz`
- crmparser staging: `wjfA-wPgjI2FH8wW4ypcx`

Use `DOKPLOY_URL` and `DOKPLOY_API_KEY` (never commit) with `apply-compose.mjs`.

## Success targets (from plan)

- Swap used &lt; ~1 GiB, `si/so` ≈ 0 steady
- Free RAM buffer &gt; ~500 MiB
- Hashed assets: `cache-control: public, max-age=31536000, immutable` + compression
- GraphQL p95 &lt; ~500 ms; repeat/F5 TTI &lt; ~2 s; cold TTI &lt; ~5 s

Baseline “before” numbers (2026-07-30): swap ~6.8/7.1 GiB on eMMC, PG `shared_buffers=128MB`, main JS `max-age=0`.
