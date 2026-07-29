# Dokploy remote-exec restore (replace SSH) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all SSH/`scp` from ops workflows by running host commands through persistent Dokploy server Schedule jobs (`update` → `runManually` → poll logs).

**Architecture:** Extend `dokploy-client` with schedule/deployment APIs; add `schedule-remote` helpers that sync `ops/backup` bash+lib into `/etc/dokploy/ops-backup/` and run wrapped scripts ending with `[remote-ok]`; switch staging refresh, rollbacks, and release-prepare MinIO steps to `remote-run.mjs`.

**Tech Stack:** Node 22 ESM, Vitest, Dokploy REST (`schedule.*`, `deployment.allByType`, `deployment.readLogs`), GitHub Actions `ubuntu-latest`, bash on Docker host via Dokploy SSH.

## Global Constraints

- Host path: `/etc/dokploy/ops-backup/` (exact)
- Success marker: logs must contain line `[remote-ok]`
- Deployment statuses: `pending` | `running` | `done` | `error`
- Two disabled server schedules: sync + run; GH vars `DOKPLOY_SCHEDULE_OPS_SYNC`, `DOKPLOY_SCHEDULE_OPS_RUN`
- No SSH secrets in workflows after cutover (`DOCKER_HOST_SSH_KEY` unused)
- Keep `restore-host.sh` restore semantics; sync must include files it needs on host
- Sync file set (host): `restore-host.sh`, `lib/pg-restore-format.sh`, `lib/manifest.js`
- Poll defaults: interval `5000` ms; sync/mc timeout `600000` ms; restore timeout `2700000` ms (45 min)
- Spec: `docs/superpowers/specs/2026-07-29-dokploy-remote-exec-restore-design.md`

## File structure

| File | Responsibility |
|------|----------------|
| `ops/backup/lib/dokploy-client.js` | HTTP client + schedule/deployment methods |
| `ops/backup/lib/schedule-remote.js` | wrap script, build sync script, run+poll, parse log markers |
| `ops/backup/remote-run.mjs` | CLI: `sync` \| `run` for Actions |
| `ops/backup/ensure-schedules.mjs` | Create disabled schedules once; print IDs for GH vars |
| `ops/backup/tests/dokploy-client.test.js` | Client path/header tests (extend) |
| `ops/backup/tests/schedule-remote.test.js` | Pure unit tests for wrap/sync/parse/poll |
| `.github/workflows/staging-refresh-data.yml` | Refresh via remote-run |
| `.github/workflows/rollback-data.yml` | Prod data rollback via remote-run |
| `.github/workflows/rollback-release.yml` | Prod data restore step via remote-run |
| `.github/workflows/release-prepare.yml` | MinIO upload/prune via remote-run |
| `ops/backup/README.md` | Operator docs: schedules instead of SSH |

---

### Task 1: Dokploy client — schedule + deployment APIs

**Files:**
- Modify: `ops/backup/lib/dokploy-client.js`
- Modify: `ops/backup/tests/dokploy-client.test.js`

**Interfaces:**
- Consumes: existing `createDokployClient({ baseUrl, apiKey, fetchImpl })`
- Produces:
  - `client.scheduleCreate(body)` → `POST /schedule.create`
  - `client.scheduleUpdate(body)` → `POST /schedule.update`
  - `client.scheduleRunManually(scheduleId)` → `POST /schedule.runManually` body `{ scheduleId }`
  - `client.scheduleList(id, scheduleType)` → `GET /schedule.list` query `{ id, scheduleType }`
  - `client.deploymentAllByType(id, type)` → `GET /deployment.allByType` query `{ id, type }`
  - `client.deploymentReadLogs(deploymentId, tail = 500)` → `GET /deployment.readLogs` query `{ deploymentId, tail }`

- [ ] **Step 1: Write failing tests for new methods**

Append to `ops/backup/tests/dokploy-client.test.js`:

