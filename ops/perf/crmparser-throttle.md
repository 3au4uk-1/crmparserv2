# crmparser background load throttle

Protect Twenty prod interactive traffic during scheduled/manual parses by lowering crmparser concurrency and API pressure.

## Superseded for API-key limit (2026-09-14)

**Do not follow the old “leave ~55 req/min for CRM UI” advice.** The Twenty API-key long limit is now **800** tokens / 60s (`API_RATE_LIMITING_LONG_LIMIT=800` on `twenty-server`; TTL stays 60000). Parser client should stay at `TWENTY_API_RATE_LIMIT_MAX=720` with `TWENTY_SYNC_CONCURRENCY=6`. The 2026-07-31 `TWENTY_API_RATE_LIMIT_MAX=40` throttle below is historical only.

- Twenty prod compose: `oI7-NCBTpfyrxJBitrJrd0` (`twenty`) — live `printenv` on `twenty-server` is `800`.
- Twenty staging compose: `eMjWv7p-ovnfQ7XnpFKTe` (`twenty-staging`) — compose patched; stack was not running, so container verify is pending next start.
- Do **not** change `API_RATE_LIMITING_SHORT_*`.

## Context

- **Prod compose:** `JWIhULvt6slzDxT8AQXyWz` (project `crmparser`)
- **Staging compose:** `wjfA-wPgjI2FH8wW4ypcx` (project `crmparser-staging-coeaio`)
- **Host env path:** `/etc/dokploy/compose/<project>/code/.env` on LXC 103
- **Repo defaults** (`docker-compose.yml`): `FETCH_CONCURRENCY=4`, `TWENTY_API_RATE_LIMIT_MAX=95`, `TONY_REQUEST_DELAY_MS=350`

Time-aware parse scheduling is already implemented (`backend/src/services/parse-schedule.js`, design `docs/superpowers/specs/2026-06-21-parse-schedule-optimization-design.md`). That reduces *when* and *how far* we parse; this throttle reduces *how hard* each run hits Twenty/Postgres during working hours.

**Lever chosen:** env throttling (immediate, no code deploy). Scheduling alone does not cap parallel Twenty writes during `weekday-fast` hourly runs (9–21 MSK).

## Values applied (2026-07-31)

| Variable | Before (prod) | After | Rationale |
|----------|---------------|-------|-----------|
| `FETCH_CONCURRENCY` | `8` | `2` | Reduce parallel deal fetch/sync workers; prod was above repo default. |
| `TWENTY_API_RATE_LIMIT_MAX` | `95` | `40` | Leave ~55 req/min headroom in the 60s window for CRM UI/API users. |
| `TONY_REQUEST_DELAY_MS` | `350` | `500` | Slow Tony CRM reads slightly to spread load. |
| `TWENTY_API_RATE_LIMIT_WINDOW_MS` | `60000` | *(unchanged)* | Keep existing window. |
| `PARSE_PIPELINE` | `parallel` | *(unchanged)* | Still parallel pipeline, fewer workers. |

Staging mirrored for parity (`DISABLE_AUTO_PARSE=true` there, but same limits if manual parse runs).

## Apply

1. **Dokploy API** (preferred): `compose.one` → patch `env` string → `compose.update` → `compose.deploy`.
   - Reuse `ops/backup/lib/dokploy-client.js`.
2. **If deploy does not recreate the container:** patch host `.env`, then from compose dir:
   ```bash
   cd /etc/dokploy/compose/crmparser/code
   docker compose up -d --force-recreate
   ```
   (Use `crmparser-staging` service name on staging.)

## Verify

```bash
ssh proxmox 'pct exec 103 -- docker inspect crmparser --format "{{range .Config.Env}}{{println .}}{{end}}" \
  | egrep "FETCH_CONCURRENCY|TWENTY_API_RATE_LIMIT_MAX|TONY_REQUEST_DELAY_MS"'
```

Expected: `FETCH_CONCURRENCY=2`, `TWENTY_API_RATE_LIMIT_MAX=40`, `TONY_REQUEST_DELAY_MS=500`.

## Rollback

Restore prior prod values in Dokploy **Environment** (or host `.env`) and redeploy:

```
FETCH_CONCURRENCY=8
TWENTY_API_RATE_LIMIT_MAX=95
TONY_REQUEST_DELAY_MS=350
```

To match repo defaults instead of prod history:

```
FETCH_CONCURRENCY=4
TWENTY_API_RATE_LIMIT_MAX=95
TONY_REQUEST_DELAY_MS=350
```

Re-run the verify command above after rollback.

## Measurement

During-parse baseline (`ops/perf/baseline.sh prod`) is required when a parse is active; if idle, capture post-throttle idle baseline and re-run during next parse. Compare a future during-parse sample to pre-throttle reports under `ops/perf/reports/` (e.g. `20260730T201725Z-prod-before.txt`).
