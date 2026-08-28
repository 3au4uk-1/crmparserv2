# Final Important Finding Fix

## Changes

- `runTwentyExport` preserves `pagesFetched` from job progress on completion instead of setting `undefined` (which dropped the key in JSON and showed «Страниц получено: 0»).
- `POST /api/export/twenty` validates in design order: date range (400) → active job (409) → Twenty config (503).
- Added regression test: completed job retains `pagesFetched > 0` after a mocked multi-page fetch.

## Verification

- `npm test --prefix backend -- twenty-export` — 1 file, 28 tests passed
- `npm test --prefix backend` — 71 files, 418 tests passed

## Auto-tasks office wrap (final review)

### Changes

- `findTasksByKindAndLineItem` returns OFFICE_PHOTO/WRAP tasks including DONE and `dueAt`. Office cron skips open tasks and DONE tasks whose `dueAt` calendar day matches `loadDateYmd`; a DONE task on a different day can create again.
- `crmDayStartIso(ymd)` builds `${ymd}T00:00:00${crmOffsetSuffix()}` so office `dueAt` / window bounds are not server-local `new Date(y, m-1, d)`.
- Wrap create sets `dueAt` from `opportunity.loadDate` when present (same helper); omitted when missing.
- If `createTaskTarget` fails after `createTask`, log includes both task and line-item ids. Telegram success/rollback unchanged.

### Verification

- `npx vitest run backend/tests/office-photo-run.test.js backend/tests/create-wrap-task.test.js backend/tests/twenty-tasks.test.js` — 3 files, 20 tests passed