```js
  it('schedule and deployment methods hit expected paths', async () => {
    const client = createDokployClient({
      baseUrl: 'https://dokploy.example',
      apiKey: 'secret-key',
      fetchImpl,
    });

    await client.scheduleCreate({
      name: 'ops-backup-sync',
      cronExpression: '0 0 1 1 *',
      command: 'true',
      scheduleType: 'server',
      serverId: 'srv-1',
      enabled: false,
      shellType: 'bash',
    });
    await client.scheduleUpdate({ scheduleId: 'sch-1', command: 'echo hi' });
    await client.scheduleRunManually('sch-1');
    await client.scheduleList('srv-1', 'server');
    await client.deploymentAllByType('sch-1', 'schedule');
    await client.deploymentReadLogs('dep-1', 200);

    const paths = fetchImpl.mock.calls.map(([url]) => url.pathname);
    expect(paths).toEqual([
      '/api/schedule.create',
      '/api/schedule.update',
      '/api/schedule.runManually',
      '/api/schedule.list',
      '/api/deployment.allByType',
      '/api/deployment.readLogs',
    ]);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ops/backup && npm test -- tests/dokploy-client.test.js`

Expected: FAIL — methods not defined / not functions

- [ ] **Step 3: Implement methods on the client return object**

In `ops/backup/lib/dokploy-client.js`, add to the returned object:

```js
    scheduleCreate: (body) => request('POST', '/schedule.create', { body }),
    scheduleUpdate: (body) => request('POST', '/schedule.update', { body }),
    scheduleRunManually: (scheduleId) =>
      request('POST', '/schedule.runManually', { body: { scheduleId } }),
    scheduleList: (id, scheduleType) =>
      request('GET', '/schedule.list', { query: { id, scheduleType } }),
    deploymentAllByType: (id, type) =>
      request('GET', '/deployment.allByType', { query: { id, type } }),
    deploymentReadLogs: (deploymentId, tail = 500) =>
      request('GET', '/deployment.readLogs', { query: { deploymentId, tail } }),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ops/backup && npm test -- tests/dokploy-client.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ops/backup/lib/dokploy-client.js ops/backup/tests/dokploy-client.test.js
git commit -m "feat(ops): Dokploy client schedule and deployment APIs"
```

---

### Task 2: `schedule-remote` helpers (wrap, sync, poll, parse)

**Files:**
- Create: `ops/backup/lib/schedule-remote.js`
- Create: `ops/backup/tests/schedule-remote.test.js`

**Interfaces:**
- Consumes: Dokploy client methods from Task 1
- Produces:
  - `HOST_OPS_ROOT = '/etc/dokploy/ops-backup'`
  - `REMOTE_OK_MARKER = '[remote-ok]'`
  - `wrapRemoteScript(bodyScript: string): string` — prepends `set -euo pipefail`, appends `echo '[remote-ok]'`
  - `buildSyncScript(files: Array<{ relativePath: string, content: string }>, hostRoot?: string): string` — mkdir + heredoc writes + chmod + list + relies on wrap for marker
  - `parseRemoteOk(logs: string): boolean`
  - `parseMarkerValue(logs: string, key: string): string | null` — matches `^KEY=(.+)$` multiline (e.g. `SNAPSHOT_ID=`)
  - `normalizeDeployments(data: unknown): Array<{ deploymentId: string, status: string, createdAt?: string }>`
  - `pickNewestDeployment(list): object | null`
  - `isTerminalStatus(status: string): boolean` — `done` or `error`
  - `async runScheduleJob({ client, scheduleId, script, command?, pollIntervalMs?, timeoutMs?, now? }): Promise<{ deploymentId: string, status: string, logs: string }>`  
    Behavior: `scheduleUpdate` with `{ scheduleId, script, command: command ?? 'bash', shellType: 'bash' }` → record `startedAt` → `scheduleRunManually` → poll `deploymentAllByType(scheduleId, 'schedule')` until newest deployment with `createdAt >= startedAt` (or first new id) reaches terminal → `deploymentReadLogs` → if status !== `done` OR `!parseRemoteOk(logs)` throw Error including tail of logs

- [ ] **Step 1: Write failing unit tests**

