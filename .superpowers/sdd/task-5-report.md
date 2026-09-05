# Task 5 Report: Twenty create/update client and file helpers

**Date:** 2026-09-05  
**Branch:** `feat/telegram-bot-work-requests`  
**Commit:** `3af3d5e` — feat: create telegramRequest records and classify oversized files

## Status: DONE

## Summary

Parser-side Twenty GraphQL helpers and Telegram file pipeline for work requests:

- `twenty.js`: `telegramMessageUrl`, `createTelegramRequest` (returns id string), `updateTelegramRequest` using `assertHttpSuccess` + `assertGqlSuccess`.
- `files.js`: `MAX_FILE_BYTES` (20 MiB), `classifyTelegramFile`, `downloadTelegramFile` (getFile → bot file URL), `uploadRequestFile` wrapper, and `uploadFilesFieldFileForWorkRequest` with multipart upload logic copied from `twenty-tasks.js` (not importing non-exported binding).

## TDD Evidence

### RED

```
Error: Cannot find module '../src/telegram/work-requests/twenty.js'
Error: Cannot find module '../src/telegram/work-requests/files.js'
 Test Files  2 failed (2)
```

### GREEN

```
Test Files  2 passed (2)
     Tests  7 passed (7)
```

Command: `cd backend && npm test -- tests/telegram-work-request-twenty.test.js tests/telegram-work-request-files.test.js`

## Files Created

| File | Purpose |
|------|---------|
| `backend/src/telegram/work-requests/twenty.js` | GQL create/update + t.me URL builder |
| `backend/src/telegram/work-requests/files.js` | Size classify, Telegram download, Twenty upload |
| `backend/tests/telegram-work-request-twenty.test.js` | 3 tests: URL, create, update |
| `backend/tests/telegram-work-request-files.test.js` | 4 tests: MAX, classify, download, upload wrapper |

## Concerns

- `createTelegramRequest` / `updateTelegramRequest` mutations not live until BrandingTwentyView Task 4 is applied; tests mock `gql`.
- `uploadFilesFieldFileForWorkRequest` duplicates multipart logic from `twenty-tasks.js`; consider exporting shared helper later to avoid drift.
- `classifyTelegramFile` ignores `mime` today; only size threshold is specified.

## Review Fix (2026-09-05)

**Issue:** `createTelegramRequest` / `updateTelegramRequest` could return `undefined` when GraphQL had no errors but omitted `id`.

**Fix:** Added `assertRecordId` — throws `Error: <context>: Twenty response missing record id` after `assertGqlSuccess`. Two new unit tests mock successful responses without `id` and expect rejection.

**Tests after fix:**

```
Test Files  2 passed (2)
     Tests  9 passed (9)
```

Command: `cd backend && npm test -- tests/telegram-work-request-twenty.test.js tests/telegram-work-request-files.test.js`

**Commit:** `077394e` — fix: reject Twenty create/update responses missing record id
