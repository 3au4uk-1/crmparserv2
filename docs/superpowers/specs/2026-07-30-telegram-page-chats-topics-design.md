# Telegram page: chat/topic picker and webhook discovery

**Date:** 2026-07-30  
**Repo:** `crmparserv2`  
**Branch:** `staging`  
**Status:** draft for review  

## Problem

Telegram settings live as a Settings tab with a raw `chat_id` for `okleyka.send`. Operators need:

1. A dedicated left-nav page for the bot (token, webhook, chats, okleyka destination).
2. A list of chats the bot belongs to (auto-discovered + manual add).
3. For forum chats — pick a topic so outbound okleyka goes to that topic.

## Goals

- Move Telegram UI out of Settings into sidebar route `/telegram`.
- Discover and cache chats/topics from Telegram webhook updates; allow manual add.
- Bind `okleyka.send` to `{ chatId, threadId? }` and send with `message_thread_id` when set.
- One-click `setWebhook` / `deleteWebhook` using public HTTPS URL.

## Non-goals (v1)

- Multiple event types beyond `okleyka.send` (extend later).
- MTProto / user-bot for a full topic catalog.
- Inbound bot commands / callbacks beyond discovery bookkeeping.
- Changes to BrandingTwentyView API contract (thread comes from parser settings).
- Long polling (HTTPS webhook only).

## Constraints (Telegram Bot API)

- Bots **cannot** list all chats they belong to; discovery is via updates (`my_chat_member`, messages, etc.).
- Bots **cannot** list all forum topics via Bot API (MTProto `channels.getForumTopics` is out of scope). Topics are learned from `forum_topic_*` service messages and messages with `message_thread_id` + `is_topic_message`, plus manual entry.
- Topic **names** are reliable mainly from `forum_topic_created` / `forum_topic_edited`; otherwise name may be empty until edited/created events arrive.

## Approach

Dedicated page + SQLite cache + real webhook handler + extended chat map for okleyka.

---

## 1. Navigation and page

- Sidebar item **Telegram** → `/telegram` (crmparser frontend).
- Remove Settings tab `telegram`. Soft redirect: `/settings?tab=telegram` → `/telegram`.
- Page sections (top → bottom):
  1. **Bot** — token save/preview, «Проверить бота» (`getMe`), webhook status + connect/disconnect.
  2. **Chats** — list of **active** chats by default; toggle «Показать неактивные»; manual add (`chat_id` or `@username`).
  3. **Оклейка → отправка** — chat select, topic select (if forum), save destination, «Тест в чат».

## 2. Data model

### `telegram_chats`

| Column | Notes |
|--------|--------|
| `chat_id` TEXT PK | Telegram chat id as string |
| `title` TEXT | |
| `type` TEXT | `group` / `supergroup` / `channel` / `private` |
| `is_forum` INTEGER | 0/1 |
| `username` TEXT NULL | |
| `active` INTEGER | 0 when bot left/kicked |
| `source` TEXT | `webhook` \| `manual` |
| `last_seen_at` TEXT | ISO timestamp |

### `telegram_topics`

| Column | Notes |
|--------|--------|
| `chat_id` TEXT | FK → `telegram_chats` |
| `thread_id` INTEGER | Telegram `message_thread_id` |
| `name` TEXT NULL | May be empty |
| `source` TEXT | `webhook` \| `manual` |
| `last_seen_at` TEXT | |
| PK | `(chat_id, thread_id)` |

On bot leave/kick: set `telegram_chats.active = 0` (keep rows for history; UI lists active by default).

### Settings keys

| Key | Value |
|-----|--------|
| `telegram_bot_token` | unchanged |
| `telegram_webhook_secret` | already in schema; used for `secret_token` / header check |
| `telegram_chat_map` | JSON map; for `okleyka.send` store `{ "chatId": "...", "threadId": null \| number }` |

**Migration from current map:** if `okleyka.send` is a string, treat as `{ chatId: "<string>" }` (no thread). Readers accept both shapes during transition; writers always persist object form.

## 3. Webhook and discovery

### Endpoint

`POST /api/telegram/webhook`

- Validate `X-Telegram-Bot-Api-Secret-Token` against stored secret (reject 401 if secret configured and mismatch).
- Process update synchronously enough to upsert DB; always respond `200 { ok: true }` when auth passes (avoid Telegram retries storms; log processing errors).

### Update handling

| Update / field | Action |
|--------|--------|
| `my_chat_member` | Upsert chat; if new status not `member`/`administrator`/`creator` → `active=0` |
| `message` / `channel_post` | Upsert chat; if `is_topic_message` + `message_thread_id` → upsert topic (name may stay null) |
| `message.forum_topic_created` / `message.forum_topic_edited` | Upsert topic with name from service payload |
| Other | Ignore for v1 |

Optional enrichment: `getChat(chat_id)` when title/`is_forum` unknown.

### Webhook admin API

- `POST /api/telegram/webhook/setup` — generate/persist secret if empty; `setWebhook({ url: PUBLIC_BASE_URL + '/api/telegram/webhook', secret_token })`.
- `POST /api/telegram/webhook/teardown` — `deleteWebhook`; keep secret.
- `GET /api/telegram/webhook/status` — local config + optional `getWebhookInfo`.

**Env:** `PUBLIC_BASE_URL` (no trailing slash), e.g. staging/prod public HTTPS origin of crmparser. If unset, setup button disabled with hint.

### Manual add

- Chat: body `{ chatId }` → `getChat` → upsert `source=manual`, `active=1`.
- Topic: body `{ chatId, threadId, name? }` → upsert `source=manual` (chat must exist or be fetched first).

### List APIs

- `GET /api/telegram/chats?active=1`
- `GET /api/telegram/chats/:chatId/topics`

## 4. Okleyka destination UI and outbound

### UI

- Select active chat.
- If chat is **not** forum: destination is `{ chatId }` only (no `threadId`).
- If chat **is** forum: topic select is required before save.
  - Always include synthetic option **«General (thread 1)»** with `threadId: 1` (Telegram General topic).
  - Plus cached topics from DB (label: name or `#threadId` if name empty).
  - If only General is available: short help — post in a topic / create topic / add `thread_id` manually to discover more.
- Save → `PUT` settings chat map for `okleyka.send` as object `{ chatId, threadId? }`.
- Test send uses saved destination.

### Outbound

- `sendOkleykaToTelegram` / low-level send helpers accept optional `threadId`.
- When `threadId` is a positive integer, pass `message_thread_id` on `sendMessage` and `sendMediaGroup`.
- `getTelegramChatId` becomes destination resolver returning `{ chatId, threadId? }` (compat alias ok).
- Twenty proxy path unchanged: still event `okleyka.send`; parser reads destination from settings.

## 5. Error handling

- Missing token / destination → 400 on test/send.
- Telegram API errors → 502 with description.
- Webhook without `PUBLIC_BASE_URL` → 400 on setup.
- Invalid secret on webhook → 401.
- Manual `getChat` fail → 404/502 with Telegram description.

## 6. Testing

- Unit: chat map migration string→object; outbound includes `message_thread_id` when set; webhook upsert from sample updates (member join, topic created, topic message); inactive on leave.
- Manual on staging: set token → setup webhook → add bot to forum group → see chat/topics → select → test send into topic.

## Out of scope follow-ups

- More event keys in chat map with same picker pattern.
- Richer topic naming (admin scrape / MTProto).
- Inbound product features (commands, ack buttons).