Create `ops/backup/tests/schedule-remote.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';
import {
  wrapRemoteScript,
  buildSyncScript,
  parseRemoteOk,
  parseMarkerValue,
  normalizeDeployments,
  pickNewestDeployment,
  isTerminalStatus,
  runScheduleJob,
  HOST_OPS_ROOT,
  REMOTE_OK_MARKER,
} from '../lib/schedule-remote.js';

describe('wrapRemoteScript', () => {
  it('adds set -euo pipefail and remote-ok marker', () => {
    const out = wrapRemoteScript('echo hi');
    expect(out.startsWith('set -euo pipefail\n')).toBe(true);
    expect(out).toContain('echo hi');
    expect(out.trimEnd().endsWith(`echo '${REMOTE_OK_MARKER}'`)).toBe(true);
  });
});

describe('buildSyncScript', () => {
  it('writes files under host root with heredocs', () => {
    const script = buildSyncScript([
      { relativePath: 'restore-host.sh', content: '#!/bin/bash\necho x\n' },
      { relativePath: 'lib/manifest.js', content: 'export const x = 1;\n' },
    ]);
    expect(script).toContain(`mkdir -p '${HOST_OPS_ROOT}/lib'`);
    expect(script).toContain(`cat > '${HOST_OPS_ROOT}/restore-host.sh' <<'EOF'`);
    expect(script).toContain('#!/bin/bash');
    expect(script).toContain(`chmod +x '${HOST_OPS_ROOT}/restore-host.sh'`);
    expect(script).toContain(`cat > '${HOST_OPS_ROOT}/lib/manifest.js' <<'EOF'`);
  });
});

describe('parseRemoteOk / parseMarkerValue', () => {
  it('detects marker line', () => {
    expect(parseRemoteOk('a\n[remote-ok]\n')).toBe(true);
    expect(parseRemoteOk('nope')).toBe(false);
  });
  it('parses KEY=value lines', () => {
    expect(parseMarkerValue('SNAPSHOT_ID=20260729T170122Z\n', 'SNAPSHOT_ID')).toBe(
      '20260729T170122Z',
    );
    expect(parseMarkerValue('x', 'SNAPSHOT_ID')).toBe(null);
  });
});

describe('deployments helpers', () => {
  it('normalizes array payloads and picks newest by createdAt', () => {
    const list = normalizeDeployments([
      { deploymentId: 'a', status: 'done', createdAt: '2026-07-29T10:00:00.000Z' },
      { deploymentId: 'b', status: 'running', createdAt: '2026-07-29T11:00:00.000Z' },
    ]);
    expect(pickNewestDeployment(list).deploymentId).toBe('b');
  });
  it('isTerminalStatus', () => {
    expect(isTerminalStatus('done')).toBe(true);
    expect(isTerminalStatus('error')).toBe(true);
    expect(isTerminalStatus('running')).toBe(false);
  });
});

describe('runScheduleJob', () => {
  it('updates, runs, polls until done with remote-ok', async () => {
    const client = {
      scheduleUpdate: vi.fn(async () => ({})),
      scheduleRunManually: vi.fn(async () => ({})),
      deploymentAllByType: vi
        .fn()
        .mockResolvedValueOnce([
          { deploymentId: 'd1', status: 'running', createdAt: '2026-07-29T12:00:01.000Z' },
        ])
        .mockResolvedValueOnce([
          { deploymentId: 'd1', status: 'done', createdAt: '2026-07-29T12:00:01.000Z' },
        ]),
      deploymentReadLogs: vi.fn(async () => 'ok\n[remote-ok]\n'),
    };

    const result = await runScheduleJob({
      client,
      scheduleId: 'sch-1',
      script: wrapRemoteScript('echo ok'),
      pollIntervalMs: 1,
      timeoutMs: 1000,
      now: () => new Date('2026-07-29T12:00:00.000Z'),
    });

    expect(client.scheduleUpdate).toHaveBeenCalled();
    expect(client.scheduleRunManually).toHaveBeenCalledWith('sch-1');
    expect(result.status).toBe('done');
    expect(result.logs).toContain('[remote-ok]');
  });

  it('throws when done without remote-ok', async () => {
    const client = {
      scheduleUpdate: vi.fn(async () => ({})),
      scheduleRunManually: vi.fn(async () => ({})),
      deploymentAllByType: vi.fn(async () => [
        { deploymentId: 'd1', status: 'done', createdAt: '2026-07-29T12:00:01.000Z' },
      ]),
      deploymentReadLogs: vi.fn(async () => 'finished without marker\n'),
    };
    await expect(
      runScheduleJob({
        client,
        scheduleId: 'sch-1',
        script: 'echo x',
        pollIntervalMs: 1,
        timeoutMs: 500,
        now: () => new Date('2026-07-29T12:00:00.000Z'),
      }),
    ).rejects.toThrow(/remote-ok/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ops/backup && npm test -- tests/schedule-remote.test.js`

