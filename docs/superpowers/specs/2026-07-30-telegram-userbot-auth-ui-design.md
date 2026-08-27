# Telegram user-bot auth UI (server-side login)

**Date:** 2026-07-30  
**Repo:** `crmparserv2`  
**Branch:** `staging`  
**Status:** approved  

## Problem

Auto-invite needs a GramJS `StringSession` for a service Telegram account. The one-shot CLI (`backend/scripts/telegram-userbot-login.mjs`) assumes an interactive terminal on a trusted machine. Operators often need login **on the server** (staging/Dokploy): the phone receives the code, but the MTProto client must run where the session will be used.

## Goals

- Server-side interactive login from crmparser `/telegram` (phone → code → optional 2FA).
- Persist session in **SQLite settings** (no redeploy to rotate).
- Keep `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` **env-only** (Dokploy / `.env`).
- Never expose the session string (or api_hash) to the frontend.
- After login, auto-invite userbot client picks up the new session without process restart when possible (reset client singleton).

## Non-goals (v1)

- Editing/storing `api_id` / `api_hash` in UI.
- QR login.
- Multiple user-bot accounts.
- Replacing Bot API bot-token settings.
- Writing session back into Dokploy env automatically.

## Decisions (approved)

| Topic | Choice |
|-------|--------|
| Approach | Wizard on `/telegram` + GramJS in crmparser process |
| Session storage | SQLite settings key (e.g. `telegram_user_session`) |
| API credentials | Env only |
| Env session | Optional **fallback** if DB empty (compat with existing Dokploy setup) |

## Constraints

- Login endpoints require existing app auth (`APP_PASSWORD` / session), same as other `/api/telegram/*` (except inbound webhook).
- Only **one** pending login at a time; TTL ~5–10 minutes; abandoned clients disconnected.
- Flood / invalid code / 2FA errors surfaced as 4xx with safe messages (no stack/session).
- StringSession is full account access — treat DB like a secret store; backups of SQLite include it.

---

## 1. Status model

`GET /api/telegram/userbot/auth/status` →

```json
{
  "apiConfigured": true,
  "sessionSet": true,
  "pending": null,
  "user": { "id": "123", "username": "svc_brand", "firstName": "..." }
}
```

| Field | Meaning |
|-------|---------|
| `apiConfigured` | Both `TELEGRAM_API_ID` and `TELEGRAM_API_HASH` non-empty |
| `sessionSet` | Resolved session non-empty (DB or env fallback) |
| `pending` | `null` \| `"code"` \| `"password"` — wizard step waiting for operator |
| `user` | Present when session works; from GramJS getMe / getSelf (best-effort) |

Never return session string, api_hash, phone, or 2FA password.

## 2. Login flow (API)

All under `/api/telegram/userbot/auth`, auth-gated.

| Method | Body | Behavior |
|--------|------|----------|
| `POST /start` | `{ phone }` | If `!apiConfigured` → 503. Cancel any prior pending. Start GramJS client with empty session; send code; set pending=`code`. |
| `POST /code` | `{ code }` | Complete phone code step. If 2FA required → pending=`password`. Else save session to DB, clear pending, reset userbot singleton, return status. |
| `POST /password` | `{ password }` | Complete 2FA; save session; clear pending; reset singleton. |
| `POST /logout` | — | Delete DB session key; clear pending; disconnect/reset singleton. Env fallback remains until env cleared (document: logout clears DB only). |
| `POST /cancel` | — | Abort pending login; disconnect temp client. |

**Phone format:** E.164-ish (`+7900…`); trim; reject empty.

**Pending store:** in-memory module singleton `{ client, phone, step, expiresAt }` — not SQLite (incomplete login must not persist across restarts as half-open).

## 3. Session resolution (runtime)

Update `isUserbotConfigured` / `getUserbotClient` path:

1. Read session from settings `telegram_user_session` if non-empty.
2. Else fall back to `config.telegramUserSession` (env).
3. `apiConfigured` still requires env api_id + api_hash.
4. `configured` for auto-invite UI / `GET /auto-invite/status` = `apiConfigured && sessionSet` (same rule, now DB-aware).

On successful login: `INSERT OR REPLACE` settings; call `resetUserbotClient()` (new export) so next invite uses fresh session.

## 4. UI (`/telegram`)

In **Авто-добавление** (or nested **User-bot** card):

1. `!apiConfigured` → warning: задайте `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` на сервере (Dokploy).
2. `sessionSet && !pending` → «Подключён» + optional `@username` / id; button **Выйти**.
3. Else wizard:
   - Step phone → Отправить код  
   - Step code → Подтвердить  
   - Step password → 2FA → Войти  
   - Отмена (cancel pending)

Reuse existing page patterns (`Section`, `FieldLabel`, action error toasts). Do not show raw session.

## 5. Module layout

| File | Role |
|------|------|
| `backend/src/telegram/userbot/auth-session.js` | Pending login state machine + GramJS start/signIn |
| `backend/src/telegram/userbot/session-store.js` | get/set/clear DB session; resolveSession(db) |
| `backend/src/telegram/userbot/client.js` | Use `resolveSession`; add `resetUserbotClient()` |
| `backend/src/routes/telegram.js` | Auth routes |
| `frontend/src/pages/Telegram.jsx` | Wizard UI |
| `frontend/src/api.js` | Hooks |
| `ops/telegram-userbot.md` | Prefer UI login; CLI remains fallback |

Keep CLI script as offline fallback for air-gapped ops.

## 6. Security

- All auth routes behind app password.
- Rate-limit start/code attempts lightly (e.g. per-IP or global cooldown) to reduce abuse if APP_PASSWORD leaks — soft v1 (optional simple in-memory throttle).
- Logs: never print session, code, or password; phone may be masked (`+7900***4567`).
- SQLite backups contain session — note in ops doc.

## 7. Testing

- Unit: pending state transitions; resolveSession prefers DB over env; logout clears DB; status never includes session.
- Unit: mock GramJS client for start/code/password success paths.
- Manual staging: env api_id/hash set → UI login → `configured=true` → auto-invite still works.

## Success criteria

- Operator can create/refresh user-bot session from `/telegram` without SSH/CLI.
- Session survives container restart (SQLite volume).
- Frontend never receives session string.
- Missing api env still blocks login with a clear message.

## Future

- Encrypt session at rest with `SESSION_SECRET`.
- QR login.
- Alert when session dies (AUTH_KEY_UNREGISTERED).
