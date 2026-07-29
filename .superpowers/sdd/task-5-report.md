# Task 5 Report: Rewrite prod rollback workflows for Dokploy remote exec

**Date:** 2026-07-29  
**Branch:** `staging`  
**Status:** DONE

## Commit

| Commit | Message |
|--------|---------|
| `413d865` | feat(ops): prod rollback workflows via Dokploy remote exec |

## Summary

Replaced SSH/SCP restore paths in `rollback-data.yml` and `rollback-release.yml` with the Task 4 pattern: Dokploy schedule preflight → `remote-run.mjs sync` → remote `mc cp` + host-side `assertManifest` + `restore-host.sh --target prod`. Kept `confirm=RESTORE_PROD` gate. Release rollback retains pin/dispatch steps (no SSH).

## Changes

| Workflow | Before | After |
|----------|--------|-------|
| `rollback-data.yml` | SSH fetch manifest → runner validate → SCP restore bundle | Sync → single remote restore (mc cp, host assertManifest, restore-host) |
| `rollback-release.yml` | Same SSH fetch/validate/restore | Same remote restore; post-restore base64 fetch of manifest for pin + dispatch outputs |

Removed from both: `DOCKER_HOST_SSH_KEY`, `DOCKER_HOST`, `DOCKER_HOST_USER`, all `ssh`/`scp`/`ssh-keyscan`.

## Required secrets / vars

| Name | Type | Purpose |
|------|------|---------|
| `DOKPLOY_URL` | Secret | Dokploy API base URL |
| `DOKPLOY_API_KEY` | Secret | Dokploy API key |
| `DOKPLOY_SCHEDULE_OPS_SYNC` | Variable | Schedule ID for ops tree sync |
| `DOKPLOY_SCHEDULE_OPS_RUN` | Variable | Schedule ID for remote bash |
| `MINIO_MC_ALIAS` | Variable | Default `minio-home` |
| `MINIO_BUCKET` | Variable | Default `dokploy` |
| `DOKPLOY_CRMPARSER_COMPOSE_ID` | Variable | Release rollback image pin (unchanged) |
| `BRANDING_TWENTYVIEW_DISPATCH_TOKEN` | Secret | Twenty app rollback dispatch (unchanged) |

## Verification

```bash
rg -n "ssh|scp|DOCKER_HOST_SSH" .github/workflows/rollback-data.yml .github/workflows/rollback-release.yml
# Expected: no matches (exit 1)
```

## Acceptance checklist

- [x] SSH/SCP removed; Dokploy `remote-run.mjs sync|run` wired
- [x] `RESTORE_PROD` confirmation gate preserved
- [x] Host-side `assertManifest` via synced `lib/manifest.js`
- [x] Release pin + BrandingTwentyView dispatch unchanged (non-SSH)
- [x] Grep clean for ssh/scp/DOCKER_HOST_SSH
- [x] Committed per brief
- [ ] Operator prod data rollback drill
- [ ] Operator prod release rollback drill

## Concerns / follow-ups

- ~~Release rollback fetches manifest via remote `base64 -w0`; log noise may require `tail -n1` tuning on first live run.~~ **Fixed:** post-restore manifest fetch now uses `mc cat …/manifest.json | base64 -w0` (workdir is deleted by `restore-host.sh`).
- Restore timeout: `REMOTE_TIMEOUT_MS=2700000` (45 min) on prod restore step.
- Host `node` required for assertManifest (same as staging refresh).
- README still documents SSH-based prod rollback — update in docs pass (Task 7).

---

## Fix: post-restore manifest fetch (review finding)

**Date:** 2026-07-29  
**Commit:** `fix(ops): fetch release-rollback manifest from MinIO after restore`

### Problem

`restore-host.sh` removes `--workdir` on success. The release-rollback workflow’s “Fetch manifest for release pin” step still read `$WORKDIR/manifest.json`, so pin/dispatch failed after a successful restore.

### Change

In `rollback-release.yml`, fetch step now runs on the host:

```bash
mc cat "${MC_ALIAS}/${BUCKET}/full-snapshots/${SNAP}/manifest.json" | base64 -w0
```

Runner-side `assertManifest`, snapshotId check, and `GITHUB_OUTPUT` for pin/dispatch unchanged.

### Verification

```bash
rg -n "ssh|scp|DOCKER_HOST_SSH" .github/workflows/rollback-data.yml .github/workflows/rollback-release.yml
# no matches

rg -n "base64 -w0.*WORKDIR" .github/workflows/rollback-release.yml
# no matches (fetch no longer reads deleted workdir)

rg -n "mc cat.*manifest" .github/workflows/rollback-release.yml
# 127: mc cat .../manifest.json | base64 -w0
```
