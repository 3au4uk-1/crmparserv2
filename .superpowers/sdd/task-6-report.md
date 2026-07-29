# Task 6 Report: Rewrite `release-prepare.yml` MinIO optional steps

**Date:** 2026-07-29  
**Branch:** `staging`  
**Status:** DONE

## Commit

| Commit | Message |
|--------|---------|
| `d07d793` | feat(ops): release-prepare MinIO steps via Dokploy remote exec |

## Summary

Replaced SSH/SCP MinIO upload and prune-delete steps in `release-prepare.yml` with Dokploy `remote-run.mjs sync|run`. Capture step unchanged (Dokploy API on runner). Optional MinIO steps soft-skip when `DOKPLOY_SCHEDULE_OPS_SYNC` or `DOKPLOY_SCHEDULE_OPS_RUN` is unset — same spirit as the old missing-SSH-key behavior.

## Changes

| Step | Before | After |
|------|--------|-------|
| Upload manifest to MinIO | SCP manifest + SSH `mc cp` | `remote-run.mjs sync` → Python-generated script with base64 manifest → `remote-run.mjs run --script-file` |
| Delete expired objects | SCP expired.json + SSH heredoc `mc rm` loop | Python-generated script with base64 expired.json → `remote-run.mjs run --script-file` |

Removed: `DOCKER_HOST_SSH_KEY`, `DOCKER_HOST`, `DOCKER_HOST_USER`, all `ssh`/`scp`/`ssh-keyscan`.

## Required secrets / vars (MinIO optional steps)

| Name | Type | Purpose |
|------|------|---------|
| `DOKPLOY_URL` | Secret | Dokploy API (already used by capture/prune) |
| `DOKPLOY_API_KEY` | Secret | Dokploy API |
| `DOKPLOY_SCHEDULE_OPS_SYNC` | Variable | Schedule ID for ops tree sync (optional — skip if missing) |
| `DOKPLOY_SCHEDULE_OPS_RUN` | Variable | Schedule ID for remote bash (optional — skip if missing) |
| `MINIO_MC_ALIAS` | Variable | Default `minio-home` |
| `MINIO_BUCKET` | Variable | Default `dokploy` |

## Verification

```bash
rg -n "ssh|scp|DOCKER_HOST_SSH" .github/workflows/release-prepare.yml
# Expected: no matches (exit 1)
```

## Acceptance checklist

- [x] Capture remains Dokploy API on runner (unchanged)
- [x] MinIO upload via `remote-run.mjs sync` + base64 embed + `run --script-file`
- [x] Prune delete via base64 embed + remote `mc rm` loop
- [x] Soft-skip when schedule vars missing (`continue-on-error: true`)
- [x] SSH/SCP/DOCKER_HOST_SSH removed
- [x] Grep clean
- [x] Committed per brief
- [ ] Operator nightly/scheduled release-prepare run with schedule vars set

## Concerns / follow-ups

- Upload timeout: `REMOTE_TIMEOUT_MS=600000` (10 min) — manifest is small; should be ample.
- Prune delete does not re-sync ops tree (only `run`); acceptable since step uses `mc` only, not synced bash libs.
- Large `expired.json` could inflate generated script size; unlikely at current retention policy.

## Post-review fix (final branch review)

- Delete-expired Python-generated bash used `${{PREFIXES}}` etc.; GHA emptied at parse time. Fixed with `$${PREFIXES}` in workflow YAML (same pattern as upload-manifest step).
