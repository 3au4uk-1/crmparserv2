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

GitHub **Secrets** (not variables): `DOKPLOY_URL`, `DOKPLOY_API_KEY`.

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

Poll interval: 15 s. New files are detected by diffing `listBackupFiles` results before/after trigger (Dokploy returns path strings, newest first).

## Prune orchestrator (`prune.mjs`)

Lists expired snapshot folder prefixes under `full-snapshots/YYYYMMDDTHHMMSSZ/` (7-day retention). Does **not** delete objects — v1 delegates deletion to the GitHub workflow.

```bash
node prune.mjs
# stdout:
# { "expiredPrefixes": ["full-snapshots/20260720T010000Z/", ...] }
```

**Workflow contract (Task 4):** parse `expiredPrefixes` from stdout JSON; for each prefix run `mc rm --recursive` on the MinIO bucket over SSH. Component volume prefixes (`full-snapshots/twenty-files`, `full-snapshots/crmparser-sqlite`) are managed by Dokploy `keepLatestCount`, not this prune pass.

| Flag | Default |
|------|---------|
| `--retention-days` | `7` |

## Dry-run without Dokploy

Unit tests cover `normalizeBackupFileList`, `findNewBackupKey`, `pollForNewBackupKey`, `extractSnapshotPrefixesFromKeys`, and `resolveVersions`. Live Dokploy smoke requires secrets above; defer to low-traffic window after GitHub vars are set.
