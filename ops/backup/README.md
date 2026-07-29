# Production backup and rollback playbook

Operator runbook for the `twenty_brand` prod snapshot pipeline: full backups (Postgres + Twenty files + crmparser SQLite), staging data refresh, pre-release gate, and prod rollback. Workflows live in **crmparserv2** GitHub Actions; BrandingTwentyView participates only via release manifest and existing CD / rollback dispatch.

Secrets live in GitHub Actions secrets / Dokploy env — **never** commit API keys or MinIO credentials here.

## Overview

| Component | What it does |
|-----------|--------------|
| **Nightly capture** | Cron `0 2 * * *` — same format as pre-release; placeholder versions (`nightly` / `latest`); retention/testing only |
| **`release-prepare`** | **Mandatory gate** before staging→main — tied full prod snapshot + `manifest.json` with real prod versions |
| **`staging-refresh-data`** | Overwrites staging data volumes from a prod snapshot; env unchanged |
| **`rollback-data`** | Restores prod data volumes only; images/app version unchanged |
| **`rollback-release`** | Data restore + pin crmparser image + dispatch Twenty app rollback |

**Snapshot contents:** `twentyPg`, `twentyFiles`, `crmparserSqlite`, plus `manifest.json` (`retentionDays: 7`). Restore source of truth for release, staging refresh, and rollback.

**Fail-closed:** capture, restore, and rollback workflows exit 1 on any missing component, failed poll, wrong confirmation, or incomplete restore — services stay stopped until fixed.

## Non-goals (v1)

Out of scope for this release path:

- **brandogram**, **brandingteam**, **twentydash** — separate stacks; not covered here
- Moving Twenty storage to S3
- Automatic merge staging→main without a human
- PITR finer than whole-snapshot restore
- Staging reading/writing live prod databases

## Production release sequence

Follow this order for every prod promote (parser + BrandingTwentyView):

