# Task 7 Report: README + operator cutover notes (Dokploy schedule remote exec)

**Date:** 2026-07-29  
**Branch:** `staging`  
**Status:** DONE (operator verification deferred)

## Commit

| Commit | Message |
|--------|---------|
| `832cf31` | `docs(ops): Dokploy schedule remote exec playbook` |

## Summary

Updated `ops/backup/README.md` for the SSH → Dokploy schedule cutover: documented `DOKPLOY_SCHEDULE_OPS_SYNC` / `DOKPLOY_SCHEDULE_OPS_RUN`, `ensure-schedules.mjs` one-time setup, hard vs soft schedule-var requirements, `[remote-ok]` success contract, and `DOCKER_HOST_SSH_KEY` deletion after cutover.

## Changes

| Section | Update |
|---------|--------|
| Variables table | Added schedule vars + `DOKPLOY_SERVER_ID`; removed `DOCKER_HOST*` |
| Secrets table | Removed `DOCKER_HOST_SSH_KEY` |
| Dokploy schedule setup | New subsection with `ensure-schedules.mjs` commands |
| Configuration checklist | Schedule vars, ensure-schedules step, cutover delete SSH secret |
| Verification checklist | Schedule dry-run + `[remote-ok]` operator follow-up |
| release-prepare | MinIO upload/prune tied to schedule vars (soft skip) |
| staging-refresh-data | Dokploy dry-run; hard require schedule vars |
| rollback-data / rollback-release | Require schedule vars; `[remote-ok]` in logs |
| Disaster notes | MinIO/schedule/host (no SSH) |
| Technical reference | `remote-run.mjs` / `ensure-schedules.mjs`; host path `/etc/dokploy/ops-backup/` |

## Operator verification (manual, post-merge)

1. Run `ensure-schedules.mjs` → set GH vars  
2. Dispatch staging refresh `dry_run=true`  
3. Confirm green + `[remote-ok]` in Actions log  
4. Delete `DOCKER_HOST_SSH_KEY` secret  
5. Optional: live staging refresh

## Acceptance checklist

- [x] SSH removed as required path from README
- [x] Schedule vars + ensure-schedules documented
- [x] Cutover note to delete `DOCKER_HOST_SSH_KEY`
- [x] Staging refresh hard-require documented
- [x] Dry-run / restore / rollback sections updated
- [x] Committed per brief
- [ ] Operator drills (steps above)

## Concerns

- Schedule var IDs are environment-specific — README uses *(from ensure-schedules.mjs)* placeholders, not hardcoded ids.
- `release-prepare` still soft-skips MinIO steps without schedule vars; operators should set vars before relying on MinIO manifest path for rollback snapshot resolution.

## Post-review fix (final branch review)

- Added `DOKPLOY_SERVER_ID` to Required GitHub configuration checklist (was in vars table only).
