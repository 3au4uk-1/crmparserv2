Plan: prod-backup-staging-sync
Spec: docs/superpowers/specs/2026-07-29-prod-backup-staging-sync-design.md
Plan file: docs/superpowers/plans/2026-07-29-prod-backup-staging-sync.md
Branch: staging
Base before Task 1: ea0b471


Task 1: complete (ea0b471..7d80d82, review clean; minors: parseSnapshotTime coverage, unused re-export)

Task 2: complete (7d80d82..7c02ca4, review clean; PG keep=7 still manual UI; volumeBackupIds oGxdDhtMUOUUL2GOhJrnz / hjNHo-tuuwf_7UtDHQkOn)

Task 3: complete (7c02ca4..971ada2, review clean after fail-fast/mtime fixes)

Task 4: complete (971ada2..14e94ae, review clean; minor: stale TODO comment in workflow)

Task 4: complete (971ada2..14e94ae, review clean; minor: stale TODO comment in workflow)

Task 5: complete (14e94ae..b75b09e, review clean after sql.gz/manifest/SSH fixes; host drills deferred)

Task 6: complete (b75b09e..a285651 + BrandingTwentyView d1ca409, review clean after digest/manifest fixes)

Task 7: complete (a285651..490b62e, playbook finalized; drills deferred to operator)

Final review fixes: restore workflows now SCP ops/backup/lib/ alongside restore-host.sh (pg-restore-format.sh + manifest.js on host); release-prepare adds optional twenty_app_git_sha → TWENTY_APP_GIT_SHA; removed stale mc-deletion TODO.
