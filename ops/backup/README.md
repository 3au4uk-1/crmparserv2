# Prod backup ops — Dokploy wiring

Operator notes for the prod snapshot pipeline (Task 2). Secrets live in GitHub Actions secrets / Dokploy env — never commit API keys or MinIO credentials here.

## Docker volume names (prod host)

Confirmed via Dokploy volume backup jobs (compose project prefixes):

| Service | Compose project | Docker volume name |
|---------|-----------------|-------------------|
| Twenty local files | `twenty` (`-p twenty`) | `twenty_server-local-data` |
| crmparser SQLite data | `crmparser` (`-p crmparser`) | `crmparser_crmparser-data` |

Staging equivalents (for refresh workflows, Task 4+): `twenty-staging_server-local-data`, `crmparser-staging_crmparser-data`.

## Dokploy resource IDs

Set these as GitHub repository **Variables** (Settings → Secrets and variables → Actions → Variables):

| Variable | Value | Notes |
|----------|-------|-------|
| `DOKPLOY_TWENTY_PG_BACKUP_ID` | `0rInusnjJ7d64Z3Pvm31O` | Compose PG backup, prefix `twenty-pg` |
| `DOKPLOY_TWENTY_FILES_VOLUME_BACKUP_ID` | `oGxdDhtMUOUUL2GOhJrnz` | Job name `twenty-files-prod` |
| `DOKPLOY_CRMPARSER_VOLUME_BACKUP_ID` | `hjNHo-tuuwf_7UtDHQkOn` | Job name `crmparser-data-prod` |
| `DOKPLOY_DESTINATION_ID` | `TfR-Va14SJniAB91hlgbt` | MinIO destination `minio-home` |
| `DOKPLOY_TWENTY_COMPOSE_ID` | `oI7-NCBTpfyrxJBitrJrd0` | Prod Twenty compose |
| `DOKPLOY_CRMPARSER_COMPOSE_ID` | `JWIhULvt6slzDxT8AQXyWz` | Prod crmparser compose |

GitHub **Secrets** (Settings → Secrets and variables → Actions → Secrets):

| Secret | Required by | Notes |
|--------|-------------|-------|
| `DOKPLOY_URL` | `release-prepare`, `docker-publish` | Dokploy API base URL |
| `DOKPLOY_API_KEY` | `release-prepare`, `docker-publish` | Dokploy API key |
| `DOCKER_HOST_SSH_KEY` | optional | Private key for docker host (CT 103); enables MinIO manifest upload + expired snapshot deletion |

Optional GitHub **Variables** for SSH/MinIO steps (defaults shown in workflow when unset):

| Variable | Default | Notes |
|----------|---------|-------|
| `DOCKER_HOST` | `10.50.50.132` | Docker host reachable from GitHub runners |
| `DOCKER_HOST_USER` | `root` | SSH user on docker host |
| `MINIO_MC_ALIAS` | `minio-home` | `mc` alias configured on docker host (matches Dokploy destination name) |
| `MINIO_BUCKET` | `dokploy` | MinIO bucket for Dokploy backups — **verify** with `mc ls minio-home/` on host |

## Volume backup jobs (prod)

Both jobs exist in Dokploy and are enabled:

### twenty-files-prod

- **volumeBackupId:** `oGxdDhtMUOUUL2GOhJrnz`
- **volumeName:** `twenty_server-local-data`
- **prefix:** `full-snapshots/twenty-files`
- **composeId:** `oI7-NCBTpfyrxJBitrJrd0`
- **serviceName:** `server`
- **cron:** `0 2 * * *`
- **keepLatestCount:** 7
- **turnOff:** true

### crmparser-data-prod

- **volumeBackupId:** `hjNHo-tuuwf_7UtDHQkOn`
- **volumeName:** `crmparser_crmparser-data`
- **prefix:** `full-snapshots/crmparser-sqlite`
- **composeId:** `JWIhULvt6slzDxT8AQXyWz`
- **serviceName:** `crmparser`
- **cron:** `0 2 * * *`
- **keepLatestCount:** 7
- **turnOff:** true

Older per-volume jobs (`twenty_db-data`, legacy prefixes under `twenty/` and `crmparser/`) remain for ad-hoc use; the full-snapshot pipeline uses the two jobs above.