Expected: FAIL — module not found

- [ ] **Step 3: Implement `ops/backup/lib/schedule-remote.js`**

Implement exports to satisfy tests. Notes:

- `normalizeDeployments`: accept raw array or `{ deployments: [] }` or empty → `[]`; map `deploymentId` from `deploymentId` or `id`
- `deploymentReadLogs` may return string or `{ logs: string }` — normalize to string in `runScheduleJob`
- When picking the run’s deployment: prefer newest with `createdAt >= startedAt - 2000` ms; if none, newest overall after run
- On `status === 'error'`, throw with logs
- `buildSyncScript` must escape nothing inside `'EOF'` heredocs; reject file content containing a line that is exactly `EOF` (throw) to avoid breaking heredoc

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ops/backup && npm test -- tests/schedule-remote.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ops/backup/lib/schedule-remote.js ops/backup/tests/schedule-remote.test.js
git commit -m "feat(ops): schedule-remote wrap sync and poll helpers"
```

---

### Task 3: CLI `remote-run.mjs` + `ensure-schedules.mjs`

**Files:**
- Create: `ops/backup/remote-run.mjs`
- Create: `ops/backup/ensure-schedules.mjs`

**Interfaces:**
- Consumes: `createDokployClient`, `wrapRemoteScript`, `buildSyncScript`, `runScheduleJob`, `parseMarkerValue`, `HOST_OPS_ROOT`
- Produces CLI:

`node remote-run.mjs sync`  
Env: `DOKPLOY_URL`, `DOKPLOY_API_KEY`, `DOKPLOY_SCHEDULE_OPS_SYNC`  
Reads fixed relative paths from cwd `ops/backup` when invoked with `working-directory: ops/backup`:
- `restore-host.sh`
- `lib/pg-restore-format.sh`
- `lib/manifest.js`  
Builds sync script → wrap → `runScheduleJob` on sync schedule id. Exit 0 on success.

`node remote-run.mjs run --schedule-env DOKPLOY_SCHEDULE_OPS_RUN`  
Reads script body from stdin (or `--script-file path`). Wraps and runs on run schedule. Prints full logs to stdout. Exit 0 on success.

`node ensure-schedules.mjs`  
Env: `DOKPLOY_URL`, `DOKPLOY_API_KEY`, `DOKPLOY_SERVER_ID`  
If `DOKPLOY_SCHEDULE_OPS_SYNC` / `DOKPLOY_SCHEDULE_OPS_RUN` already set, print them and exit 0.  
Else `scheduleCreate` twice:

```js
{
  name: 'ops-backup-sync', // and 'ops-backup-run'
  description: 'crmparser ops backup (manual only)',
  cronExpression: '0 0 1 1 *',
  command: 'true',
  script: "set -euo pipefail\necho '[remote-ok]'\n",
  scheduleType: 'server',
  serverId: process.env.DOKPLOY_SERVER_ID,
  enabled: false,
  shellType: 'bash',
  timezone: 'UTC',
}
```

Print:
```
DOKPLOY_SCHEDULE_OPS_SYNC=<id>
DOKPLOY_SCHEDULE_OPS_RUN=<id>
```
(Parse `scheduleId` from create response — try `result.scheduleId` or `result.id` or nested; if ambiguous, `scheduleList(serverId,'server')` and match by name.)

- [ ] **Step 1: Implement `remote-run.mjs`**

```js
#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDokployClient } from './lib/dokploy-client.js';
import {
  wrapRemoteScript,
  buildSyncScript,
  runScheduleJob,
  HOST_OPS_ROOT,
} from './lib/schedule-remote.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYNC_RELATIVE_PATHS = [
  'restore-host.sh',
  'lib/pg-restore-format.sh',
  'lib/manifest.js',
];

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}

function clientFromEnv() {
  return createDokployClient({
    baseUrl: requireEnv('DOKPLOY_URL'),
    apiKey: requireEnv('DOKPLOY_API_KEY'),
  });
}

async function cmdSync() {
  const scheduleId = requireEnv('DOKPLOY_SCHEDULE_OPS_SYNC');
  const files = SYNC_RELATIVE_PATHS.map((relativePath) => ({
    relativePath,
    content: readFileSync(resolve(__dirname, relativePath), 'utf8'),
  }));
  const script = wrapRemoteScript(buildSyncScript(files));
  const result = await runScheduleJob({
    client: clientFromEnv(),
    scheduleId,
    script,
    timeoutMs: Number(process.env.REMOTE_TIMEOUT_MS || 600_000),
  });
  process.stdout.write(result.logs);
}

