# Telegram user-bot (auto-invite + okleyka + discovery)

Operator runbook for the GramJS **user-bot** used by crmparser. Working flows (auto-invite, okleyka send, chat/topic discovery) run **only through the user account** — `@brandingxbot` is no longer required in order chats.

Secrets live in Dokploy env and the SQLite data volume — **never** commit `TELEGRAM_USER_SESSION`, `TELEGRAM_API_HASH`, or real phone numbers in git.

## Overview

| Item | Where / how |
|------|-------------|
| `TELEGRAM_API_ID` | Dokploy env — https://my.telegram.org → API development tools |
| `TELEGRAM_API_HASH` | Dokploy env — same |
| User session | **Preferred:** login via `/telegram` User-bot wizard → SQLite (`crmparser-data`) |
| `TELEGRAM_USER_SESSION` | Optional legacy env fallback; DB session takes precedence |
| Discovery | Background reconcile (`getDialogs` every ~30s) + `POST /api/telegram/chats/refresh` |
| Auto-invite | When reconcile sees a **new** group dialog → invite up to **5** list members with **5–15s** random delay |
| Okleyka | User-bot `sendMessage` / `sendFile` to configured chat/topic |

Bot API token / webhook remain in the UI as **deprecated** (optional legacy).

## 1. Obtain API credentials

1. Sign in at https://my.telegram.org (any account that can create an app; credentials work with the service phone later).
2. **API development tools** → create an app → note `api_id` / `api_hash`.

## 2. Dokploy env + compose passthrough

| Key | Value |
|-----|-------|
| `TELEGRAM_API_ID` | integer |
| `TELEGRAM_API_HASH` | hash |
| `TELEGRAM_PROXY_URL` | `socks5://xray:1080` when host cannot reach Telegram |
| `TELEGRAM_HTTP_PROXY_URL` | optional (legacy Bot API only) |
| `TELEGRAM_RECONCILE_INTERVAL_MS` | default `30000` |
| `TELEGRAM_POLLING` | can be `false` / unset — bot polling not needed for user-bot flows |

Compose `environment` must list these vars (same pitfall as `PUBLIC_BASE_URL`).

## 3. Login via UI

1. Open `/telegram` → **Авто-добавление** → **User-bot**.
2. Phone → code → 2FA if enabled → **User-bot подключён**.
3. Session stored in SQLite (`telegram_user_session`).

Pending login is in-memory — restart mid-wizard → start from phone again.

## 4. Ops model (no bot in chats)

1. Configure auto-invite members on `/telegram` (≤5 people in practice).
2. Logistics creates an order **supergroup** and adds the **user-bot account** as a member (or admin).
3. User-bot must be able to invite: either group allows member invites, or user-bot is admin with **Invite users**.
4. Within ~30s (or after **Обновить чаты из user-bot**), reconcile discovers the chat and runs auto-invite.
5. Remove `@brandingxbot` from existing order groups if it was added earlier.

## 5. Okleyka destination

On `/telegram` → **Оклейка → отправка**: pick chat (and forum topic if needed). Twenty calls `okleyka.send`; crmparser sends via user-bot MTProto (user-bot must already be in that chat).

## 6. CLI login (emergency only)

```bash
node backend/scripts/telegram-userbot-login.mjs
```

Paste StringSession into `TELEGRAM_USER_SESSION` only if UI login is unavailable.

## 7. Logout

- UI **Выйти** clears DB session.
- Also clear `TELEGRAM_USER_SESSION` env if set.

## 8. Staging checklist

1. [ ] API id/hash (+ proxy) set; compose passthrough OK.
2. [ ] UI login → user-bot connected; auto-invite `configured=true`.
3. [ ] Add members (≤5).
4. [ ] Add **user-bot** to a test supergroup (with invite capability).
5. [ ] Refresh chats / wait reconcile → members invited (privacy may block some).
6. [ ] Repeat → idempotent (no duplicate run spam).
7. [ ] Okleyka test-send to configured chat/topic.
8. [ ] Manually remove branding bot from groups if present.

## 9. Proxy (RKN)

See xray sidecar: `TELEGRAM_PROXY_URL=socks5://xray:1080`. User-bot MTProto goes through SOCKS5. Bot long-polling (`TELEGRAM_POLLING`) is unused for the user-bot-only path.

## Security

- StringSession = full account access (Dokploy + SQLite + backups).
- Prefer a dedicated service account.
- Invite delays (5–15s) and cap (5) reduce anti-spam risk; still treat mass invites carefully.

## Related code

| Path | Role |
|------|------|
| `backend/src/telegram/userbot/reconcile.js` | Dialog discovery + auto-invite trigger |
| `backend/src/telegram/auto-invite.js` | Capability check, cap 5, delays, invites |
| `backend/src/telegram/outbound.js` | Okleyka via GramJS |
| `backend/src/telegram/userbot/client.js` | Lazy GramJS client + proxy |
| `frontend/src/pages/Telegram.jsx` | UI |
| `ops/xray/` | VLESS proxy sidecar config |