## PG backup retention

| Field | Current value |
|-------|---------------|
| backupId | `0rInusnjJ7d64Z3Pvm31O` |
| prefix | `twenty-pg` |
| schedule | `0 2 * * *` |
| keepLatestCount | **14** (target: **7**) |

**Manual step required:** `backup.update` via Dokploy API returned HTTP 400 when setting `keepLatestCount: 7` programmatically (2026-07-29). Update retention in Dokploy UI:

1. Open Twenty compose → Backups → existing Postgres backup (`twenty-pg`).
2. Set **Keep latest** to **7**.
3. Save.

After UI update, verify with `GET /backup.one?backupId=0rInusnjJ7d64Z3Pvm31O` that `keepLatestCount` is 7.

## Dokploy HTTP client

```js
import { createDokployClient } from './lib/dokploy-client.js';

const client = createDokployClient({
  baseUrl: process.env.DOKPLOY_URL,
  apiKey: process.env.DOKPLOY_API_KEY,
});

await client.manualBackupCompose(process.env.DOKPLOY_TWENTY_PG_BACKUP_ID);
await client.runVolumeBackup(process.env.DOKPLOY_TWENTY_FILES_VOLUME_BACKUP_ID);
await client.runVolumeBackup(process.env.DOKPLOY_CRMPARSER_VOLUME_BACKUP_ID);
const files = await client.listBackupFiles(
  process.env.DOKPLOY_DESTINATION_ID,
  'full-snapshots',
);
```

## Smoke test (optional, low-traffic window)

Trigger once after wiring GitHub vars:

1. `POST backup.manualBackupCompose` with PG backup id
2. `POST volumeBackups.runManually` for files volume backup id
3. `POST volumeBackups.runManually` for crmparser volume backup id
4. Confirm objects under `full-snapshots/` via `backup.listBackupFiles`

## Tests

```bash
cd ops/backup && npm test
```

## Capture orchestrator (`capture.mjs`)

Triggers a tied full prod snapshot: PG compose backup + both volume backups, polls MinIO via Dokploy until each new artifact appears, then writes a manifest.

```bash
cd ops/backup
export DOKPLOY_URL=...
export DOKPLOY_API_KEY=...
export DOKPLOY_TWENTY_PG_BACKUP_ID=0rInusnjJ7d64Z3Pvm31O
export DOKPLOY_TWENTY_FILES_VOLUME_BACKUP_ID=oGxdDhtMUOUUL2GOhJrnz
export DOKPLOY_CRMPARSER_VOLUME_BACKUP_ID=hjNHo-tuuwf_7UtDHQkOn
export DOKPLOY_DESTINATION_ID=TfR-Va14SJniAB91hlgbt
export TWENTY_APP_VERSION=0.5.4
export CRMPARSER_IMAGE=ghcr.io/3au4uk-1/crmparserv2@sha256:...
# optional: CRMPARSER_DIGEST=sha256:...

node capture.mjs --out manifest.json
```

| Flag | Default | Notes |
|------|---------|-------|
| `--out` | `./manifest.json` | Manifest path (also printed to stdout) |
| `--skip-versions` | off | Dry-run: sets `unknown` version placeholders |

**Fail-closed:** any trigger error, poll timeout, or missing component key → exit 1; no manifest file is written.

Polling:

| Step | Search prefix | Timeout |
|------|---------------|---------|
| PG | `twenty-pg` | 10 min |
| Twenty files volume | `full-snapshots/twenty-files` | 20 min |
| crmparser volume | `full-snapshots/crmparser-sqlite` | 20 min |

Poll interval: 15 s. New files are detected by diffing `listBackupFiles` results before/after trigger. When the API returns object entries with `modifiedAt` / `LastModified`, capture picks the newest new key with mtime ≥ capture start. Otherwise it uses set-diff on path strings (Dokploy returns newest first).

**Version fail-fast:** `TWENTY_APP_VERSION` and `CRMPARSER_IMAGE` are validated before any backup is triggered (unless `--skip-versions`), so misconfigured runs fail in seconds instead of after poll timeouts.

### Concurrency

