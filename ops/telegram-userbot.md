# Telegram user-bot session setup (auto-invite)

Operator runbook for the GramJS **user-bot** used by crmparser auto-invite (join group via invite link, promote members). The bot token path is unchanged; this account is a separate **service identity**.

Secrets live in Dokploy env and the SQLite data volume — **never** commit `TELEGRAM_USER_SESSION`, `TELEGRAM_API_HASH`, or real phone numbers in git.

## Overview

| Item | Where / how |
|------|-------------|
| `TELEGRAM_API_ID` | Dokploy env — https://my.telegram.org → API development tools |
| `TELEGRAM_API_HASH` | Dokploy env — same |
| User session | **Preferred:** login via `/telegram` User-bot wizard → stored in SQLite (`crmparser-data` volume) |
| `TELEGRAM_USER_SESSION` | **Optional legacy fallback** — env StringSession if set; DB session takes precedence |

Backend reads API credentials in `backend/src/config.js`. Session resolution prefers the DB value, then falls back to `TELEGRAM_USER_SESSION` env (`backend/src/telegram/userbot/session-store.js`).

## 1. Obtain API credentials

1. Sign in at https://my.telegram.org with the **service** Telegram account (not a personal day-to-day phone if avoidable).
2. Open **API development tools** and create an app.
3. Note `api_id` and `api_hash`.

## 2. Dokploy: API credentials + compose passthrough

Set **at minimum** these two values in Dokploy environment for **crmparser-staging** (then production when ready):

| Key | Value |
|-----|-------|
| `TELEGRAM_API_ID` | integer from my.telegram.org |
| `TELEGRAM_API_HASH` | hash string |

`TELEGRAM_USER_SESSION` is **not required** when using the UI login flow.

### PUBLIC_BASE_URL pitfall (same for user-bot vars)

Dokploy stores env values, but the **raw compose** must pass them into the container `environment` block. If a var is set in Dokploy UI but missing from compose, the process sees an empty value.

Repo `docker-compose.yml` includes (mirror of `PUBLIC_BASE_URL`):

```yaml
- TELEGRAM_API_ID=${TELEGRAM_API_ID}
- TELEGRAM_API_HASH=${TELEGRAM_API_HASH}
- TELEGRAM_USER_SESSION=${TELEGRAM_USER_SESSION}
```

**Operator follow-up:** Update Dokploy raw compose for `crmparser-staging` (and prod) to include the same three lines if not already present. This task does not apply Dokploy live changes — controller/operator verifies after deploy.

## 3. Login via UI (preferred)

After redeploy with API credentials set:

1. Open `/telegram` → **Авто-добавление** → **User-bot**.
2. Enter service phone → confirm SMS/Telegram code → 2FA password if enabled.
3. UI shows **User-bot подключён** when session is fully saved.

Session is written to SQLite on the `crmparser-data` volume (`settings` key `telegram_user_session`). No manual copy/paste of StringSession needed.

**Pending login is in-memory** — if the server restarts mid-wizard, restart from the phone step.

## 4. CLI script (emergency fallback only)

Use only when UI login is unavailable (e.g. locked out of web UI, disaster recovery).

Run **once** on a machine you trust. Do not run inside production containers or CI logs.

```bash
# From crmparserv2 repo root — either export or put in .env (never commit real values):
# TELEGRAM_API_ID=12345678
# TELEGRAM_API_HASH=...

node backend/scripts/telegram-userbot-login.mjs
```

The script prompts for phone, code, and 2FA password if enabled. It prints a **StringSession** line — paste into Dokploy as `TELEGRAM_USER_SESSION` and redeploy.

Prefer UI login for normal operations; env session is a fallback when DB is empty.

## 5. Logout / full disconnect

- **UI «Выйти»** clears the DB session (`telegram_user_session` row deleted).
- If `TELEGRAM_USER_SESSION` is also set in Dokploy env, the user-bot remains connected via env fallback — **clear that env var too** to fully disconnect.
- DB session wins over env when both exist; logout only removes DB.

## 6. Redeploy

Redeploy crmparser after changing API credentials or env session. UI-logged sessions persist across redeploys in the SQLite volume.

## 7. Staging verification checklist

1. [ ] `TELEGRAM_API_ID` and `TELEGRAM_API_HASH` set on Dokploy; compose `environment` includes all three telegram vars (same pitfall as `PUBLIC_BASE_URL`).
2. [ ] Redeploy staging crmparser.
3. [ ] Open `/telegram` → User-bot wizard (no “Задайте TELEGRAM_API_ID / HASH” warning).
4. [ ] Complete login via UI → **User-bot подключён**.
5. [ ] Auto-invite section shows configured; add 1–2 test members (username and/or user_id).
6. [ ] Create a test group; add the **bot** as admin with **Invite users via link** and **Add new admins**.
7. [ ] Trigger auto-invite (bot join event or retry API/UI) → user-bot joins group; listed members are invited (modulo privacy blocks).
8. [ ] Check run status in UI / retry API — expect `success` or `partial` with clear per-member errors if privacy blocked.
9. [ ] Re-add bot / repeat event → **no duplicate** invites (idempotent).

## Security

- StringSession equals full Telegram account access — treat Dokploy secrets, SQLite data, and backups as confidential.
- **SQLite backups** (`crmparser-data` volume / DB file) contain the session string — restrict access like a password vault.
- Use a dedicated service account; rotate by logging out in UI and re-authenticating (or re-run CLI + update env if using fallback).
- Member CRUD remains behind existing app auth (`APP_PASSWORD` / session cookie).

## Related code

| Path | Role |
|------|------|
| `backend/scripts/telegram-userbot-login.mjs` | Emergency CLI login → print session |
| `backend/src/telegram/userbot/session-store.js` | DB session read/write/clear |
| `backend/src/telegram/userbot/auth-login.js` | UI login flow (start/code/password/logout) |
| `backend/src/telegram/userbot/client.js` | Lazy GramJS client |
| `frontend/src/pages/Telegram.jsx` | Auto-invite UI + User-bot wizard |
| `.env.example` | Documented var names (placeholders only) |
