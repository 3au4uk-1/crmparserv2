# Prod backup, staging data refresh, and rollback

**Date:** 2026-07-29  
**Repos:** `crmparserv2` (ops home; Dokploy CI secrets already here). Applies to `twenty_brand` ecosystem: Twenty CRM + crmparser. BrandingTwentyView participates only via release manifest (app version) and existing CD.  
**Branch:** design for `staging` → `main` release readiness

## Problem

Before promoting parser and Twenty View from staging to production we need:

1. A **full production backup** before every update.
2. A way to **refresh staging with current prod data** (not share live prod DB).
3. A **fast rollback** to the pre-update state if the release fails.

Today: Twenty prod has a nightly Postgres backup to MinIO (Dokploy compose backup, 14 retention historically). Staging was cloned once from prod. crmparser SQLite and Twenty `server-local-data` are not part of a release snapshot. There is no pre-deploy gate and no documented two-level rollback.

## Goals

- Full snapshot of prod: **Postgres + SQLite (crmparser `/app/data`) + Twenty files (`server-local-data`)**.
- Hybrid schedule: **nightly** + **mandatory pre-release** snapshot.
- Retention: **7 days**.
- Staging remains a **separate stack**; refresh **overwrites data volumes only** (env/URLs/tokens/`DISABLE_AUTO_PARSE` unchanged).
- Two rollback levels: **data-only** and **full release** (data + previous code artifacts).

## Non-goals (v1)

- brandogram / brandingteam / twentydash (out of this release path).
- Moving Twenty storage to S3.
- Automatic merge staging→main without a human.
- PITR finer than whole-snapshot restore.
- Staging reading/writing live prod databases.

## Current infrastructure (facts)

| Piece | Prod | Staging |
|-------|------|---------|
| Dokploy project | `twenty_brand` / production | `twenty_brand` / staging |
| Twenty compose | `twenty` | `twenty-staging` |
| crmparser compose | `crmparser` (`:latest` from main) | `crmparser-staging` (`:staging`) |
| Twenty data | Postgres 16 in compose + `server-local-data` | Separate volumes (initial clone of prod) |
| Parser data | SQLite in `crmparser-data` | Separate volume; `DISABLE_AUTO_PARSE=true` |
| Backup destination | MinIO destination `minio-home`, bucket for Dokploy backups | — |
| Existing PG backup | Nightly Dokploy compose backup on Twenty prod (historically keep 14) | None configured — will be covered by full-snapshot restore path |
| CI deploy | Push main/master → image + Dokploy redeploy; Twenty CD → prod URL | Push staging → staging image/app |

## Approach

**Dokploy-native + thin release playbook** (recommended and approved):

- Keep Dokploy for Postgres dump/trigger where it already works.
- Add host/CI scripts for SQLite + file volumes and for staging/prod restore orchestration.
- GitHub Actions `workflow_dispatch` workflows in **crmparserv2** call Dokploy API + SSH/script as needed (Dokploy URL/API key already in repo secrets).
- Optional small ops scripts living under e.g. `ops/backup/` in crmparserv2 (implementation detail for the plan).

## Snapshot artifact

One **release snapshot** is a named set in MinIO, retained **7 days**:

| Artifact | Content | Capture method |
|----------|---------|----------------|
| `twenty-pg` | Postgres DB `default` | Dokploy compose backup (service `db`) + CI/manual trigger for pre-release |
| `twenty-files` | volume `server-local-data` | Script: archive volume → MinIO |
| `crmparser-sqlite` | volume `/app/data` (DB + related uploads) | Stop/pause crmparser briefly → `sqlite3 .backup` (or consistent copy) → tar → MinIO |
| `manifest.json` | snapshot id, timestamp, crmparser image digest/tag, Twenty app version on prod, component object keys | Written by `release-prepare` |

**Consistency window:** brief — pause **crmparser** for SQLite consistency; Twenty Postgres via online `pg_dump`/Dokploy backup; files archived in the same window. Target: minutes of limited write disruption, not hours.

**Prune:** delete full-snapshot components older than **7 days**. Align the existing Dokploy Twenty PG job to **keepLatestCount = 7** so PG-only and full-snapshot policies match. Age-based prune is enough while releases stay within the window; the latest `release-prepare` manifest always points at a snapshot that must still exist before/during the release.

## Flows

### 1. Nightly

