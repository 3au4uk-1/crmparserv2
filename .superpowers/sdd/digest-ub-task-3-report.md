# Task 3 Report: User-bot NewMessage digest commands

## Status
**Complete** — 9 new tests pass; digest suite 27/27.

## TDD Steps

1. **RED** — Added `telegram-digest-userbot-commands.test.js` (9 cases: thread id resolution, ignore non-command/wrong dest, `/завтра` + `/послезавтра` invoke, error on `ok:false` and throw, init WeakSet smoke).
2. **GREEN** — Implemented `digest-commands.js` with `resolveMessageThreadId`, `handleDigestCommandEvent`, `initDigestCommands`.
3. **WIRE** — `initDigestCommands()` in `index.js` next to `initMentionForwarding()`.
4. **VERIFY** — `npx vitest run tests/telegram-digest-run.test.js tests/telegram-digest-command-match.test.js tests/telegram-digest-commands.test.js tests/telegram-digest-userbot-commands.test.js` → 27 passed.

## Changes

| File | Change |
|------|--------|
| `backend/src/telegram/userbot/digest-commands.js` | New: forum topic thread id, command handler, init with `onUserbotClientReady` + `WeakSet` |
| `backend/tests/telegram-digest-userbot-commands.test.js` | New: handler + init tests with mocked deps |
| `backend/src/index.js` | Call `initDigestCommands()` at startup |

## Topic id resolution

Uses locked GramJS rule: `reply.forumTopic && reply.replyToMsgId` → `Number(replyToMsgId)`; otherwise `null`. Only forum-topic replies carry the Bot-API-equivalent thread root id.

## Commit

```
feat(digest): handle /завтра via user-bot in digest.morning
```

## Test Summary

```
Test Files  4 passed (4)
Tests       27 passed (27)
```

New file: 9 passed (resolveMessageThreadId ×2, handleDigestCommandEvent ×5, initDigestCommands ×1, init smoke ×1).

## Concerns / Follow-ups

- Task 4: wire `test-send` digest path via user-bot; run focused suite per plan.
- Non-forum digest chats (no `forumTopic` reply) get `messageThreadId: null`; matches dest only when `digest.morning` has no `threadId` — expected per `messageMatchesDigestDest`.
- Handler logs and sends error to **dest**, not invoke chat (same as Task 2 dest-only `runDigestForDay`).
