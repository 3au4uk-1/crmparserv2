# Digest via user-bot (not Bot API)

**Date:** 2026-08-07  
**Status:** Approved for planning  
**Scope:** crmparserv2 Telegram morning digest send + `/завтра` / `/послезавтра`  
**Related:** `2026-08-06-telegram-morning-digest-design.md`, `2026-08-07-telegram-digest-destination-ui-design.md`

## Problem

Digest send, digest «Тест», and `/завтра` currently use Telegram **Bot API** (`telegram_bot_token` + `callTelegram` / bot webhook). Production runs **user-bot** only (no bot token). Okleyka already sends via GramJS. Result: test/commands fail with `Bot token not configured` even when user-bot and `digest.morning` are set.

## Goals / non-goals

| In (v1) | Out (v1) |
|---------|----------|
| Send digest text via user-bot to `digest.morning` | Bot API fallback for digest |
| Cron + `runDigestForDay` without bot token | Commands from any chat |
| `/завтра` / `/послезавтра` via user-bot `NewMessage`, only in `digest.morning` chat/topic | Separate digest bot |
| `test-send` `digest.morning` via user-bot | Changing Omni enrichment |
| Remove digest handling from bot webhook inbound | |

## Decision

Approach: user-bot send + NewMessage filter scoped to `digest.morning` only. Drop Bot API from digest path.

## Send path

- `runDigestForDay` / `runMorningDigests`: require `isUserbotConfigured`; get client via `getUserbotClient`.
- Deliver text with GramJS `sendMessage` to `digest.morning` (`chatId`, optional `replyTo` = `threadId`).
- Prefer thin helper `sendDigestText({ client, chatId, threadId, text })` **or** reuse `sendOkleykaToTelegram({ ..., fileUrls: [] })`.
- No `getTelegramBotToken` / `callTelegram` on the digest send path.
- Missing user-bot or missing `digest.morning` → `{ ok: false, skipped: true, error: ... }` (cron logs skip; commands get short error in digest topic when applicable).

## Commands

- Register user-bot `NewMessage` handler (alongside mention-forward), e.g. `initDigestCommands`.
- Parse with existing `parseDigestCommand`.
- Match only when message chat id equals `digest.morning.chatId`, and if destination has `threadId`, message topic must match (forum).
- On match: `runDigestForDay({ db, offsetDays })` (destination still from settings).
- Errors: reply short text in the same digest chat/topic via user-bot (not Bot API).
- Outside `digest.morning`: ignore (no reply).
- Remove digest command handling from `inbound.js` (bot webhook).

## `POST /telegram/test-send`

| event | Transport | Text |
|-------|-----------|------|
| `okleyka.send` | user-bot (unchanged) | «Тест из crmparser» |
| `digest.morning` | user-bot | «Тест утренней сводки» |

400 if user-bot not configured or destination missing. Do **not** require bot token for digest.

## UI

No structural change required. Optional: digest section description may note «через user-bot» (YAGNI — skip unless copy is already being edited).

## Tests

- `runDigestForDay` uses mocked user-bot send; works without bot token; fails cleanly if user-bot missing.
- Command filter: wrong chat/topic → no `runDigestForDay`; matching dest → called.
- `test-send` `digest.morning` → user-bot path, no bot token.

## Ops (prod)

- User-bot session already present; `digest.morning` already set (forum + topic).
- After deploy: UI «Тест» on Утренняя сводка; `/завтра` **inside** that topic.

## Success criteria

1. Digest cron/commands/test work on prod without `telegram_bot_token`.
2. Commands ignored outside `digest.morning`.
3. Okleyka path unchanged.
4. Bot webhook no longer runs digest commands.