- Full snapshot (PG + files + sqlite), **same script/format** as `release-prepare` (scheduled via GitHub cron and/or host cron — not a second ad-hoc format).
- Prune >7 days.
- Existing Dokploy PG-only job may remain as defense-in-depth with retention 7; full snapshot is the restore source of truth for release/staging/rollback.
- Does **not** replace the mandatory pre-release gate.

### 2. Pre-release (`release-prepare`) — required before prod promote

1. Capture full prod snapshot → MinIO.
2. Write `manifest.json` (rollback point for this release).
3. **Gate:** if any component fails upload/verify → **stop**; do not merge/deploy to main.
4. Human proceeds with staging→main merges / existing CD.

### 3. Staging data refresh (`staging-refresh-data`) — on demand

1. Choose latest successful prod snapshot (or explicit snapshot id).
2. Stop staging: `twenty-staging` + `crmparser-staging`.
3. Restore PG + files + sqlite into **staging** volumes only.
4. Do **not** change staging env (SERVER_URL, tokens, networks, `DISABLE_AUTO_PARSE=true`).
5. Start staging; healthcheck.
6. Application code on staging is unchanged — data only.

**Precondition:** staging `ENCRYPTION_KEY` must match prod (already true for the current clone). If keys diverge later, file restore will not decrypt attachments — document and enforce in the playbook.

### 4. Rollback data (`rollback-data`)

1. Select snapshot (normally the pre-release id from the release manifest).
2. Stop prod `twenty` + `crmparser`.
3. Restore PG + files + sqlite into **prod** volumes.
4. Start + healthcheck.
5. Images / Twenty app version **unchanged**.

### 5. Rollback release (`rollback-release`)

1. Perform rollback data from the same snapshot.
2. Redeploy crmparser to image digest/tag from manifest.
3. Deploy + install Twenty app version from manifest to prod URL (existing CD actions / API).
4. Smoke check.

**Failure rule:** if restore is incomplete, do not start services in a half-restored state; fail the workflow; retry with the same snapshot id.

## Release sequence (staging → main)

1. Code verified on staging branches.
2. Optional: `staging-refresh-data`, then smoke on fresh prod-like data.
3. Mandatory: `release-prepare` (snapshot + manifest; fail closed).
4. Merge/push staging → main/master in coordinated order (parser + Twenty View as needed).
5. Existing CI deploys prod.
6. Prod smoke; on failure use § Rollback data or Rollback release.

## Ownership of workflows

| Workflow | Trigger | Home |
|----------|---------|------|
| Nightly full snapshot | Schedule (GH cron and/or host cron; same script as prepare) | crmparserv2 ops (+ Dokploy PG-only optional) |
| `release-prepare` | `workflow_dispatch` | crmparserv2 |
| `staging-refresh-data` | `workflow_dispatch` | crmparserv2 |
| `rollback-data` | `workflow_dispatch` | crmparserv2 |
| `rollback-release` | `workflow_dispatch` | crmparserv2 |

BrandingTwentyView keeps existing `cd.yml` (staging/main deploy). Release rollback may invoke the same deploy/install path with a pinned version from the manifest.

## Testing / verification

1. **Dry-run snapshot** in a low-traffic window: all three data artifacts + manifest appear in MinIO; prune leaves recent sets.
2. **Staging refresh:** stack healthy; deals board + attachment; parser UI sees SQLite data; auto-parse still disabled.
3. **Rollback data drill** on staging first (break data → restore). Prod only for real incident or scheduled drill.
4. **Rollback release drill:** record versions → fake bump → roll back via manifest.

## Success criteria

- Every prod release has a full snapshot taken within minutes before deploy.
- Within 7 days, operator can restore data or full release from a chosen snapshot.
- One workflow refreshes staging with current prod data without rewriting staging config.
- Nightly backup is defense-in-depth; pre-release gate is mandatory.

## Open implementation notes (for plan, not unresolved product decisions)

- Exact Dokploy APIs: `backup.manualBackupCompose` for PG; volume/file path may be SSH on CT 103 (`docker` server) if Dokploy volume backup is insufficient.
- Manifest storage: alongside snapshot prefix in MinIO and/or committed/uploaded artifact in the workflow run.
- Image identity: prefer digest over moving tags (`latest`) for rollback reliability.
- Compose IDs and destination IDs stay in secrets/vars, not hardcoded in docs beyond what CI already uses.
