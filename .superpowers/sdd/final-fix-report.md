# Final Important Finding Fix

## Changes

- `runTwentyExport` preserves `pagesFetched` from job progress on completion instead of setting `undefined` (which dropped the key in JSON and showed «Страниц получено: 0»).
- `POST /api/export/twenty` validates in design order: date range (400) → active job (409) → Twenty config (503).
- Added regression test: completed job retains `pagesFetched > 0` after a mocked multi-page fetch.

## Verification

- `npm test --prefix backend -- twenty-export` — 1 file, 28 tests passed
- `npm test --prefix backend` — 71 files, 418 tests passed
