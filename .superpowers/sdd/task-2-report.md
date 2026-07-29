# Task 2 Report: schedule-remote helpers (wrap, sync, poll, parse)

**Date:** 2026-07-29  
**Branch:** `staging`  
**Commit:** `9e167d2` — feat(ops): schedule-remote wrap sync and poll helpers

## Summary

Created `ops/backup/lib/schedule-remote.js` with remote script wrapping, host sync script builder, log/deployment parsers, and `runScheduleJob` poll loop. Added 8 vitest cases in `ops/backup/tests/schedule-remote.test.js`. TDD followed: RED (module not found) → GREEN (8/8 pass). Full suite 45/45 pass. No workflow or CLI changes.

## TDD Evidence

### RED (Step 2)

Command: `cd ops/backup && npm test -- tests/schedule-remote.test.js`

```
Error: Cannot find module '../lib/schedule-remote.js'
 Test Files  1 failed (1)
      Tests  no tests
```

Expected: module missing. Confirmed.

### GREEN (Step 4)

After implementing `ops/backup/lib/schedule-remote.js`:

```
 Test Files  1 passed (1)
      Tests  8 passed (8)
```

Full suite: `npm test` → 7 files, 45 tests passed.

## Files Created

| File | Change |
|------|--------|
| `ops/backup/lib/schedule-remote.js` | Exports constants + 8 helpers including `runScheduleJob` |
| `ops/backup/tests/schedule-remote.test.js` | 8 unit/integration tests per brief |

## Exported API

| Export | Purpose |
|--------|---------|
| `HOST_OPS_ROOT` | `/etc/dokploy/ops-backup` |
| `REMOTE_OK_MARKER` | `[remote-ok]` success marker |
| `wrapRemoteScript(body)` | `set -euo pipefail` + body + marker echo |
| `buildSyncScript(files, hostRoot?)` | mkdir, heredoc writes, chmod `.sh`, ls, wrapped |
| `parseRemoteOk(logs)` | Line-exact marker detection |
| `parseMarkerValue(logs, key)` | Multiline `KEY=value` regex |
| `normalizeDeployments(data)` | Array or `{ deployments }` → normalized list |
| `pickNewestDeployment(list)` | Sort by `createdAt` desc |
| `isTerminalStatus(status)` | `done` or `error` |
| `runScheduleJob(opts)` | update → run → poll → readLogs → validate |

## Self-Review

### Correctness
- `wrapRemoteScript` matches test expectations: leading `set -euo pipefail\n`, trailing `echo '[remote-ok]'`.
- `buildSyncScript` uses quoted `'EOF'` heredocs (no escaping); rejects content with a line exactly `EOF`.
- `runScheduleJob` calls `scheduleUpdate` with `{ scheduleId, script, command: command ?? 'bash', shellType: 'bash' }`, then `scheduleRunManually`, polls `deploymentAllByType(id, 'schedule')`, picks deployment with `createdAt >= startedAt - 2000ms` (fallback: newest overall), reads logs (string or `{ logs }`), throws if status !== `done` or missing remote-ok marker.
- Error messages include log tail (last 20 lines) and mention `remote-ok` for testability.

### Test coverage
- Covers wrap, sync heredocs, parse helpers, deployment normalization/sorting, happy-path poll loop, and done-without-marker failure.
- `runScheduleJob` tests use mocked client with `pollIntervalMs: 1` for fast execution.

### Scope
- Only the two files specified. Consumes Task 1 Dokploy client methods; no changes to `dokploy-client.js`.

### Risks / notes for later tasks
- `buildSyncScript` EOF guard not unit-tested (brief only specifies throw behavior); consider adding a test in Task 3+ if sync is exercised end-to-end.
- Live Dokploy deployment timing (createdAt skew > 2s) not validated; threshold may need tuning against real API.
- Timeout path in `runScheduleJob` not explicitly tested.

## Commit

```
9e167d2 feat(ops): schedule-remote wrap sync and poll helpers
```

## Review Fixes (2026-07-29)

Addressed Critical/Important findings from Task 2 review.

### Changes
- `runScheduleJob` default `pollIntervalMs`: 2000 → **5000** (global constraint).
- `pickRunDeployment`: no longer falls back to stale terminal deployments older than `startedAt - 2000ms`; returns `null` to keep polling until a matching or in-flight deployment appears.
- Tests added: `buildSyncScript` rejects content with a line exactly `EOF`; `runScheduleJob` throws on `error` status even when logs contain `[remote-ok]`.

### Test output

```
npm test -- tests/schedule-remote.test.js
 Test Files  1 passed (1)
      Tests  10 passed (10)

npm test (full suite)
 Test Files  7 passed (7)
      Tests  47 passed (47)
```

### Commit

```
fix(ops): schedule-remote poll default and test gaps
```
