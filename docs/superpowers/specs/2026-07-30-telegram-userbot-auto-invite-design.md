# Telegram user-bot: auto-invite branding team into order chats

**Date:** 2026-07-30  
**Repo:** `crmparserv2`  
**Branch:** `staging`  
**Status:** approved  

## Problem

Logistics creates **separate Telegram groups per order** and must manually add branding team members. With dozens of orders this is error-prone — branding may be missing from a chat.

Desired ops model: logistics adds **only the branding bot** to the order chat; the system ensures a configured list of people (and a persistent user account) end up in that chat.

## Goals

- When the Bot API bot is added to a group/supergroup, automatically:
  1. Join a dedicated **user account** (MTProto user-bot) into that chat.
  2. Invite a configured **auto-invite list** of people into that chat.
  3. Leave the user-bot **in the chat** for future features.
- Manage the invite list on crmparser `/telegram` (same people ~90% of the time; editable without redeploy).
- Store identifiers as **username and/or numeric user_id**; resolve username → id and persist id when possible.
- Run on **staging first**; secrets never in git.

## Non-goals (v1)

- Bot API “add user by id” (impossible).
- Auto-creating order groups.
- Topic catalog / forum discovery via MTProto (separate concern).
- BrandingTwentyView changes.
- Production rollout without staging soak.
- QR/login UI inside the product beyond a documented ops procedure (v1 may use a one-shot CLI/script to produce `TELEGRAM_USER_SESSION`).

## Constraints

- Bot API cannot invite users by `user_id`. Invite-by-link + MTProto invite is required.
- Private groups often allow **only admins** to invite → after the user-bot joins as a member, the **bot must promote** it with `can_invite_users` (bot needs **Add New Admins** in default admin rights / per-chat).
- Users with Telegram privacy “Who can add me to groups” = Nobody (or restrictive) **cannot** be force-invited; treat as soft failure + optional alert.
- User session (`StringSession`) is equivalent to full account access — env/Dokploy secrets only.
- Telegram rate limits / flood waits — serialize invites per chat and backoff.

## Approach (recommended)

Webhook-driven pipeline in `crmparserv2` using existing bot webhook + GramJS (`telegram` npm) client for the user account.

```
Logistics adds bot (admin: Invite + Add admins)
        ↓
my_chat_member (member|administrator)
        ↓
Idempotency check (chat already processed?)
        ↓
Bot: createChatInviteLink
        ↓
User-bot: join via invite
        ↓
Bot: promoteChatMember(userbot, can_invite_users)
        ↓
User-bot: resolve + InviteToChannel for each list member
        ↓
Log results; user-bot stays in chat
```

---

## 1. Trigger

- Source: existing `processTelegramUpdate` / webhook path on `my_chat_member`.
- Fire auto-invite when `new_chat_member.status` ∈ `{ member, administrator, creator }` for **our bot**.
- Do **not** fire on `left` / `kicked` / `restricted` (except we already mark chat inactive).
- Chat types: `group` / `supergroup` only (skip `channel` / `private` for v1).
- After fire: enqueue or `await` a dedicated `runAutoInviteForChat(chatId)` with try/catch so webhook still returns `ok: true` quickly (prefer **async queue / setImmediate** so Telegram does not retry on long MTProto work).

## 2. Idempotency

SQLite table `telegram_auto_invite_runs`:

| Column | Notes |
|--------|--------|
| `chat_id` TEXT PK | |
| `status` TEXT | `pending` \| `success` \| `partial` \| `failed` |
| `started_at` TEXT | ISO |
| `finished_at` TEXT NULL | |
| `detail_json` TEXT NULL | per-user results, errors |

- Auto trigger: skip if row exists with `success` or `partial` (avoid spam on repeated bot events).
- Auto trigger: retry if previous status is `failed` or `pending` stuck (optional timeout, e.g. >15 min).
- **Manual force** (`force=1` / UI): re-run and invite anyone from the current active list who is still not a participant (list growth after first run).
- If bot lacks admin rights to create invite / promote → `failed` with clear error in `detail_json` (ops: grant Invite + Add admins).
- Concurrent duplicate webhooks: transaction / unique insert so only one run proceeds.

## 3. Auto-invite member list

