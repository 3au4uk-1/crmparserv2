# Dokploy remote exec for ops restore (replace SSH)

**Date:** 2026-07-29  
**Repo:** `crmparserv2`  
**Extends:** `docs/superpowers/specs/2026-07-29-prod-backup-staging-sync-design.md`  
**Status:** approved for planning

## Problem

GitHub-hosted runners cannot SSH to the private Docker host (`10.50.50.132`). Staging refresh and rollback workflows fail at the first SSH step even when `DOCKER_HOST_SSH_KEY` is configured. Capture via Dokploy API already works from Actions.

## Goal

Remove **all** SSH/`scp` usage from ops workflows. Run host-side work through Dokploy’s public remote-exec path: **Server Schedule Jobs** (`scheduleType: server`) on `DOKPLOY_SERVER_ID`.

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| Scope | All ops SSH: refresh, rollbacks, release-prepare MinIO upload/prune, post-restore checks |
| Script home on host | Fixed directory `/etc/dokploy/ops-backup/` |
| Keep scripts current | CI sync via Schedule before each host op |
| Transport style | Persistent disabled schedules + `update` → `runManually` → poll logs |
| Restore logic | Keep `restore-host.sh` behavior; change only invocation transport |

## Non-goals

- Self-hosted GitHub runners
- Changing snapshot/manifest format or retention
- Reworking restore semantics (volumes/env isolation already defined)
- Public arbitrary Dokploy “exec” API (does not exist; Schedule is the substitute)

## Architecture

```text
GitHub Actions (ubuntu-latest)
    │  Dokploy API only (DOKPLOY_URL + DOKPLOY_API_KEY)
    ▼
Dokploy control plane
    │  SSH (internal) to DOKPLOY_SERVER_ID
    ▼
Docker host
    /etc/dokploy/ops-backup/   ← sync target
    restore-host.sh / mc / docker
```

Two persistent **server** schedules (cron present but `enabled: false`; only manual runs):

| Name (logical) | GH var | Role |
|----------------|--------|------|
| `ops-backup-sync` | `DOKPLOY_SCHEDULE_OPS_SYNC` | Write `ops/backup/` tree to `/etc/dokploy/ops-backup/` |
| `ops-backup-run` | `DOKPLOY_SCHEDULE_OPS_RUN` | Run host commands against synced tree / `mc` / `docker` |

### Remote run protocol

1. `POST /api/schedule.update` — set `command` and/or `script`, `shellType: bash`, `scheduleType: server`, `serverId`
2. `POST /api/schedule.runManually` — `{ scheduleId }`
3. Poll `GET /api/deployment.allByType?type=schedule&id=<scheduleId>` until terminal status
4. `GET /api/deployment.readLogs?deploymentId=…` — assert success

**Success contract:** deployment status OK **and** logs contain the line `[remote-ok]` printed at the end of a wrapper:

```bash
set -euo pipefail
# ... work ...
echo '[remote-ok]'
```

Missing marker → workflow failure (guards silent/partial failures).

### Sync protocol

CI reads files from the Actions checkout (`restore-host.sh`, `lib/*.sh`, other bash helpers needed on host — **not** Node `node_modules`). Builds a bash script that:

1. `mkdir -p /etc/dokploy/ops-backup/lib`
2. Writes each file via `cat > path <<'EOF' … EOF`
3. `chmod +x` on `restore-host.sh`
4. Echoes a short file list + `[remote-ok]`

Sync runs **before** every restore/MinIO/check step (idempotent).

### Manifest / snapshot resolve

Prefer keeping large artifacts on the host:

- **Latest snapshot:** `ops-backup-run` runs `mc ls` under `full-snapshots/`, prints `SNAPSHOT_ID=<id>`; CI parses logs (or workflow input supplies id).
- **Manifest for restore:** host copies `mc cp …/manifest.json` into a workdir under `/etc/dokploy/ops-backup/work/<snapshotId>/`; `restore-host.sh` reads that path. CI does not need the full JSON unless asserting fields — optional `snapshotId=` echo from host is enough.

### Workflow mapping

| Former SSH step | Replacement |
|-----------------|-------------|
| scp scripts | `ops-backup-sync` |
| ssh + `mc ls` / `mc cp` | `ops-backup-run` |
| ssh `restore-host.sh` | `ops-backup-run` calling `/etc/dokploy/ops-backup/restore-host.sh` |
| release-prepare MinIO upload/prune | `ops-backup-run` with `mc` (small JSON can be embedded in script) |
| staging `DISABLE_AUTO_PARSE` check | `ops-backup-run` + `docker exec` |

Confirmation gate `confirm=RESTORE_PROD` on prod rollbacks is unchanged.

## Components to add/change

### New

- `ops/backup/lib/schedule-remote.js` — Dokploy schedule update/run/poll/log helpers (extends patterns from `dokploy-client.js`)
- `ops/backup/remote-run.mjs` — CLI used by Actions: sync payload or run command wrapper
- Optional tiny `ops/backup/ensure-schedules.mjs` — create schedules once if vars empty (or document one-time create + set vars)

### Change

- `.github/workflows/staging-refresh-data.yml`
- `.github/workflows/rollback-data.yml`
- `.github/workflows/rollback-release.yml`
- `.github/workflows/release-prepare.yml` (MinIO optional steps only; capture stays API-only)
- `ops/backup/README.md` — replace SSH setup with Schedule vars + sync semantics
- `ops/backup/lib/dokploy-client.js` — add schedule + deployment methods as needed

### Remove from workflow dependency

- Secret `DOCKER_HOST_SSH_KEY` (delete after cutover)
- Vars `DOCKER_HOST`, `DOCKER_HOST_USER` (unused after cutover)

### Keep

- `DOKPLOY_*` existing vars/secrets
- `MINIO_MC_ALIAS`, `MINIO_BUCKET` (passed into host scripts; `mc` already on host)
- `restore-host.sh` semantics

## Error handling

| Failure | Behavior |
|---------|----------|
| Sync fails | Do not start restore/MinIO |
| Poll timeout / non-terminal stuck | Fail workflow |
| Terminal error or no `[remote-ok]` | Fail workflow |
| Missing scheduleId vars | Fail fast with setup hint (or ensure-create if implemented) |
| Wrong rollback confirm | Unchanged early exit |

## Test plan

1. Sync-only: run sync via Actions; green job + file list + `[remote-ok]` in logs  
2. Staging refresh `dry_run=true` end-to-end on GitHub-hosted runner  
3. Rollback confirmation gate with `confirm=WRONG` (regression)  
4. Live staging refresh after dry-run is green (operator-gated)

## Operator setup (after implement)

1. Ensure `DOKPLOY_SERVER_ID` set (already).
2. Create two disabled server schedules (or let ensure script create them); set `DOKPLOY_SCHEDULE_OPS_SYNC` and `DOKPLOY_SCHEDULE_OPS_RUN`.
3. Remove `DOCKER_HOST_SSH_KEY` when workflows no longer reference it.
4. Re-run staging dry-run from Actions.

## Open implementation details (plan may pin)

- Exact poll interval/timeout defaults
- Whether ensure-schedules auto-creates or requires manual create
- Whether sync includes only `.sh` + needed lib or also small JS helpers (host restore path is bash-first)
