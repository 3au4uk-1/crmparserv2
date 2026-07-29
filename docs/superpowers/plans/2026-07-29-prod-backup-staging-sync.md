# Prod backup, staging data refresh, and rollback — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship ops tooling so every prod promote has a full 7-day snapshot (Postgres + SQLite + Twenty files), staging can refresh data from that snapshot, and operators can rollback data or the full release.

**Architecture:** Dokploy-native capture (compose PG backup + volume backups) plus small Node/ESM helpers and GitHub Actions `workflow_dispatch`/cron in `crmparserv2`. Restore/refresh runs over SSH on the docker host (CT 103) with fail-closed starts. Manifest JSON ties snapshot components to image/app versions for release rollback.

**Tech Stack:** Node ESM + Vitest (pure helpers), Dokploy API (`backup.*`, `volumeBackups.*`, `compose.*`), GitHub Actions, SSH + Docker on `10.50.50.132`, MinIO destination `minio-home`.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-29-prod-backup-staging-sync-design.md`
- Snapshot components: `twenty-pg` + `twenty-files` + `crmparser-sqlite` + `manifest.json`
- Retention: **7 days** (align Dokploy `keepLatestCount` to 7)
- Staging refresh overwrites **data volumes only** (never staging env/tokens/`DISABLE_AUTO_PARSE`)
- Two rollbacks: `rollback-data` (volumes only) and `rollback-release` (volumes + previous crmparser image + Twenty app version)
- Pre-release gate fail-closed: incomplete snapshot → do not promote
- Incomplete restore → do not start services half-restored
- Out of scope: brandogram/brandingteam/twentydash, S3 storage migration, auto-merge to main, live shared prod DB
- Prefer image **digest** over moving tags in manifests
- Do not commit secrets; use GitHub secrets / Dokploy env

## File map

| File | Responsibility |
|------|----------------|
| `ops/backup/lib/snapshot-id.js` | Build canonical snapshot ids |
| `ops/backup/lib/manifest.js` | Create/validate `manifest.json` shape |
| `ops/backup/lib/prune.js` | Decide which snapshot prefixes to delete (>7 days) |
| `ops/backup/lib/dokploy-client.js` | Thin fetch wrapper for Dokploy API |
| `ops/backup/capture.mjs` | Orchestrate PG + volume backups + write/upload manifest |
| `ops/backup/prune.mjs` | List MinIO/Dokploy backup files and prune by age |
| `ops/backup/restore-host.sh` | On docker host: stop targets, restore volumes/DB, start only if OK |
| `ops/backup/README.md` | Operator playbook (prepare / refresh / rollback) |
| `ops/backup/tests/*.test.js` | Vitest for pure libs |
| `.github/workflows/release-prepare.yml` | `workflow_dispatch` + nightly cron → capture |
| `.github/workflows/staging-refresh-data.yml` | `workflow_dispatch` → restore into staging |
| `.github/workflows/rollback-data.yml` | `workflow_dispatch` → restore into prod (data only) |
| `.github/workflows/rollback-release.yml` | `workflow_dispatch` → data restore + pin images/app |
| Dokploy UI/API (no repo file) | Update PG backup keep=7; create volume backup jobs |

**Known IDs (verify still current before wiring secrets/vars):**

| Resource | Id / name |
|----------|-----------|
| Twenty prod compose | `oI7-NCBTpfyrxJBitrJrd0` (`twenty`) |
| Twenty staging compose | `eMjWv7p-ovnfQ7XnpFKTe` (`twenty-staging`) |
| crmparser prod | `JWIhULvt6slzDxT8AQXyWz` |
| crmparser staging | `wjfA-wPgjI2FH8wW4ypcx` |
| Existing Twenty PG backup | `0rInusnjJ7d64Z3Pvm31O` (prefix `twenty-pg`) |
| MinIO destination | `TfR-Va14SJniAB91hlgbt` (`minio-home`) |
| Docker host | Dokploy server `docker` / CT 103 |

Volume names must be confirmed with `docker volume ls` on the host (expected shapes: `twenty_server-local-data`, `crmparser_crmparser-data` or project-prefixed equivalents; staging: `twenty-staging_server-local-data`, `crmparser-staging_crmparser-data`).

---

### Task 1: Snapshot id, manifest, prune helpers (+ tests)

**Files:**
- Create: `ops/backup/lib/snapshot-id.js`
- Create: `ops/backup/lib/manifest.js`
- Create: `ops/backup/lib/prune.js`
- Create: `ops/backup/tests/snapshot-id.test.js`
- Create: `ops/backup/tests/manifest.test.js`
- Create: `ops/backup/tests/prune.test.js`
- Create: `ops/backup/package.json` (private package, vitest only — keep isolated from backend)

**Interfaces:**
- Produces:
  - `buildSnapshotId(date = new Date()): string` → `YYYYMMDDTHHMMSSZ` UTC, e.g. `20260729T153045Z`
  - `createManifest(input): object` / `assertManifest(obj): void` (throws on invalid)
  - Manifest required fields: `snapshotId`, `createdAt`, `retentionDays` (7), `components: { twentyPg, twentyFiles, crmparserSqlite }` (each `{ key, source }`), `versions: { crmparserImage, crmparserDigest?, twentyAppVersion }`, `environment: 'production'`
  - `listExpiredSnapshotPrefixes(prefixes: string[], now: Date, retentionDays = 7): string[]` — prefixes look like `full-snapshots/20260720T020000Z/`; expire when snapshot time &lt; now − retentionDays

- [ ] **Step 1: Add `ops/backup/package.json`**

```json
{
  "name": "crmparser-ops-backup",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run"
  },
  "devDependencies": {
    "vitest": "^4.1.8"
  }
}
```

- [ ] **Step 2: Write failing tests**

`ops/backup/tests/snapshot-id.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { buildSnapshotId } from '../lib/snapshot-id.js';

describe('buildSnapshotId', () => {
  it('formats UTC compact timestamp with Z', () => {
    const d = new Date('2026-07-29T15:30:45.123Z');
    expect(buildSnapshotId(d)).toBe('20260729T153045Z');
  });
});
```

`ops/backup/tests/manifest.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { createManifest, assertManifest } from '../lib/manifest.js';

describe('manifest', () => {
  it('createManifest fills required shape', () => {
    const m = createManifest({
      snapshotId: '20260729T153045Z',
      components: {
        twentyPg: { key: 'twenty-pg/x.sql.gz', source: 'dokploy-compose' },
        twentyFiles: { key: 'full-snapshots/20260729T153045Z/twenty-files.tar.gz', source: 'dokploy-volume' },
        crmparserSqlite: { key: 'full-snapshots/20260729T153045Z/crmparser-data.tar.gz', source: 'dokploy-volume' },
      },
      versions: {
        crmparserImage: 'ghcr.io/3au4uk-1/crmparserv2:abc123',
        crmparserDigest: 'sha256:deadbeef',
        twentyAppVersion: '0.5.4',
      },
    });
    expect(m.retentionDays).toBe(7);
    expect(m.environment).toBe('production');
    expect(() => assertManifest(m)).not.toThrow();
  });

  it('assertManifest rejects missing component key', () => {
    expect(() =>
      assertManifest({
        snapshotId: 'x',
        createdAt: new Date().toISOString(),
        retentionDays: 7,
        environment: 'production',
        components: {
          twentyPg: { key: 'a', source: 'dokploy-compose' },
          twentyFiles: { key: '', source: 'dokploy-volume' },
          crmparserSqlite: { key: 'c', source: 'dokploy-volume' },
        },
        versions: { crmparserImage: 'img', twentyAppVersion: '1.0.0' },
      }),
    ).toThrow(/twentyFiles/);
  });
});
```

`ops/backup/tests/prune.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { listExpiredSnapshotPrefixes } from '../lib/prune.js';

describe('listExpiredSnapshotPrefixes', () => {
  it('keeps snapshots inside 7 days', () => {
    const now = new Date('2026-07-29T12:00:00Z');
    const prefixes = [
      'full-snapshots/20260729T010000Z/',
      'full-snapshots/20260720T010000Z/',
      'full-snapshots/20260721T120000Z/',
    ];
    const expired = listExpiredSnapshotPrefixes(prefixes, now, 7);
    expect(expired).toEqual(['full-snapshots/20260720T010000Z/']);
  });
});
```

- [ ] **Step 3: Run tests — expect FAIL**

```bash
cd ops/backup && npm install && npm test
```

Expected: FAIL (modules missing / cannot resolve).

- [ ] **Step 4: Implement libs**

`ops/backup/lib/snapshot-id.js`:

```js
export function buildSnapshotId(date = new Date()) {
  const iso = date.toISOString(); // 2026-07-29T15:30:45.123Z
  return iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}
```

`ops/backup/lib/manifest.js`:

```js
export function createManifest({ snapshotId, components, versions, createdAt = new Date().toISOString() }) {
  const manifest = {
    snapshotId,
    createdAt,
    retentionDays: 7,
    environment: 'production',
    components,
    versions,
  };
  assertManifest(manifest);
  return manifest;
}

export function assertManifest(m) {
  if (!m || typeof m !== 'object') throw new Error('manifest: not an object');
  for (const k of ['snapshotId', 'createdAt', 'retentionDays', 'environment', 'components', 'versions']) {
    if (m[k] == null) throw new Error(`manifest: missing ${k}`);
  }
  if (m.retentionDays !== 7) throw new Error('manifest: retentionDays must be 7');
  if (m.environment !== 'production') throw new Error('manifest: environment must be production');
  for (const name of ['twentyPg', 'twentyFiles', 'crmparserSqlite']) {
    const c = m.components?.[name];
    if (!c?.key) throw new Error(`manifest: components.${name}.key required`);
    if (!c?.source) throw new Error(`manifest: components.${name}.source required`);
  }
  if (!m.versions?.crmparserImage) throw new Error('manifest: versions.crmparserImage required');
  if (!m.versions?.twentyAppVersion) throw new Error('manifest: versions.twentyAppVersion required');
}
```

`ops/backup/lib/prune.js`:

```js
import { buildSnapshotId } from './snapshot-id.js';

/** @param {string} prefix e.g. full-snapshots/20260720T010000Z/ */
export function parseSnapshotTimeFromPrefix(prefix) {
  const m = prefix.match(/full-snapshots\/(\d{8}T\d{6}Z)\//);
  if (!m) return null;
  const s = m[1];
  const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function listExpiredSnapshotPrefixes(prefixes, now = new Date(), retentionDays = 7) {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  return prefixes.filter((p) => {
    const t = parseSnapshotTimeFromPrefix(p);
    return t != null && t < cutoff;
  });
}

// re-export for tests that want id format compatibility
export { buildSnapshotId };
```

- [ ] **Step 5: Run tests — expect PASS**

```bash
cd ops/backup && npm test
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add ops/backup
git commit -m "feat(ops): snapshot manifest and prune helpers for prod backups"
```

---

### Task 2: Dokploy retention + volume backup jobs

**Files:**
- Modify: Dokploy (API/UI) — not a git file; record resulting IDs in `ops/backup/README.md` and GitHub Variables
- Create/update: `ops/backup/README.md` (IDs section)
- Create: `ops/backup/lib/dokploy-client.js`
- Create: `ops/backup/tests/dokploy-client.test.js` (mock fetch)

**Interfaces:**
- Produces:
  - `createDokployClient({ baseUrl, apiKey })` → `{ post(path, body), get(path, query) }`
  - Documented volumeBackupIds: `TWENTY_FILES_VOLUME_BACKUP_ID`, `CRMPARSER_DATA_VOLUME_BACKUP_ID`
  - PG backup `keepLatestCount` set to **7**

- [ ] **Step 1: Confirm volume names on host** (SSH or Dokploy terminal)

```bash
docker volume ls | grep -E 'twenty|crmparser'
```

Record exact names for prod `server-local-data` and crmparser data volumes.

- [ ] **Step 2: Update existing PG backup retention to 7**

Via Dokploy MCP/API `backup.update` with existing backup id `0rInusnjJ7d64Z3Pvm31O`:

- `keepLatestCount: 7`
- keep schedule `0 2 * * *`, destination `TfR-Va14SJniAB91hlgbt`, database `default`, serviceName `db`, databaseType `postgres`, prefix `twenty-pg`, enabled true

- [ ] **Step 3: Create two volume backups (prod)**

Via `volumeBackups.create` (or UI):

1. **twenty-files-prod**
   - `volumeName`: confirmed prod server-local-data volume
   - `prefix`: `full-snapshots/twenty-files`
   - `serviceType`: `compose`
   - `composeId`: `oI7-NCBTpfyrxJBitrJrd0`
   - `serviceName`: `server` (or null if volume is compose-level — match Dokploy UI)
   - `destinationId`: `TfR-Va14SJniAB91hlgbt`
   - `cronExpression`: `0 2 * * *`
   - `keepLatestCount`: 7
   - `turnOff`: `true` (brief stop for consistency — preferred for files)
   - `enabled`: true

2. **crmparser-data-prod**
   - `volumeName`: confirmed prod crmparser data volume
   - `prefix`: `full-snapshots/crmparser-sqlite`
   - `serviceType`: `compose`
   - `composeId`: `JWIhULvt6slzDxT8AQXyWz`
   - `cronExpression`: `0 2 * * *`
   - `keepLatestCount`: 7
   - `turnOff`: `true`
   - `enabled`: true
   - `destinationId`: same MinIO

Save returned `volumeBackupId` values into GitHub repo Variables:
- `DOKPLOY_TWENTY_PG_BACKUP_ID=0rInusnjJ7d64Z3Pvm31O`
- `DOKPLOY_TWENTY_FILES_VOLUME_BACKUP_ID=...`
- `DOKPLOY_CRMPARSER_VOLUME_BACKUP_ID=...`
- `DOKPLOY_DESTINATION_ID=TfR-Va14SJniAB91hlgbt`
- Compose IDs as vars if not already hardcoded only in scripts

- [ ] **Step 4: Implement dokploy client + test**

`ops/backup/lib/dokploy-client.js`:

```js
export function createDokployClient({ baseUrl, apiKey, fetchImpl = fetch }) {
  if (!baseUrl) throw new Error('DOKPLOY_URL required');
  if (!apiKey) throw new Error('DOKPLOY_API_KEY required');
  const root = baseUrl.replace(/\/$/, '');

  async function request(method, path, { body, query } = {}) {
    const url = new URL(`${root}/api${path}`);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v != null) url.searchParams.set(k, String(v));
      }
    }
    const res = await fetchImpl(url, {
      method,
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: body != null ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      throw new Error(`Dokploy ${method} ${path} → ${res.status}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
    }
    return data;
  }

  return {
    get: (path, query) => request('GET', path, { query }),
    post: (path, body) => request('POST', path, { body }),
    manualBackupCompose: (backupId) => request('POST', '/backup.manualBackupCompose', { body: { backupId } }),
    runVolumeBackup: (volumeBackupId) => request('POST', '/volumeBackups.runManually', { body: { volumeBackupId } }),
    listBackupFiles: (destinationId, search) =>
      request('GET', '/backup.listBackupFiles', { query: { destinationId, search } }),
    composeDeploy: (composeId, title, description) =>
      request('POST', '/compose.deploy', { body: { composeId, title, description } }),
  };
}
```

Test with mocked fetch asserting headers and paths (PASS).

- [ ] **Step 5: Smoke trigger once** (manual, low traffic)

```text
POST backup.manualBackupCompose { backupId: PG }
POST volumeBackups.runManually { volumeBackupId: files }
POST volumeBackups.runManually { volumeBackupId: sqlite }
```

Confirm new objects appear via `backup.listBackupFiles`.

- [ ] **Step 6: Document IDs in README + commit client**

```bash
git add ops/backup
git commit -m "feat(ops): Dokploy client and volume backup wiring notes"
```

---

### Task 3: Capture orchestrator (`capture.mjs` + prune)

**Files:**
- Create: `ops/backup/capture.mjs`
- Create: `ops/backup/prune.mjs`
- Modify: `ops/backup/README.md`

**Interfaces:**
- Consumes: Task 1 libs + Task 2 dokploy client
- Produces CLI:
  - `node capture.mjs` → prints manifest JSON to stdout; writes `manifest.json` to `--out` (default `./manifest.json`); exit 1 if any step fails
  - Env: `DOKPLOY_URL`, `DOKPLOY_API_KEY`, `DOKPLOY_TWENTY_PG_BACKUP_ID`, `DOKPLOY_TWENTY_FILES_VOLUME_BACKUP_ID`, `DOKPLOY_CRMPARSER_VOLUME_BACKUP_ID`, `DOKPLOY_DESTINATION_ID`, optional `CRMPARSER_IMAGE`, `CRMPARSER_DIGEST`, `TWENTY_APP_VERSION`
  - `node prune.mjs` → lists `full-snapshots/` prefixes via `listBackupFiles`, deletes expired via documented MinIO/mc or Dokploy file delete if available; if delete API missing, print expired keys and fail with instructions (implement delete with `mc` over SSH in Task 4 if needed)

- [ ] **Step 1: Implement `capture.mjs`**

Logic:

1. `snapshotId = buildSnapshotId()`
2. Trigger PG manual backup; wait/poll `listBackupFiles` search `twenty-pg` until a new file newer than start appears (timeout 10 min) → `twentyPgKey`
3. Trigger both volume backups; poll for new files under their prefixes (timeout 20 min)
4. Resolve versions:
   - Prefer env `CRMPARSER_DIGEST` / `CRMPARSER_IMAGE`
   - Else inspect running container via optional `--skip-versions` false and require env (CI will pass digest from `docker buildx imagetools` or GHCR API)
   - `TWENTY_APP_VERSION` required from env (CI reads from BrandingTwentyView or operator input)
5. `createManifest(...)`; write file; exit 0

Fail closed: any timeout/missing key → exit 1, do not write success marker.

- [ ] **Step 2: Implement `prune.mjs`**

1. `listBackupFiles(destinationId, 'full-snapshots/')`
2. Derive unique prefixes matching `full-snapshots/YYYYMMDDTHHMMSSZ/`
3. `listExpiredSnapshotPrefixes`
4. For each expired prefix, delete objects (prefer `mc rm --recursive` via SSH in workflow; local prune.mjs can output JSON list `expiredPrefixes` for the workflow to consume)

For v1 acceptable split: `prune.mjs` outputs JSON `{ expiredPrefixes: [...] }`; deletion happens in GH job shell with MinIO client. Document that contract in README.

- [ ] **Step 3: Unit-test any pure parsing added** (if listBackupFiles response shaping helpers); otherwise manual dry-run note in README.

- [ ] **Step 4: Commit**

```bash
git add ops/backup
git commit -m "feat(ops): capture and prune orchestrators for full prod snapshots"
```

---

### Task 4: GitHub workflows — `release-prepare` + nightly

**Files:**
- Create: `.github/workflows/release-prepare.yml`
- Modify: GitHub Secrets/Variables (docs in README): ensure `DOKPLOY_URL`, `DOKPLOY_API_KEY`; add vars from Task 2; add `DOCKER_HOST_SSH_KEY` (or reuse existing) if prune deletion needs SSH; optional `MINIO_*` if using `mc` from runner
- Modify: `ops/backup/README.md` — operator steps for release gate

**Interfaces:**
- Workflow inputs (`workflow_dispatch`):
  - `twenty_app_version` (string, required for dispatch; cron job reads last known from a var or skips version pin with `unknown` only for nightly — **nightly may set `twentyAppVersion` to `nightly` and `crmparserImage` to `nightly`**; release-prepare requires real versions)
- Uploads `manifest.json` as workflow artifact named `release-manifest-<snapshotId>`
- Also stores a copy under MinIO prefix `full-snapshots/<snapshotId>/manifest.json` via SSH/`mc` when possible

- [ ] **Step 1: Write `.github/workflows/release-prepare.yml`**

Outline:

```yaml
name: Release prepare (full prod snapshot)

on:
  workflow_dispatch:
    inputs:
      twenty_app_version:
        description: Twenty app version currently on prod (for rollback manifest)
        required: true
        type: string
      crmparser_image:
        description: Full image ref including digest if known
        required: true
        type: string
  schedule:
    - cron: '0 2 * * *'  # align with Dokploy; capture.mjs still triggers manual runs for a tied snapshot id

jobs:
  snapshot:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - name: Install ops/backup deps
        working-directory: ops/backup
        run: npm ci || npm install
      - name: Capture full snapshot
        working-directory: ops/backup
        env:
          DOKPLOY_URL: ${{ secrets.DOKPLOY_URL }}
          DOKPLOY_API_KEY: ${{ secrets.DOKPLOY_API_KEY }}
          DOKPLOY_TWENTY_PG_BACKUP_ID: ${{ vars.DOKPLOY_TWENTY_PG_BACKUP_ID }}
          DOKPLOY_TWENTY_FILES_VOLUME_BACKUP_ID: ${{ vars.DOKPLOY_TWENTY_FILES_VOLUME_BACKUP_ID }}
          DOKPLOY_CRMPARSER_VOLUME_BACKUP_ID: ${{ vars.DOKPLOY_CRMPARSER_VOLUME_BACKUP_ID }}
          DOKPLOY_DESTINATION_ID: ${{ vars.DOKPLOY_DESTINATION_ID }}
          TWENTY_APP_VERSION: ${{ github.event.inputs.twenty_app_version || 'nightly' }}
          CRMPARSER_IMAGE: ${{ github.event.inputs.crmparser_image || 'ghcr.io/3au4uk-1/crmparserv2:latest' }}
        run: node capture.mjs --out manifest.json
      - name: Upload manifest artifact
        uses: actions/upload-artifact@v4
        with:
          name: release-manifest
          path: ops/backup/manifest.json
      - name: Prune expired full-snapshots
        working-directory: ops/backup
        env:
          DOKPLOY_URL: ${{ secrets.DOKPLOY_URL }}
          DOKPLOY_API_KEY: ${{ secrets.DOKPLOY_API_KEY }}
          DOKPLOY_DESTINATION_ID: ${{ vars.DOKPLOY_DESTINATION_ID }}
        run: node prune.mjs --out expired.json
      # Follow with mc/SSH delete using expired.json when credentials available
```

Gate rule for humans: **do not merge staging→main unless this workflow succeeded** for the release (dispatch, not merely nightly).

- [ ] **Step 2: Dry-run `workflow_dispatch` on staging branch** (or main after merge of ops). Confirm artifact + MinIO objects.

- [ ] **Step 3: Commit workflow + README**

```bash
git add .github/workflows/release-prepare.yml ops/backup/README.md
git commit -m "ci: add release-prepare full snapshot workflow"
```

---

### Task 5: Host restore script + staging refresh workflow

**Files:**
- Create: `ops/backup/restore-host.sh`
- Create: `.github/workflows/staging-refresh-data.yml`
- Modify: `ops/backup/README.md`

**Interfaces:**
- `restore-host.sh` args:
  - `--target staging|prod`
  - `--snapshot-id ID` (required)
  - `--manifest path` (local manifest with component keys)
  - Behavior:
    1. Resolve compose project / container names for target
    2. `docker compose stop` (or `docker stop`) twenty + crmparser for target **only**
    3. Restore Postgres from `twentyPg` dump into target db container (`pg_restore` / `psql` as matching Dokploy dump format — detect `.sql` vs custom)
    4. Restore file volumes from tar into target volume names
    5. On any failure: print error, **do not start**, exit 1
    6. On success: start compose, wait for healthz / `pg_isready`, exit 0
  - Must never rewrite env files

- Staging workflow:
  - Input: optional `snapshot_id` (default: latest manifest artifact or latest prefix)
  - SSH to docker host, copy script + manifest, run `--target staging`
  - Verify `DISABLE_AUTO_PARSE` still true by inspecting container env after start

- [ ] **Step 1: Write `restore-host.sh`** with `set -euo pipefail`, explicit volume names from README, and a `--dry-run` that prints actions only.

- [ ] **Step 2: Test dry-run on host** against staging names.

- [ ] **Step 3: Real staging refresh once** in a window where staging downtime is OK. Smoke: login staging Twenty, open Реализация, open parser UI, confirm attachment if present.

- [ ] **Step 4: Add `.github/workflows/staging-refresh-data.yml`** (`workflow_dispatch`) that SSHes and runs the script.

- [ ] **Step 5: Commit**

```bash
git add ops/backup/restore-host.sh .github/workflows/staging-refresh-data.yml ops/backup/README.md
git commit -m "feat(ops): staging data refresh from prod snapshot"
```

---

### Task 6: Rollback data + rollback release workflows

**Files:**
- Create: `.github/workflows/rollback-data.yml`
- Create: `.github/workflows/rollback-release.yml`
- Modify: `ops/backup/README.md` (runbooks)
- Optional note in BrandingTwentyView README pointing to crmparserv2 playbook (one paragraph) — only if user wants cross-link; default keep single playbook in crmparserv2

**Interfaces:**
- `rollback-data.yml` inputs: `snapshot_id` (required), confirmation string `RESTORE_PROD` (required) to prevent accidents
- Runs `restore-host.sh --target prod` via SSH; fail-closed
- `rollback-release.yml` inputs: same + uses manifest `versions`:
  1. Run data restore
  2. Update crmparser compose image to digest/tag from manifest; `compose.deploy` prod crmparser id
  3. Trigger Twenty app deploy+install of `twentyAppVersion` to prod URL (reuse pattern from BrandingTwentyView `cd.yml`: `twentyhq/twenty/.github/actions/deploy-twenty-app` + install) using `TWENTY_DEPLOY_URL` + `TWENTY_DEPLOY_API_KEY` — add those secrets to crmparserv2 **or** `workflow_call` / `repository_dispatch` into BrandingTwentyView; prefer documenting `repository_dispatch` to BrandingTwentyView if secrets should not be duplicated

**Recommended for Twenty app rollback:** `repository_dispatch` event `rollback-twenty-app` on BrandingTwentyView with client_payload `{ version }`, handled by a small workflow there that checks out that version tag/commit and runs deploy+install. If no git tags for versions, payload includes `ref` (commit SHA) recorded in manifest — **extend manifest in Task 1/3 if needed with `twentyAppGitSha`**. Add field in capture when known.

- [ ] **Step 1: Extend manifest versions** (if not already) with optional `twentyAppGitSha` — update assertManifest to allow optional; update capture + tests.

- [ ] **Step 2: Implement `rollback-data.yml`** with confirmation gate.

- [ ] **Step 3: Implement `rollback-release.yml`** + BrandingTwentyView dispatch receiver workflow `rollback-app.yml` (create in BrandingTwentyView repo).

- [ ] **Step 4: Drill on staging: fake data corruption → rollback-data equivalent (restore staging from known snapshot). Do **not** drill prod without explicit user approval.

- [ ] **Step 5: Commit both repos as needed**

```bash
# crmparserv2
git add .github/workflows/rollback-data.yml .github/workflows/rollback-release.yml ops/backup
git commit -m "feat(ops): prod data and release rollback workflows"

# BrandingTwentyView (if dispatch receiver added)
git add .github/workflows/rollback-app.yml
git commit -m "ci: accept repository_dispatch to redeploy pinned app version"
```

---

### Task 7: Operator playbook finalization + verification checklist

**Files:**
- Modify: `ops/backup/README.md` (complete runbook)
- Optional: short pointer from root `README.md` under a new “Production releases” section (5–10 lines)

**Playbook must include exact order:**

1. Optional `staging-refresh-data`
2. Smoke on staging
3. `release-prepare` (dispatch with real versions) — **mandatory**
4. Merge staging→main (parser + Twenty View)
5. Watch existing CD
6. Prod smoke
7. On failure: `rollback-data` or `rollback-release`

**Verification checklist (tick in PR description when ops lands):**

- [ ] Nightly/full capture creates PG + files + sqlite objects and a valid manifest
- [ ] Prune would list prefixes older than 7 days (show `expired.json` sample)
- [ ] Staging refresh leaves env intact (`DISABLE_AUTO_PARSE=true`)
- [ ] Staging smoke OK after refresh
- [ ] Rollback-data confirmation gate rejects without `RESTORE_PROD`
- [ ] Dokploy PG `keepLatestCount` is 7

- [ ] **Step 1: Write README sections** — Overview, Secrets/Vars, Volume names, Runbooks, Disaster notes (`ENCRYPTION_KEY` must match for file decrypt on staging).

- [ ] **Step 2: Commit**

```bash
git add ops/backup/README.md README.md
git commit -m "docs(ops): production backup and rollback playbook"
```

---

## Spec coverage self-check

| Spec requirement | Task |
|------------------|------|
| Full snapshot PG + sqlite + files | 2, 3, 4 |
| Nightly + pre-release | 4 |
| Retention 7 days | 1 (prune), 2 (Dokploy keep), 4 |
| Staging data-only refresh | 5 |
| Rollback data | 6 |
| Rollback release (data + code) | 6 |
| Fail-closed capture/restore | 3, 5, 6 |
| ENCRYPTION_KEY precondition | 7 |
| Out of scope siblings | documented non-goals in README |
| Manifest with versions | 1, 3, 4, 6 |

## Placeholder / consistency scan

- No TBD steps; volume names confirmed in Task 2 before wiring.
- Manifest field names consistent: `twentyPg`, `twentyFiles`, `crmparserSqlite`, `retentionDays: 7`.
- Optional `twentyAppGitSha` introduced only in Task 6 with test update — do not invent other aliases.
