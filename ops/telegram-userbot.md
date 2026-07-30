# Telegram user-bot session setup (auto-invite)

Operator runbook for the GramJS **user-bot** used by crmparser auto-invite (join group via invite link, promote members). The bot token path is unchanged; this account is a separate **service identity**.

Secrets live in Dokploy env — **never** commit `TELEGRAM_USER_SESSION`, `TELEGRAM_API_HASH`, or real phone numbers in git.

## Overview

| Env var | Source |
|---------|--------|
| `TELEGRAM_API_ID` | https://my.telegram.org → API development tools |
| `TELEGRAM_API_HASH` | same |
| `TELEGRAM_USER_SESSION` | One-shot login script (StringSession) |

Backend reads these in `backend/src/config.js`. `/telegram` shows **configured=true** only when all three are non-empty inside the **running container**.

## 1. Obtain API credentials

1. Sign in at https://my.telegram.org with the **service** Telegram account (not a personal day-to-day phone if avoidable).
2. Open **API development tools** and create an app.
3. Note `api_id` and `api_hash`.

## 2. Generate StringSession (local, trusted machine)

Run **once** on a machine you trust. Do not run inside production containers or CI logs.

```bash
# From crmparserv2 repo root — either export or put in .env (never commit real values):
# TELEGRAM_API_ID=12345678
# TELEGRAM_API_HASH=...

node backend/scripts/telegram-userbot-login.mjs
```

The script prompts for:

- Phone number (international format, e.g. `+79001234567`)
- SMS/Telegram login code
- 2FA password if enabled

It prints a single **StringSession** line. Copy it immediately; treat it like a password (full account access).

## 3. Dokploy: secrets + compose passthrough

Set the three values in Dokploy environment for **crmparser-staging** (then production when ready):

| Key | Value |
|-----|-------|
| `TELEGRAM_API_ID` | integer from my.telegram.org |
| `TELEGRAM_API_HASH` | hash string |
| `TELEGRAM_USER_SESSION` | output from login script |

### PUBLIC_BASE_URL pitfall (same for user-bot vars)

Dokploy stores env values, but the **raw compose** must pass them into the container `environment` block. If a var is set in Dokploy UI but missing from compose, the process sees an empty value.

Repo `docker-compose.yml` includes (mirror of `PUBLIC_BASE_URL`):

```yaml
- TELEGRAM_API_ID=${TELEGRAM_API_ID}
- TELEGRAM_API_HASH=${TELEGRAM_API_HASH}
- TELEGRAM_USER_SESSION=${TELEGRAM_USER_SESSION}
```

**Operator follow-up:** Update Dokploy raw compose for `crmparser-staging` (and prod) to include the same three lines if not already present. This task does not apply Dokploy live changes — controller/operator verifies after deploy.

## 4. Redeploy

Redeploy crmparser so the container picks up new env. No session file on disk — session is env-only.

## 5. Staging verification checklist

1. [ ] Secrets set on Dokploy; compose `environment` includes all three vars (same pitfall as `PUBLIC_BASE_URL`).
2. [ ] Redeploy staging crmparser.
3. [ ] Open `/telegram` → auto-invite section shows configured (no “Задайте TELEGRAM_API_ID / HASH / USER_SESSION” warning).
4. [ ] Add 1–2 test members (username and/or user_id) via UI.
5. [ ] Create a test group; add the **bot** as admin with **Invite users via link** and **Add new admins**.
6. [ ] Trigger auto-invite (bot join event or retry API/UI) → user-bot joins group; listed members are invited (modulo privacy blocks).
7. [ ] Check run status in UI / retry API — expect `success` or `partial` with clear per-member errors if privacy blocked.
8. [ ] Re-add bot / repeat event → **no duplicate** invites (idempotent).

## Security

- StringSession equals full Telegram account access — Dokploy secrets only, never frontend or API responses.
- Use a dedicated service account; rotate session by re-running the login script if compromised.
- Member CRUD remains behind existing app auth (`APP_PASSWORD` / session cookie).

## Related code

| Path | Role |
|------|------|
| `backend/scripts/telegram-userbot-login.mjs` | Interactive login → print session |
| `backend/src/telegram/userbot/client.js` | Lazy GramJS client |
| `frontend/src/pages/Telegram.jsx` | Auto-invite UI + configured warning |
| `.env.example` | Documented var names (placeholders only) |
