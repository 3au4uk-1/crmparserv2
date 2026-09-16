# Task 8 Report: Telegram work-request slots UI

**Date:** 2026-09-05
**Branch:** `feat/telegram-bot-work-requests`
**Commit:** `2337bc5` — feat: configure nine work-request topic slots on Telegram page

## Status: DONE

Added authenticated `GET`/`PUT /api/telegram/work-request-slots` routes backed by
`getWorkRequestSlots` and `setWorkRequestSlots`.

Added React Query hooks and a Telegram page section directly after mention forwarding.
The section renders nine rows with chat, forum topic, company label, and
`QUOTE`/`DESIGN`/`REVIEW` role controls. Rows without a `chatId` are removed from the
payload before saving.

## TDD Evidence

RED:

```text
Test Files  1 failed (1)
Tests       2 failed | 1 passed (3)
Expected 200/400, received 404 because the routes did not exist.
```

GREEN — requested command:

```text
Test Files  1 passed (1)
Tests       3 passed (3)
```

Command: `cd backend && npm test -- tests/telegram-work-request-slots-route.test.js`

Frontend verification:

```text
vite v7.3.5
162 modules transformed
✓ built in 1.99s
```

Command: `cd frontend && npm run build`

Scoped formatting check:

```text
git diff --check -- backend/src/routes/telegram.js backend/tests/telegram-work-request-slots-route.test.js frontend/src/api.js frontend/src/pages/Telegram.jsx
Exit code: 0
```

## Concerns

- `npm ci` reports eight vulnerabilities in the existing frontend dependency lock
  (one low, one moderate, six high); no dependencies or lockfiles were changed.
- Repository-wide `git diff --check` still reports pre-existing trailing whitespace in
  `.superpowers/sdd/task-2-report.md`; Task 8 files are clean.

## Review fixes

- `setWorkRequestSlots` now drops empty or whitespace-only `chatId` rows before
  validating the remaining rows. The route regression test verifies both PUT and GET
  return only the valid slot.
- Work-request rows now trigger the same inactive-chat lookup used by digest
  destinations. A saved inactive forum chat is included with the inactive label,
  remains resolvable as a forum, and continues loading its topic options.

TDD RED:

```text
Test Files  1 failed (1)
Tests       1 failed | 3 passed (4)
Expected 200, received 400 for an empty chatId row.
```

GREEN — requested command:

```text
Test Files  2 passed (2)
Tests       7 passed (7)
```

Command: `cd backend && npm test -- tests/telegram-work-request-slots-route.test.js tests/telegram-work-request-store.test.js`

Frontend verification:

```text
vite v7.3.5
162 modules transformed
✓ built in 1.94s
```
