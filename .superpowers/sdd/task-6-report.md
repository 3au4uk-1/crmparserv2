# Task 6 Report: Inbound mention/album accept-or-refuse

**Date:** 2026-09-05
**Branch:** `feat/telegram-bot-work-requests`
**Commit:** `bdf5b45` — feat: accept or refuse work-request mentions in configured topics

## Status: DONE

Implemented exact bot-mention detection, one-second album collection, refusal/acceptance replies, safe file upload fallbacks, opportunity matching, Twenty creation, SQLite linkage, duplicate suppression, create-failure cleanup, and cached `getMe` username lookup.

Bot API discovery now awaits `telegram.inbound` hooks, polling awaits each update, the default work-request hook is registered, and `edited_message` remains excluded.

## TDD Evidence

RED:

```text
Cannot find module '../src/telegram/work-requests/album.js'
Cannot find module '../src/telegram/work-requests/handle-inbound.js'
expected [ 'accepted', undefined ] to deeply equal [ 'accepted', 'duplicate' ]
expected telegram.inbound hook call; received 0 calls
```

GREEN — requested command:

```text
Test Files  3 passed (3)
Tests       12 passed (12)
```

Command: `cd backend && npm test -- tests/telegram-work-request-inbound.test.js tests/telegram-work-request-mention.test.js tests/telegram-polling.test.js`

Relevant regression suite:

```text
Test Files  10 passed (10)
Tests       74 passed (74)
```

Command: `cd backend && npm test -- telegram-work-request tests/telegram-inbound.test.js tests/telegram-bot-admin.test.js`

## Concerns

- Live file upload depends on the applied BrandingTwentyView `requestFiles` field retaining universal identifier `2f089d5d-b69c-4b5d-aaaa-ba10d58e7337`.
- Album handling intentionally waits 1000 ms; non-album messages process immediately.
- Unrelated productStream/migrate suites were not run or changed, per task scope.

## Reviewer fixes

Fixed all three Important findings:

1. `pollOnce` starts all updates in a Bot API batch concurrently, so album siblings enter the collector before its 1000 ms window closes.
2. `insertWorkRequestLink` returns `created`; SQLite uniqueness conflicts resolve to the existing row with `created: false`, and only the creator may call Twenty.
3. Album messages are ordered by `message_id`; the lowest message supplies form text while any album item may carry the required mention.

TDD RED evidence:

```text
polling album: expected uploadRequestFile 2 times, received 1
album form: expected accepted/duplicate, received refused/refused
duplicate race: expected accepted/duplicate, received accepted/accepted
store ownership: expected created true, received undefined
```

GREEN:

```text
Test Files  4 passed (4)
Tests       18 passed (18)
```

Command: `cd backend && npm test -- tests/telegram-work-request-inbound.test.js tests/telegram-work-request-mention.test.js tests/telegram-polling.test.js tests/telegram-work-request-store.test.js`