async function cmdRun(argv) {
  const envName = (() => {
    const i = argv.indexOf('--schedule-env');
    return i >= 0 ? argv[i + 1] : 'DOKPLOY_SCHEDULE_OPS_RUN';
  })();
  const scheduleId = requireEnv(envName);
  let body;
  const fileIdx = argv.indexOf('--script-file');
  if (fileIdx >= 0) {
    body = readFileSync(argv[fileIdx + 1], 'utf8');
  } else {
    body = readFileSync(0, 'utf8');
  }
  const timeoutMs = Number(process.env.REMOTE_TIMEOUT_MS || 2_700_000);
  const result = await runScheduleJob({
    client: clientFromEnv(),
    scheduleId,
    script: wrapRemoteScript(body),
    timeoutMs,
  });
  process.stdout.write(result.logs);
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'sync') await cmdSync();
else if (cmd === 'run') await cmdRun(rest);
else {
  console.error('Usage: remote-run.mjs sync | run [--schedule-env NAME] [--script-file PATH]');
  process.exit(2);
}
```

- [ ] **Step 2: Implement `ensure-schedules.mjs`** as described above (create if missing).

- [ ] **Step 3: Smoke syntax check**

Run: `cd ops/backup && node --check remote-run.mjs && node --check ensure-schedules.mjs`

Expected: no output, exit 0

- [ ] **Step 4: Commit**

```bash
git add ops/backup/remote-run.mjs ops/backup/ensure-schedules.mjs
git commit -m "feat(ops): remote-run and ensure-schedules CLIs"
```

---

### Task 4: Rewrite `staging-refresh-data.yml`

**Files:**
- Modify: `.github/workflows/staging-refresh-data.yml`

**Interfaces:**
- Consumes: `remote-run.mjs sync|run`, env vars `DOKPLOY_*`, `MINIO_*`, schedule vars
- Produces: same workflow UX (`snapshot_id`, `dry_run`) without SSH

- [ ] **Step 1: Replace workflow body**

Replace SSH steps with:

1. Checkout  
2. Setup Node 22  
3. `npm ci || npm install` in `ops/backup`  
4. **Sync ops tree** — env Dokploy + `DOKPLOY_SCHEDULE_OPS_SYNC`; `node remote-run.mjs sync`  
5. **Resolve snapshot** — if input empty, pipe to `remote-run.mjs run`:

```bash
MC_ALIAS="${MINIO_MC_ALIAS:-minio-home}"
BUCKET="${MINIO_BUCKET:-dokploy}"
cat <<EOF | node remote-run.mjs run
MC_ALIAS='${MC_ALIAS}'
BUCKET='${BUCKET}'
SNAPSHOT_ID=\$(mc ls "\${MC_ALIAS}/\${BUCKET}/full-snapshots/" 2>/dev/null \\
  | awk '{print \$NF}' | sed 's:/\$::' | grep -E '^[0-9]{8}T[0-9]{6}Z\$' | sort -r | head -n1)
[ -n "\$SNAPSHOT_ID" ] || { echo "Could not resolve latest snapshot"; exit 1; }
echo "SNAPSHOT_ID=\$SNAPSHOT_ID"
EOF
```

Parse `SNAPSHOT_ID=` from step logs into `$GITHUB_OUTPUT` (use `node` one-liner or bash `grep`).

If input provided, `echo "id=$SNAPSHOT_INPUT" >> $GITHUB_OUTPUT`.

6. **Dry-run or live restore** — single step selecting flags:

```bash
HOST_ROOT=/etc/dokploy/ops-backup
SNAP='${{ steps.resolve.outputs.id }}'
MC_ALIAS="${MINIO_MC_ALIAS:-minio-home}"
BUCKET="${MINIO_BUCKET:-dokploy}"
WORKDIR="${HOST_ROOT}/work/${SNAP}"
DRY_FLAG=""
# if dry_run input true: DRY_FLAG="--dry-run"
cat <<EOF | REMOTE_TIMEOUT_MS=2700000 node remote-run.mjs run
set -euo pipefail
MC_ALIAS='${MC_ALIAS}'
BUCKET='${BUCKET}'
SNAP='${SNAP}'
HOST_ROOT='${HOST_ROOT}'
WORKDIR='${WORKDIR}'
mkdir -p "\$WORKDIR"
mc cp "\${MC_ALIAS}/\${BUCKET}/full-snapshots/\${SNAP}/manifest.json" "\$WORKDIR/manifest.json"
MINIO_MC_ALIAS="\$MC_ALIAS" MINIO_BUCKET="\$BUCKET" \\
  "\$HOST_ROOT/restore-host.sh" \\
    --target staging \\
    --snapshot-id "\$SNAP" \\
    --manifest "\$WORKDIR/manifest.json" \\
    --workdir "\$WORKDIR" \\
    ${DRY_FLAG}