### Storage

SQLite `telegram_auto_invite_members`:

| Column | Notes |
|--------|--------|
| `id` INTEGER PK | |
| `username` TEXT NULL | without leading `@` normalized |
| `user_id` TEXT NULL | Telegram user id as string |
| `display_name` TEXT NULL | optional label for UI |
| `active` INTEGER | 0 = skip in runs |
| `updated_at` TEXT | |

Constraint: at least one of `username` / `user_id` required.

On successful resolve, persist `user_id` even if entry was username-only.

### Settings / secrets (env)

| Key | Purpose |
|-----|---------|
| `TELEGRAM_API_ID` | my.telegram.org |
| `TELEGRAM_API_HASH` | my.telegram.org |
| `TELEGRAM_USER_SESSION` | GramJS StringSession |
| (optional) `TELEGRAM_USERBOT_USER_ID` | cached self id for promote target |

Bot token remains existing settings/`TELEGRAM_BOT_TOKEN` path.

### UI (`/telegram`)

New section **«Авто-добавление»** (below Bot / above or near Chats):

- Session status: configured / missing / error (no raw session dump).
- Table of members: username, user_id, display name, active toggle, delete.
- Add form: username and/or user_id + optional name.
- Hint: bot in order chats needs admin rights **Invite users** + **Add new admins**.
- Optional: «Повторить для чата» with `chat_id` for failed runs (v1 nice-to-have; can be API-only).

## 4. Runtime flow (detail)

1. **Create invite link** via Bot API `createChatInviteLink` (member_limit small or expire short).
2. **User-bot join** via GramJS import/join invite.
3. **Promote** user-bot with Bot API `promoteChatMember` (`can_invite_users: true`; other rights minimal).
4. For each **active** member:
   - Resolve entity (prefer stored `user_id`, else username).
   - If already participant → `skipped`.
   - Else invite → `invited` or `failed` (privacy / flood / not found).
5. Persist run status: all invited/skipped → `success`; any failed → `partial`; join/promote hard fail → `failed`.
6. Soft-fail path: append warnings to run detail; do not throw out of webhook handler.

## 5. Module layout (crmparserv2)

| Area | Responsibility |
|------|----------------|
| `backend/src/telegram/userbot/` | GramJS client singleton, join, invite, resolve |
| `backend/src/telegram/auto-invite.js` | Orchestration + idempotency |
| `backend/src/telegram/inbound.js` | Hook trigger (non-blocking) |
| `backend/src/routes/telegram.js` | CRUD members + session status + optional retry |
| `frontend/src/pages/Telegram.jsx` | Авто-добавление section |
| `.env.example` + Dokploy compose | Pass new env vars into container |

Dependency: `telegram` (GramJS) in backend `package.json`.

## 6. Ops: creating the session

Document in `ops/` or plan appendix:

1. Obtain `api_id` / `api_hash` at https://my.telegram.org.
2. Run one-shot script (local, not in prod logs) to login with phone/code → print StringSession.
3. Set Dokploy secrets; redeploy; never commit session string.

Staging verify: add bot to a test group → user-bot appears → list members appear → run row `success`/`partial`.

## 7. Security

- No session / api_hash in frontend responses or logs.
- Restrict member CRUD to existing app auth (`APP_PASSWORD` / session).
- Rate-limit promote/invite; respect `FLOOD_WAIT`.
- Treat user-bot account as a **service identity** (not personal day-to-day phone if avoidable).

## 8. Testing

- Unit: idempotency skip; member validation (username/id required); status aggregation `partial` vs `success`.
- Unit: orchestration with mocked Bot API + mocked GramJS.
- Manual staging: real group + 1–2 test accounts on the list.

## Success criteria

- Logistics adds only the bot (with required admin rights) to a new order group.
- Within a short time, user-bot and active list members are in the group (modulo privacy blocks).
- `/telegram` shows/edits the list; missing session shows a clear disabled/error state.
- Repeat bot join does not spam re-invites.

## Future (out of v1)

- Richer in-chat user-bot features in order groups.
- Alert channel when `partial`/`failed`.
- Auto-approve join requests as fallback for privacy-blocked users.
- Per-chat invite overrides (different lists).