1. **Optional:** [`staging-refresh-data`](#staging-data-refresh-staging-refresh-datayml) — refresh staging from latest prod snapshot
2. **Smoke on staging** — Twenty login, **Реализация**, crmparser UI; spot-check attachment if present ([`ENCRYPTION_KEY`](#disaster-notes) must match prod)
3. **Mandatory:** [`release-prepare`](#release-prepare-release-prepareyml) — dispatch with **real** prod `twenty_app_version` and `crmparser_image` (digest preferred); wait for green; download `release-manifest-<snapshotId>` artifact
4. **Merge staging→main** — crmparserv2 and BrandingTwentyView in coordinated order
5. **Watch existing CD** — crmparserv2 `docker-publish`, BrandingTwentyView `cd.yml`
6. **Prod smoke** — Twenty login, **Реализация**, crmparser UI
7. **On failure:** [`rollback-data`](#prod-data-rollback-rollback-datayml) (data only) or [`rollback-release`](#prod-release-rollback-rollback-releaseyml) (data + previous code)

**Do not merge staging→main unless a manual `release-prepare` run succeeded for that release.** Nightly cron snapshots do not satisfy the release gate.

## Verification checklist

Tick in PR description when ops completes each drill. Items marked **operator follow-up** are not yet verified in automation.

- [ ] **Operator follow-up:** Nightly/full capture creates PG + files + sqlite objects and a valid manifest (all three component keys + versions)
- [ ] **Operator follow-up:** Prune lists prefixes older than 7 days — run `node prune.mjs` locally or download `expired-snapshot-prefixes-<snapshotId>` artifact; expect `{ "expiredPrefixes": ["full-snapshots/YYYYMMDDTHHMMSSZ/", ...] }`
- [ ] **Operator follow-up:** Staging refresh leaves env intact — workflow asserts `DISABLE_AUTO_PARSE=true` on `crmparser-staging`; URLs/tokens unchanged
- [ ] **Operator follow-up:** Staging smoke OK after refresh (Twenty, Реализация, parser UI, optional attachment)
- [ ] **Operator follow-up:** Rollback-data confirmation gate rejects without `RESTORE_PROD` (dry-run: dispatch with wrong/missing confirm → workflow fails)
- [ ] **Operator follow-up:** Dokploy PG `keepLatestCount` is **7** (verify in Dokploy UI; see [PG backup retention](#pg-backup-retention))

**Unit tests (run anytime):**

```bash
cd ops/backup && npm test
```

## Secrets and variables

### GitHub repository variables

Settings → Secrets and variables → Actions → **Variables**:

| Variable | Value | Notes |
|----------|-------|-------|
| `DOKPLOY_TWENTY_PG_BACKUP_ID` | `0rInusnjJ7d64Z3Pvm31O` | Compose PG backup, prefix `twenty-pg` |
| `DOKPLOY_TWENTY_FILES_VOLUME_BACKUP_ID` | `oGxdDhtMUOUUL2GOhJrnz` | Job name `twenty-files-prod` |
| `DOKPLOY_CRMPARSER_VOLUME_BACKUP_ID` | `hjNHo-tuuwf_7UtDHQkOn` | Job name `crmparser-data-prod` |
| `DOKPLOY_DESTINATION_ID` | `TfR-Va14SJniAB91hlgbt` | MinIO destination `minio-home` |
| `DOKPLOY_TWENTY_COMPOSE_ID` | `oI7-NCBTpfyrxJBitrJrd0` | Prod Twenty compose |
| `DOKPLOY_CRMPARSER_COMPOSE_ID` | `JWIhULvt6slzDxT8AQXyWz` | Prod crmparser compose |

Optional SSH/MinIO (defaults in workflows when unset):

| Variable | Default | Notes |
|----------|---------|-------|
| `DOCKER_HOST` | `10.50.50.132` | Docker host reachable from GitHub runners |
| `DOCKER_HOST_USER` | `root` | SSH user on docker host |
| `MINIO_MC_ALIAS` | `minio-home` | `mc` alias on docker host |
| `MINIO_BUCKET` | `dokploy` | Verify with `mc ls minio-home/` on host |

### GitHub repository secrets

Settings → Secrets and variables → Actions → **Secrets**:

| Secret | Required by | Notes |
|--------|-------------|-------|
| `DOKPLOY_URL` | `release-prepare`, rollback pin, `docker-publish` | Dokploy API base URL |
| `DOKPLOY_API_KEY` | same | Dokploy API key |
| `DOCKER_HOST_SSH_KEY` | staging refresh, rollback, optional MinIO upload/prune | Private key for docker host (CT 103) |
| `BRANDING_TWENTYVIEW_DISPATCH_TOKEN` | `rollback-release` only | PAT with `repo` scope on BrandingTwentyView |

Twenty deploy credentials stay in BrandingTwentyView (`TWENTY_DEPLOY_URL`, `TWENTY_DEPLOY_API_KEY`).

### Required GitHub configuration checklist

- [ ] Secrets: `DOKPLOY_URL`, `DOKPLOY_API_KEY`
- [ ] Variables: `DOKPLOY_TWENTY_PG_BACKUP_ID`, `DOKPLOY_TWENTY_FILES_VOLUME_BACKUP_ID`, `DOKPLOY_CRMPARSER_VOLUME_BACKUP_ID`, `DOKPLOY_DESTINATION_ID`
- [ ] Optional: `DOCKER_HOST_SSH_KEY` + `MINIO_*` / `DOCKER_HOST*` for MinIO manifest copy and prune deletion
- [ ] Rollback release: `BRANDING_TWENTYVIEW_DISPATCH_TOKEN`

## Volume names

Confirmed via Dokploy volume backup jobs (compose project prefixes):

| Service | Compose project | Prod volume | Staging volume |
|---------|-----------------|-------------|----------------|
| Twenty Postgres | `twenty` / `twenty-staging` | `twenty_db-data` | `twenty-staging_db-data` |
| Twenty local files | `twenty` / `twenty-staging` | `twenty_server-local-data` | `twenty-staging_server-local-data` |
| crmparser SQLite | `crmparser` / `crmparser-staging` | `crmparser_crmparser-data` | `crmparser-staging_crmparser-data` |

### Dokploy compose IDs (restore targets)

| Stack | Compose id | Compose project |
|-------|------------|-----------------|
| Twenty prod | `oI7-NCBTpfyrxJBitrJrd0` | `twenty` |
| Twenty staging | `eMjWv7p-ovnfQ7XnpFKTe` | `twenty-staging` |
| crmparser prod | `JWIhULvt6slzDxT8AQXyWz` | `crmparser` |
| crmparser staging | `wjfA-wPgjI2FH8wW4ypcx` | `crmparser-staging` |

### Volume backup jobs (prod)

Both jobs exist in Dokploy and are enabled:

**twenty-files-prod** — volumeBackupId `oGxdDhtMUOUUL2GOhJrnz`, prefix `full-snapshots/twenty-files`, cron `0 2 * * *`, `keepLatestCount: 7`, `turnOff: true`

**crmparser-data-prod** — volumeBackupId `hjNHo-tuuwf_7UtDHQkOn`, prefix `full-snapshots/crmparser-sqlite`, cron `0 2 * * *`, `keepLatestCount: 7`, `turnOff: true`

Older per-volume jobs (`twenty_db-data`, legacy prefixes) remain for ad-hoc use; the full-snapshot pipeline uses the two jobs above.

### PG backup retention

| Field | Current value |
|-------|---------------|
| backupId | `0rInusnjJ7d64Z3Pvm31O` |
| prefix | `twenty-pg` |
| schedule | `0 2 * * *` |
| keepLatestCount | **7** |

**Manual step required:** Confirm **Keep latest** is **7** in Dokploy UI:

1. Open Twenty compose → Backups → Postgres backup (`twenty-pg`).
2. Verify **Keep latest** is **7**.
3. Save if changed and verify via `GET /backup.one?backupId=0rInusnjJ7d64Z3Pvm31O`.

## Runbooks

### Release prepare (`release-prepare.yml`)

**When:** Mandatory before every staging→main merge. Also runs nightly (retention only).

**Trigger:** Actions → **Release prepare (full prod snapshot)** → **Run workflow** on `staging`.

**Inputs (dispatch — both required):**

| Input | Example | Notes |
|-------|---------|-------|
| `twenty_app_version` | `0.5.4` | Twenty app version currently on prod |
| `crmparser_image` | `ghcr.io/3au4uk-1/crmparserv2@sha256:…` | Prefer digest over moving tag |

Optional env at capture time: `TWENTY_APP_GIT_SHA` — BrandingTwentyView commit on prod (helps release rollback checkout).

**Steps:**

1. Confirm prod Twenty version and crmparser image/digest you are about to replace.
2. Run workflow; wait for green (~20 min: PG poll 10 min + volume polls 20 min).
3. Download artifact **`release-manifest-<snapshotId>`**; spot-check `manifest.json`: keys `twentyPg`, `twentyFiles`, `crmparserSqlite`, versions match prod.
4. Optional: confirm `full-snapshots/<snapshotId>/manifest.json` in MinIO when SSH configured.
5. Proceed with merge only after success.

**Nightly cron:** uses `TWENTY_APP_VERSION=nightly` and `CRMPARSER_IMAGE=ghcr.io/3au4uk-1/crmparserv2:latest`. Artifacts retained 14 days. Expired prefixes (>7 days) in **`expired-snapshot-prefixes-<snapshotId>`** artifact.

**On failure:** do not promote. Fix wiring or retry outside `02:00` UTC nightly window (see [Concurrency](#concurrency) under capture).

### Staging data refresh (`staging-refresh-data.yml`)

**When:** Optional before release — load fresh prod-like data on staging without changing staging config.

**Trigger:** Actions → **Staging data refresh** on `staging`.

| Input | Default | Notes |
|-------|---------|-------|
| `snapshot_id` | latest under `full-snapshots/` | Explicit `YYYYMMDDTHHMMSSZ` recommended |
| `dry_run` | `false` | SSH + `restore-host.sh --dry-run` |

**Requires:** `DOCKER_HOST_SSH_KEY` (live refresh and meaningful dry-run both fail without it).

**Behavior:** stops `twenty-staging` + `crmparser-staging`, restores PG + files + sqlite from manifest, starts services, verifies `DISABLE_AUTO_PARSE=true`. Never rewrites env files.

**Post-refresh smoke:**

1. Log in to staging Twenty; open **Реализация**.
2. Open crmparser staging UI; confirm SQLite-backed data.
3. Spot-check an attachment if present ([`ENCRYPTION_KEY`](#disaster-notes) must match prod).

**Staging-equivalent rollback drill:** use this workflow with a known snapshot id before first prod rollback.

### Prod data rollback (`rollback-data.yml`)

**When:** Prod release broke data but code/images are fine, or data-only incident.

**Trigger:** Actions → **Rollback prod data** on `staging`.

| Input | Required | Notes |
|-------|----------|-------|
| `snapshot_id` | yes | `YYYYMMDDTHHMMSSZ` from release-prepare manifest |
| `confirm` | yes | Must be exactly `RESTORE_PROD` |

**Steps:**

1. Identify snapshot from last good `release-prepare` artifact or MinIO `full-snapshots/<id>/manifest.json`.
2. Run workflow with `snapshot_id` and `confirm=RESTORE_PROD`.
3. Monitor; on failure services stay stopped.
4. Prod smoke: Twenty login, **Реализация**, crmparser UI.

**Do not run without explicit operator approval.**

### Prod release rollback (`rollback-release.yml`)

**When:** Full revert to pre-release state (data + crmparser image + Twenty app version).

**Trigger:** Actions → **Rollback prod release (data + code)** on `staging`. Same inputs as data-only (`snapshot_id` + `RESTORE_PROD`).

**Runs in order:**

1. Prod data restore (`restore-host.sh --target prod`)
2. Pin prod crmparser image from manifest (`pin-crmparser-image.mjs` → `compose.update` + `compose.deploy`)
3. `repository_dispatch` to `3au4uk-1/BrandingTwentyView` event `rollback-twenty-app` with `{ version, ref?, snapshot_id }`

Receiver: BrandingTwentyView `.github/workflows/rollback-app.yml`.

**Manifest version fields:**

| Field | Required | Notes |
|-------|----------|-------|
| `versions.crmparserImage` | yes | Prefer digest form |
| `versions.crmparserDigest` | optional | Used when image not `@sha256`-pinned |
| `versions.twentyAppVersion` | yes | Passed to BrandingTwentyView dispatch |
| `versions.twentyAppGitSha` | optional | Git ref for checkout; set via `TWENTY_APP_GIT_SHA` at capture |

## Disaster notes

### `ENCRYPTION_KEY` mismatch

Twenty file attachments are encrypted at rest. Staging **must** use the same `ENCRYPTION_KEY` as prod for restored attachments to decrypt.

- Current staging was cloned from prod — keys should match today.
- If keys diverge later (separate Dokploy env edit), file restore will succeed but attachments will be unreadable.
- **Before staging refresh:** confirm `ENCRYPTION_KEY` on `twenty-staging` matches prod `twenty` compose.
- **Symptom:** deals board loads but attachment download/preview fails after refresh.
- **Fix:** align keys in Dokploy env, then re-run refresh or restore affected files from snapshot.

### Incomplete restore

If restore fails mid-way, workflows fail closed — services stay stopped. Do not start stacks manually in a half-restored state. Retry with the same `snapshot_id` after fixing MinIO/SSH/host issues.

### Lost manifest

Snapshot objects remain under MinIO prefixes (`twenty_db/twenty-pg`, `twenty_server/full-snapshots/twenty-files`, `crmparser_crmparser/full-snapshots/crmparser-sqlite`, `full-snapshots/<snapshotId>/`). Reconstruct component keys from Dokploy backup file list or download the GitHub artifact from the original `release-prepare` run.

### Concurrent nightly + manual capture

Nightly cron and manual `release-prepare` can overlap. Prefer manual captures outside `02:00` UTC. See [Concurrency](#concurrency) under capture.

---

## Technical reference

### Capture orchestrator (`capture.mjs`)

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

node capture.mjs --out manifest.json
```

| Flag | Default | Notes |
|------|---------|-------|
| `--out` | `./manifest.json` | Manifest path (also printed to stdout) |
| `--skip-versions` | off | Dry-run: sets `unknown` version placeholders |

Polling: PG `twenty_db/twenty-pg` (10 min), volumes `twenty_server/full-snapshots/twenty-files` / `crmparser_crmparser/full-snapshots/crmparser-sqlite` (20 min each), interval 15 s. `listBackupFiles` passes `DOKPLOY_SERVER_ID` (default `U9UZM_1xUvc-Uw_0YXMSmA`) for the remote Docker host.

#### Concurrency

Poll logic snapshots known keys before each trigger, then waits for a new key. If Dokploy returns only path strings, a concurrent job that finishes first may bind to the wrong artifact — run manual captures outside the nightly window when possible.

### Prune orchestrator (`prune.mjs`)

Lists expired snapshot folder prefixes under `full-snapshots/YYYYMMDDTHHMMSSZ/` (7-day retention). Does **not** delete — workflow delegates deletion via `mc rm --recursive`.

```bash
node prune.mjs > expired.json
# { "expiredPrefixes": ["full-snapshots/20260720T010000Z/", ...] }
```

Component volume prefixes are managed by Dokploy `keepLatestCount`, not this prune pass.

### Host restore (`restore-host.sh`)

On docker host (CT 103):

```bash
cd ops/backup
./restore-host.sh \
  --target staging \
  --snapshot-id 20260729T153045Z \
  --manifest ./manifest.json

./restore-host.sh --target staging --snapshot-id 20260729T153045Z --manifest ./manifest.json --dry-run
```

Requires on host: `docker`, `mc`, `node` (optional manifest validation).

### Dokploy HTTP client

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
  'twenty_server/full-snapshots',
  process.env.DOKPLOY_SERVER_ID,
);
```

### Tests

```bash
cd ops/backup && npm test
npm run test:pg-format   # bash: Dokploy twenty_db/*.sql.gz → pg_restore format detection
```

### Smoke test (optional, low-traffic window)

After wiring GitHub vars:

1. `POST backup.manualBackupCompose` with PG backup id
2. `POST volumeBackups.runManually` for files and crmparser volume backup ids
3. Confirm objects under `full-snapshots/` via `backup.listBackupFiles`