EOF
```

7. **Verify DISABLE_AUTO_PARSE** (skip if dry_run) via remote-run:

```bash
# docker ps filter crmparser-staging, docker exec printenv DISABLE_AUTO_PARSE, echo VALUE=...
# fail unless true
```

Remove all `DOCKER_HOST_SSH_KEY` / `DOCKER_HOST` / `DOCKER_HOST_USER` references. Update `dry_run` input description to say Dokploy schedule dry-run.

Require vars: document failure message if `DOKPLOY_SCHEDULE_OPS_SYNC` / `RUN` missing.

- [ ] **Step 2: Grep workflow for ssh/scp leftovers**

Run: `rg -n "ssh|scp|DOCKER_HOST_SSH" .github/workflows/staging-refresh-data.yml`

Expected: no matches

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/staging-refresh-data.yml
git commit -m "feat(ops): staging refresh via Dokploy schedule remote exec"
```

---

### Task 5: Rewrite `rollback-data.yml` and `rollback-release.yml` restore steps

**Files:**
- Modify: `.github/workflows/rollback-data.yml`
- Modify: `.github/workflows/rollback-release.yml`

**Interfaces:**
- Same remote-run pattern; keep `confirm=RESTORE_PROD` gate; keep BrandingTwentyView dispatch in release rollback

- [ ] **Step 1: Update `rollback-data.yml`**

Keep confirmation gate. Replace Fetch manifest + Restore steps:

1. Setup Node + npm install ops/backup  
2. Sync  
3. Host: `mc cp` manifest into `/etc/dokploy/ops-backup/work/$SNAP/manifest.json` then `restore-host.sh --target prod ...` (no dry-run)  
4. Drop runner-side `assertManifest` **or** after mc cp, remote script runs:

```bash
cd /etc/dokploy/ops-backup && node --input-type=module -e "
  import { readFileSync } from 'node:fs';
  import { assertManifest } from './lib/manifest.js';
  const m = JSON.parse(readFileSync(process.argv[1],'utf8'));
  assertManifest(m);
  if (m.snapshotId !== process.argv[2]) process.exit(3);
" "$WORKDIR/manifest.json" "$SNAP"
```

(Host must have `node`; if not available, keep bash key checks only — restore-host already uses node for component keys, so node is required on host.)

- [ ] **Step 2: Update `rollback-release.yml` data-restore portion the same way** (leave image pin / dispatch as-is unless they use SSH — if they SSH for manifest, switch those too).

- [ ] **Step 3: Grep both files for ssh/scp**

Run: `rg -n "ssh|scp|DOCKER_HOST_SSH" .github/workflows/rollback-data.yml .github/workflows/rollback-release.yml`