Nightly cron (`0 2 * * *`) and a manual `release-prepare` capture can overlap. Poll logic snapshots known keys immediately before each trigger, then waits for a key not in that set. If Dokploy returns only path strings (typical today), a concurrent job that finishes first may produce the "new" key capture binds to — run manual captures outside the nightly window when possible, or accept that the manifest points at whichever backup finished first during overlap. Timestamp-aware selection applies when the list API exposes mtime metadata.

## Prune orchestrator (`prune.mjs`)

Lists expired snapshot folder prefixes under `full-snapshots/YYYYMMDDTHHMMSSZ/` (7-day retention). Does **not** delete objects — v1 delegates deletion to the GitHub workflow.

```bash
node prune.mjs > expired.json
# or stdout only:
node prune.mjs
# { "expiredPrefixes": ["full-snapshots/20260720T010000Z/", ...] }
```

**Workflow contract (Task 4):** parse `expiredPrefixes` from stdout JSON; for each prefix run `mc rm --recursive` on the MinIO bucket over SSH. Component volume prefixes (`full-snapshots/twenty-files`, `full-snapshots/crmparser-sqlite`) are managed by Dokploy `keepLatestCount`, not this prune pass.

| Flag | Default |
|------|---------|
| `--retention-days` | `7` |

## Release prepare workflow (`release-prepare.yml`)

Captures a tied full prod snapshot before promoting staging → main. Also runs on a nightly cron (`0 2 * * *`) aligned with Dokploy backup jobs.

### Release gate (manual dispatch)

**Do not merge staging → main unless a manual `release-prepare` workflow run succeeded for that release.** Nightly cron snapshots are for retention/testing only — they use placeholder versions (`nightly` / `latest`) and do not satisfy the release gate.

Before opening or merging the promote PR:

1. Confirm prod is on the Twenty app version and crmparser image you are about to replace (note digest if available).
2. Actions → **Release prepare (full prod snapshot)** → **Run workflow** on the release branch (usually `staging`).
3. Fill inputs (both required — workflow never uses `--skip-versions` on dispatch):
   - **twenty_app_version** — Twenty app version currently running on prod (e.g. `0.5.4`).
   - **crmparser_image** — full image ref; prefer digest form `ghcr.io/3au4uk-1/crmparserv2@sha256:…` over a moving tag.
4. Wait for green. Capture takes up to ~20 minutes (PG poll 10 min + volume polls 20 min).
5. Download artifact **`release-manifest-<snapshotId>`** and spot-check `manifest.json`: all three component keys present, versions match prod.
6. Optional: confirm `full-snapshots/<snapshotId>/manifest.json` in MinIO when `DOCKER_HOST_SSH_KEY` is configured.
7. Only then merge staging → main and deploy.

If capture fails, do **not** promote. Fix Dokploy/GitHub wiring or retry outside the `02:00` UTC nightly window to reduce poll races (see **Concurrency** under capture).

### Nightly cron

Scheduled runs use `TWENTY_APP_VERSION=nightly` and `CRMPARSER_IMAGE=ghcr.io/3au4uk-1/crmparserv2:latest`. Artifacts are retained 14 days. Expired snapshot folder prefixes (>7 days) are written to **`expired-snapshot-prefixes-<snapshotId>`** artifact (`expired.json`).

Deletion of expired objects is best-effort when `DOCKER_HOST_SSH_KEY` is set (runs `mc rm --recursive` on the docker host). Without SSH secrets, operators must delete listed prefixes manually or enable secrets and re-run.

### Required GitHub configuration checklist

- [ ] Secrets: `DOKPLOY_URL`, `DOKPLOY_API_KEY`
- [ ] Variables: `DOKPLOY_TWENTY_PG_BACKUP_ID`, `DOKPLOY_TWENTY_FILES_VOLUME_BACKUP_ID`, `DOKPLOY_CRMPARSER_VOLUME_BACKUP_ID`, `DOKPLOY_DESTINATION_ID`
- [ ] Optional: `DOCKER_HOST_SSH_KEY` + `MINIO_*` / `DOCKER_HOST*` vars for MinIO manifest copy and prune deletion

## Dry-run without Dokploy

Unit tests cover `normalizeBackupFileList`, `findNewBackupKey`, `pollForNewBackupKey`, `extractSnapshotPrefixesFromKeys`, and `resolveVersions`. Live Dokploy smoke requires secrets above; defer to low-traffic window after GitHub vars are set.

