# Task 5 Report: Auto-invite webhook trigger + HTTP API + frontend hooks

**Date:** 2026-07-30  
**Branch:** `staging`  
**Commit:** `c8efd14` — feat(telegram): auto-invite webhook trigger and API

## Summary

Wired `scheduleAutoInvite` on `my_chat_member` join for group/supergroup chats (non-blocking via existing `setImmediate`), added REST CRUD + status + retry routes under `/api/telegram/auto-invite/*`, and added React Query hooks in `frontend/src/api.js`. TDD: 14 new tests RED → implement → GREEN.

## TDD Evidence

### RED (Step 1)

Command: `cd backend && npm test -- tests/telegram-auto-invite-routes.test.js`

```
Tests  9 failed | 5 passed (14)
- inbound schedule not wired (404 on routes)
```

### GREEN (Step 3)

Command: `cd backend && npm test -- tests/telegram-auto-invite-routes.test.js tests/telegram-inbound.test.js`

```
 Test Files  2 passed (2)
      Tests  20 passed (20)
```

Command: `cd backend && npm test -- telegram`

```
 Test Files  13 passed (13)
      Tests  81 passed (81)
```

## Files Changed

| File | Change |
|------|--------|
| `backend/src/telegram/inbound.js` | `processTelegramUpdate` accepts optional `{ scheduleAutoInvite }`; schedules on group/supergroup join |
| `backend/src/routes/telegram.js` | auto-invite status, members CRUD, retry run |
| `backend/tests/telegram-auto-invite-routes.test.js` | 14 tests (inbound trigger + HTTP routes) |
| `frontend/src/api.js` | 6 React Query hooks |

## API Endpoints

| Method | Path | Notes |
|--------|------|-------|
| GET | `/api/telegram/auto-invite/status` | `{ configured: boolean }` only — no session/api_hash |
| GET | `/api/telegram/auto-invite/members` | `{ members: [...] }` camelCase, includes inactive |
| POST | `/api/telegram/auto-invite/members` | `{ username?, userId?, displayName? }` → 201 `{ member }` |
| PATCH | `/api/telegram/auto-invite/members/:id` | partial patch → `{ member }` |
| DELETE | `/api/telegram/auto-invite/members/:id` | `{ ok: true }` |
| POST | `/api/telegram/auto-invite/runs/:chatId/retry` | `runAutoInviteForChat(..., { force: true })` |

## Inbound Trigger Rules

- Event: `my_chat_member` after `upsertTelegramChat`
- Schedule when: `new_chat_member.status` ∈ `{ member, administrator, creator }` AND `chat.type` ∈ `{ group, supergroup }`
- Skip: `private`, `channel`, left/kicked statuses, regular messages
- Non-blocking: uses existing `scheduleAutoInvite` → `setImmediate` + `unref`

## Frontend Hooks

| Hook | Type |
|------|------|
| `useTelegramAutoInviteStatus` | query |
| `useTelegramAutoInviteMembers` | query |
| `useAddTelegramAutoInviteMember` | mutation |
| `useUpdateTelegramAutoInviteMember` | mutation |
| `useDeleteTelegramAutoInviteMember` | mutation |
| `useRetryTelegramAutoInviteRun` | mutation |

## Self-Review

### Correctness
- Webhook response not blocked — schedule is fire-and-forget via `setImmediate`.
- Status endpoint exposes only `configured` boolean from `isUserbotConfigured()`.
- Member routes delegate to store layer; validation errors → 400, missing → 404.
- Retry route awaits orchestration result (admin action, acceptable latency).

### Test coverage
- Inbound: supergroup join, admin/creator, private/channel skip, left skip, message skip.
- Routes: status shape, members list camelCase, CRUD, retry with force mock.

### Scope
- No UI page changes (Task 6). Hooks only in `api.js`.

## Status

**DONE**

## Tests one-liner

`npm test -- telegram` → **81/81 pass**

## Concerns

1. **Retry route is synchronous** — long-running userbot work blocks HTTP until complete; acceptable for admin retry but may need async job pattern if timeouts appear in prod.
2. **GET members lists inactive** — UI may want filter toggle; store supports `activeOnly` if needed later.
3. **No run history endpoint** — retry returns orchestration result but no GET for past runs; Task 6 UI may need run status per chat.