Expected: no matches

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/rollback-data.yml .github/workflows/rollback-release.yml
git commit -m "feat(ops): prod rollback workflows via Dokploy remote exec"
```

---

### Task 6: Rewrite `release-prepare.yml` MinIO optional steps

**Files:**
- Modify: `.github/workflows/release-prepare.yml`

**Interfaces:**
- Capture remains Dokploy API on runner
- Upload manifest + prune delete use remote-run instead of SSH

- [ ] **Step 1: Replace “Upload manifest to MinIO” step**

If schedules configured (both sync+run vars set), else skip with warning (same soft-skip spirit as missing SSH key today):

```bash
node remote-run.mjs sync
# then run with embedded manifest:
# mkdir workdir, cat > manifest from base64 of ops/backup/manifest.json, mc cp to full-snapshots/$ID/manifest.json
```

Pass manifest safely: CI computes `MANIFEST_B64=$(base64 -w0 ops/backup/manifest.json)` and remote script does `echo "$MANIFEST_B64" | base64 -d > ...` (avoid putting raw JSON with quotes into YAML incorrectly — use env `MANIFEST_B64` exported into the heredoc carefully, or `--script-file` generated in a prior step).

Preferred pattern in the step:

```bash
node remote-run.mjs sync
python3 - <<'PY' > /tmp/upload-manifest.sh
import os, pathlib
snap = open("ops/backup/manifest.json").read()
# write a bash script file that writes manifest via base64
b64 = __import__("base64").b64encode(pathlib.Path("ops/backup/manifest.json").read_bytes()).decode()
snap_id = __import__("json").loads(pathlib.Path("ops/backup/manifest.json").read_text())["snapshotId"]
print(f"""set -euo pipefail
MC_ALIAS='{os.environ.get("MINIO_MC_ALIAS","minio-home")}'
BUCKET='{os.environ.get("MINIO_BUCKET","dokploy")}'
SNAP='{snap_id}'
mkdir -p /tmp/manifest-upload
echo '{b64}' | base64 -d > /tmp/manifest-upload/manifest.json
mc cp /tmp/manifest-upload/manifest.json "$MC_ALIAS/$BUCKET/full-snapshots/$SNAP/manifest.json"
""")
PY
REMOTE_TIMEOUT_MS=600000 node remote-run.mjs run --script-file /tmp/upload-manifest.sh
```

- [ ] **Step 2: Replace prune delete step similarly** using `expired.json` base64 + `mc rm` loop on host (reuse logic from current SSH heredoc).

- [ ] **Step 3: Grep release-prepare for ssh/scp**

Run: `rg -n "ssh|scp|DOCKER_HOST_SSH" .github/workflows/release-prepare.yml`

Expected: no matches

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/release-prepare.yml
git commit -m "feat(ops): release-prepare MinIO steps via Dokploy remote exec"
```

---

### Task 7: README + operator cutover notes

**Files:**
- Modify: `ops/backup/README.md`

- [ ] **Step 1: Update secrets/vars tables**

Remove SSH as required path. Document:

| Variable | Notes |
|----------|-------|
| `DOKPLOY_SCHEDULE_OPS_SYNC` | Disabled server schedule id |
| `DOKPLOY_SCHEDULE_OPS_RUN` | Disabled server schedule id |
| `DOKPLOY_SERVER_ID` | Already required for capture |

Setup:

```bash
cd ops/backup
export DOKPLOY_URL=... DOKPLOY_API_KEY=... DOKPLOY_SERVER_ID=...
node ensure-schedules.mjs
# copy printed vars into GitHub Actions variables
```

Note: delete secret `DOCKER_HOST_SSH_KEY` after merge. Staging refresh requires schedule vars (hard fail, not soft skip).

Update dry-run / restore sections that mention SSH.

- [ ] **Step 2: Commit**

```bash
git add ops/backup/README.md
git commit -m "docs(ops): Dokploy schedule remote exec playbook"
```

- [ ] **Step 3: Operator verification (manual, after merge to branch with secrets)**

1. Run `ensure-schedules.mjs` (local or one-off workflow) → set GH vars  
2. Dispatch staging refresh `dry_run=true`  
3. Confirm green + `[remote-ok]` in Actions log  
4. Optional: live staging refresh

---

## Spec coverage check

| Spec requirement | Task |
|------------------|------|
| All SSH removed from ops workflows | 4–6 |
| Persistent sync + run schedules | 3, 7 |
| Fixed `/etc/dokploy/ops-backup/` | 2–3 |
| CI sync before host ops | 4–6 |
| `[remote-ok]` success contract | 2 |
| Poll deployment logs | 2 |
| Manifest stay on host for restore | 4–5 |
| MinIO upload/prune without SSH | 6 |
| Confirmation gate unchanged | 5 |
| README operator setup | 7 |

## Placeholder / consistency self-review

- No TBD left for implementable behavior; poll timeouts pinned in Global Constraints  
- Method names consistent: `scheduleRunManually`, `deploymentAllByType`, `runScheduleJob`  
- Sync file set includes `manifest.js` because `restore-host.sh` validates/reads via node