## Host restore (`restore-host.sh`)

On the docker host (CT 103), restores a prod snapshot manifest into **staging** or **prod** data volumes only. Never rewrites env files or Dokploy compose environment.

```bash
cd ops/backup
./restore-host.sh \
  --target staging \
  --snapshot-id 20260729T153045Z \
  --manifest ./manifest.json

# Plan only:
./restore-host.sh --target staging --snapshot-id 20260729T153045Z --manifest ./manifest.json --dry-run
```

| Flag | Required | Notes |
|------|----------|-------|
| `--target` | yes | `staging` or `prod` |
| `--snapshot-id` | yes | Canonical id from capture manifest |
| `--manifest` | yes | Local path to manifest JSON (component keys) |
| `--dry-run` | no | Print actions; no stop/restore/start |
| `--workdir` | no | Temp download dir (default `/tmp/restore-<id>-<pid>`) |

**Target volume names:**

| Target | Postgres volume | Twenty files | crmparser data |
|--------|-----------------|--------------|----------------|
| staging | `twenty-staging_db-data` | `twenty-staging_server-local-data` | `crmparser-staging_crmparser-data` |
| prod | `twenty_db-data` | `twenty_server-local-data` | `crmparser_crmparser-data` |

**Behavior (fail-closed):**

1. Stop containers in compose projects `twenty-staging` + `crmparser-staging` (or prod equivalents) only.
2. Download `twentyPg`, `twentyFiles`, `crmparserSqlite` objects from MinIO via `mc` (`MINIO_MC_ALIAS` / `MINIO_BUCKET`).
3. Restore Postgres (detect `.sql` vs custom → `psql` / `pg_restore`).
4. Extract volume tar archives into target Docker volumes.
5. On **any** failure: exit 1, services stay stopped.
6. On success: start stopped containers, wait for `pg_isready` + Twenty server `/healthz`.

Requires on host: `docker`, `mc`, `node` (optional manifest validation), network to MinIO alias.

## Staging data refresh workflow (`staging-refresh-data.yml`)

Manual **Actions → Staging data refresh** on `staging` branch. Overwrites staging Postgres + file volumes from a prod snapshot; staging env (`DISABLE_AUTO_PARSE=true`, URLs, tokens) unchanged.

### Inputs

| Input | Default | Notes |
|-------|---------|-------|
| `snapshot_id` | latest folder under `full-snapshots/` in MinIO | Explicit `YYYYMMDDTHHMMSSZ` recommended for repeatability |
| `dry_run` | `false` | SSH to host and run `restore-host.sh --dry-run` |

### Required GitHub configuration

| Name | Type | Notes |
|------|------|-------|
| `DOCKER_HOST_SSH_KEY` | Secret | Private key for docker host — **required for live refresh** |
| `DOCKER_HOST` | Variable | Default `10.50.50.132` |
| `DOCKER_HOST_USER` | Variable | Default `root` |
| `MINIO_MC_ALIAS` | Variable | Default `minio-home` (must exist on host) |
| `MINIO_BUCKET` | Variable | Default `dokploy` |

Without `DOCKER_HOST_SSH_KEY`: use `dry_run=true`, or pass `snapshot_id` only after configuring SSH. Live refresh fails closed with a clear error.

After live restore, workflow verifies `DISABLE_AUTO_PARSE=true` on the `crmparser-staging` container.

### Operator smoke (post-refresh)

1. Log in to staging Twenty; open **Реализация** (deals board).
2. Open crmparser staging UI; confirm SQLite-backed data.
3. Spot-check an attachment if present (requires matching `ENCRYPTION_KEY` with prod).

**Precondition:** staging `ENCRYPTION_KEY` must match prod for attachment decryption.

## Dokploy compose IDs (restore targets)

| Stack | Compose id | Compose project |
|-------|------------|-----------------|
| Twenty prod | `oI7-NCBTpfyrxJBitrJrd0` | `twenty` |
| Twenty staging | `eMjWv7p-ovnfQ7XnpFKTe` | `twenty-staging` |
| crmparser prod | `JWIhULvt6slzDxT8AQXyWz` | `crmparser` |
| crmparser staging | `wjfA-wPgjI2FH8wW4ypcx` | `crmparser-staging` |
