# Progress: Telegram user-bot auto-invite

| Task | Status | Notes |
|------|--------|-------|
| 1 Schema + store | Done | `04df727..d0e1c7d` |
| 2 Bot admin helpers | Done | `d0e1c7d..5f6f212` |
| 3 Userbot GramJS | Done | `5f6f212..bb7601a` |
| 4 Orchestration | Done | `bb7601a..2755ecd` |
| 5 Webhook + API | Done | `2755ecd..c8efd14` |
| 6 Frontend UI | Done | `c8efd14..1c7af1d` |
| 7 Ops / staging | Done* | `1c7af1d..b3292b6`; *operator: session secrets + staging verify |

Tip: `b3292b6` (ahead of origin/staging, not pushed)

## Final review fixes (2026-07-30)

- **Rejoin tolerance:** `joinInvite` `USER_ALREADY_PARTICIPANT` no longer fails run; promote + invites proceed.
- **Promote non-fatal:** member invites run even when promote fails; `detail.promoteError` + `partial` status; supergroup/admin hint for `CHAT_ADMIN_REQUIRED` / `PEER_ID_INVALID`.
- Commit: `fix(telegram): tolerate rejoin and promote failure in auto-invite`
- Tests: 13/13 in `telegram-auto-invite.test.js`

Dokploy: compose environment passthrough for TELEGRAM_API_ID/HASH/USER_SESSION prepared; secrets still empty until operator login script.

Spec: `docs/superpowers/specs/2026-07-30-telegram-userbot-auto-invite-design.md`
Plan: `docs/superpowers/plans/2026-07-30-telegram-userbot-auto-invite.md`
