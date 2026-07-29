Plan: dokploy-remote-exec-restore
Spec: docs/superpowers/specs/2026-07-29-dokploy-remote-exec-restore-design.md
Plan file: docs/superpowers/plans/2026-07-29-dokploy-remote-exec-restore.md
Branch: staging
Base before Task 1: 55df739
Model: composer-2.5-fast


Task 1: complete (55df739..2a04dce, review clean; minors: path-only tests, default tail untested)

Task 2: complete (2a04dce..b58e2e0, review clean after poll/EOF/stale fixes)

Task 3: complete (b58e2e0..c974f3d, review clean; minor: trim env)

Task 4: complete (c974f3d..77cb0d3, review clean)

Task 5: complete (77cb0d3..ae0a623, review clean after MinIO manifest fetch fix)

Task 6: complete (ae0a623..d07d793, review clean)

Task 7: complete (d07d793..832cf31, review clean; minor: SERVER_ID checklist)

Final whole-branch review fixes:
- release-prepare delete-expired: `$${PREFIXES}`/`$${prefix}`/`$${MC_ALIAS}`/`$${BUCKET}` in YAML so GHA emits bash `${…}` (was empty `${{…}}` at parse time)
- rollback-release manifest fetch: host prints `MANIFEST_B64=…`; runner parses `grep '^MANIFEST_B64=' | tail -n1 | cut -d= -f2-`
- remote-run.mjs requireEnv `.trim()`; README checklist adds DOKPLOY_SERVER_ID
- Verification: rg workflows no ssh/scp/DOCKER_HOST_SSH; npm test 47/47 pass

