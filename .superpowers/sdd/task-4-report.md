# Task 4 Report: Auto-invite orchestration

**Date:** 2026-07-30  
**Branch:** `staging`  
**Commit:** `13a35d7` — feat(telegram): auto-invite orchestration

## Summary

Added `runAutoInviteForChat` and `scheduleAutoInvite` in `auto-invite.js`, wiring store idempotency, Bot API invite/promote, and GramJS userbot actions behind injectable deps. Ten vitest cases cover happy path, privacy partial failure, skip on prior success, force retry, configuration/token failures, setup hard-fail, and non-blocking scheduling. TDD: tests written first → all green.

## TDD Evidence

### RED (Step 1)

Command: `cd backend && npm test -- tests/telegram-auto-invite.test.js` (before `auto-invite.js`)

```
Error: Cannot find module '../src/telegram/auto-invite.js'
 Test Files  1 failed (1)
      Tests  no tests
```

### GREEN (Step 3)

Command: `cd backend && npm test -- tests/telegram-auto-invite.test.js`

```
 Test Files  1 passed (1)
      Tests  10 passed (10)
```

## Files Changed

| File | Change |
|------|--------|
| `backend/src/telegram/auto-invite.js` | `runAutoInviteForChat`, `scheduleAutoInvite`, default deps wiring |
| `backend/tests/telegram-auto-invite.test.js` | 10 orchestration tests with mocked deps |

## New API Surface

| Export | Signature | Behavior |
|--------|-----------|----------|
| `runAutoInviteForChat` | `(db, chatId, { force?, deps? }) → { status, detail, skipped? }` | Full pipeline: idempotency → userbot/token checks → invite link → join → promote → per-member resolve/invite → aggregate status |
| `scheduleAutoInvite` | `(db, chatId, options?) → void` | `setImmediate(() => runAutoInviteForChat(...)).unref?.()`; logs unexpected rejections |

### Injectable deps (defaults in production)

| Dep | Default |
|-----|---------|
| `getToken` | `getTelegramBotToken` |
| `createInviteLink` | `createChatInviteLink` |
| `promote` | `promoteChatMemberForInvite` |
| `getClient` | `getUserbotClient` |
| `joinInvite` | `joinChatByInviteLink` |
| `resolveUser` | `resolveUser` |
| `inviteUser` | `inviteUserToChat` |
| `getSelfUserId` | `getSelfUserId` |
| `listMembers` | `listAutoInviteMembers(db, { activeOnly: true })` |
| `isConfigured` | `isUserbotConfigured` |
| `updateMember` | `updateAutoInviteMember` |

### Flow / status rules

1. `force` → `resetAutoInviteRun`
2. `tryBeginAutoInviteRun` — if blocked, return `{ skipped: true, status, detail }` from existing run
3. Missing userbot or bot token → `failed` with `{ error: '...' }`
4. Setup (invite link, join, self id, promote) failure → `failed` before member loop
5. Per-member invite errors caught → `{ status: 'failed', error }` in `detail.members`
6. Aggregate: any member fail → `partial`; else `success`
7. Always `finishAutoInviteRun` when a run was started

## Self-Review

### Correctness
- Idempotency delegated to store; skip path does not mutate run row.
- Resolved `user_id` persisted via `updateMember` when `member.id` and resolved id exist.
- `scheduleAutoInvite` passes optional `options` through to `runAutoInviteForChat` (enables deps injection in tests without changing webhook call sites).

### Test coverage
- Happy path (2 members, success)
- Username-only member gets persisted `user_id`
- Privacy-style partial (one invite throws)
- Skip when prior success
- Force retry after success
- Userbot not configured / missing token
- Setup throw before invites
- Schedule: real async `setImmediate` + `unref`; error logging on thrown db failure

### Scope
- Only the two files specified. No inbound webhook or HTTP routes (Task 5).

## Status

**DONE**

## Tests one-liner

`npm test -- tests/telegram-auto-invite.test.js` → **11/11 pass**

## Concerns

1. **No FLOOD_WAIT backoff** — design notes defer retry to orchestration; current loop fails fast per member. Task 5+ may need delay/retry.
2. ~~**No “already participant” skip**~~ — **Fixed 2026-07-30:** invite throws matching already-participant patterns → `{ status: 'skipped', reason: 'already_participant' }`; aggregate stays `success`.
3. **Empty member list** — returns `success` with `{ members: [] }`; acceptable for v1 but ops may want explicit “no members configured” warning.
4. **`scheduleAutoInvite` options param** — brief shows `(db, chatId)` only; third `options` arg is a testability pass-through, not used by production callers yet.

## Review Fix: Already-Participant Skip (2026-07-30)

**Finding:** Important — `inviteUser` throws for existing participants were recorded as `failed`, causing `partial` aggregate status.

**Fix commit:** `fix(telegram): treat already-participant invite as skipped`

### Changes
- Added `isAlreadyParticipantError(err)` — case-insensitive match on error message for `USER_ALREADY_PARTICIPANT`, `USER_ALREADY_INVITED`, `ALREADY_PARTICIPANT`, `ALREADY_IN_CHAT`.
- Per-member catch: already-participant → `{ status: 'skipped', reason: 'already_participant' }` instead of `failed`.
- Aggregate unchanged: only `status === 'failed'` triggers `partial`; skipped counts as success path.

### Test evidence

Command: `cd backend && npm test -- tests/telegram-auto-invite.test.js`

```
 Test Files  1 passed (1)
      Tests  11 passed (11)
```

New test: `skips already-participant invite errors and finishes success` — mocks `inviteUser` throwing `Error('USER_ALREADY_PARTICIPANT')`, asserts member `skipped` + run `success`.
