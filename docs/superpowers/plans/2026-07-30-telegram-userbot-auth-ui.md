# Telegram user-bot auth UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let operators log in the Telegram user-bot from `/telegram` (phone → code → 2FA) with the GramJS client on the server and persist `StringSession` in SQLite.

**Architecture:** In-memory pending-login state machine drives GramJS; finished session is stored in settings; `getUserbotClient` resolves DB session first then env fallback; UI wizard never receives the session string.

**Tech Stack:** Node ESM, Express, better-sqlite3, Vitest, React (Vite), GramJS (`telegram`).

**Spec:** `docs/superpowers/specs/2026-07-30-telegram-userbot-auth-ui-design.md`

## Global Constraints

- Work on branch `staging` in `crmparserv2`.
- `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` remain **env-only** (never UI/DB).
- Session string never appears in API JSON or frontend.
- Auth routes behind existing `APP_PASSWORD` / app auth (same as other `/api/telegram/*` except webhook).
- One pending login at a time; TTL 10 minutes.
- SQLite key: `telegram_user_session`.
- TDD per task; commit after green; do not push unless asked.
- Prefer Composer 2.5 for implementer subagents if the human requested it for this track.
- Do not commit secrets.

## File map

| File | Responsibility |
|------|----------------|
| `backend/src/telegram/userbot/session-store.js` | get/set/clear DB session; `resolveSession(db)` |
| `backend/src/telegram/userbot/client.js` | `isApiConfigured`, `isUserbotConfigured(db?)`, `getUserbotClient(db?)`, `resetUserbotClient` |
| `backend/src/telegram/userbot/auth-login.js` | Pending state machine: start/code/password/cancel/logout/status |
| `backend/src/routes/telegram.js` | `/userbot/auth/*` routes |
| `backend/src/db/migrate.js` + `schema.sql` | Optional: no new table — uses `settings` key via INSERT OR REPLACE |
| `frontend/src/api.js` | Auth hooks |
| `frontend/src/pages/Telegram.jsx` | Wizard UI in Авто-добавление |
| `ops/telegram-userbot.md` | Prefer UI login; CLI fallback |

---

### Task 1: Session store + client resolution

**Files:**
- Create: `backend/src/telegram/userbot/session-store.js`
- Modify: `backend/src/telegram/userbot/client.js`
- Create: `backend/tests/telegram-userbot-session-store.test.js`
- Modify: any caller of `isUserbotConfigured()` / `getUserbotClient()` that must pass `db` when resolving DB session — at least `auto-invite.js` defaults and `routes/telegram.js` status.

**Interfaces:**
- Produces:
  - `SETTINGS_KEY_USER_SESSION = 'telegram_user_session'`
  - `getDbUserSession(db) → string` (trimmed, may be `''`)
  - `setDbUserSession(db, session: string) → void`
  - `clearDbUserSession(db) → void` (set empty or DELETE)
  - `resolveSession(db, envSession = config.telegramUserSession) → string` — DB if non-empty else env
  - `isApiConfigured(cfg = config) → boolean` — apiId + apiHash only
  - `isUserbotConfigured(db?, cfg?) → boolean` — apiConfigured && resolveSession(db) non-empty; if `db` omitted, env-only (backward compat) OR require db — prefer **require db for accurate status**; update call sites to pass `getDb()`
  - `getUserbotClient(db)` — uses resolveSession(db); throws 503 if not configured
  - `resetUserbotClient()` — disconnect/clear `clientPromise`

- [ ] **Step 1: Failing tests**

```js
// backend/tests/telegram-userbot-session-store.test.js
import { describe, expect, it, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  getDbUserSession,
  setDbUserSession,
  clearDbUserSession,
  resolveSession,
} from '../src/telegram/userbot/session-store.js';
import {
  isApiConfigured,
  isUserbotConfigured,
  resetUserbotClient,
} from '../src/telegram/userbot/client.js';

function memDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  return db;
}

describe('session-store', () => {
  let db;
  beforeEach(() => { db = memDb(); });

  it('prefers DB session over env', () => {
    setDbUserSession(db, 'db-sess');
    expect(resolveSession(db, 'env-sess')).toBe('db-sess');
  });

  it('falls back to env when DB empty', () => {
    expect(resolveSession(db, 'env-sess')).toBe('env-sess');
    clearDbUserSession(db);
    expect(getDbUserSession(db)).toBe('');
  });
});

describe('isUserbotConfigured', () => {
  it('needs api + session', () => {
    const db = memDb();
    const cfg = { telegramApiId: '1', telegramApiHash: 'h', telegramUserSession: '' };
    expect(isApiConfigured(cfg)).toBe(true);
    expect(isUserbotConfigured(db, cfg)).toBe(false);
    setDbUserSession(db, 's');
    expect(isUserbotConfigured(db, cfg)).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd backend && npm test -- telegram-userbot-session-store.test.js
```

- [ ] **Step 3: Implement session-store + update client.js**

`getUserbotClient(db)` must call `reset`-safe singleton keyed by session string change OR always use `resetUserbotClient` after login. Simplest: singleton + `resetUserbotClient` clears promise and tries `client.disconnect()` if available.

Update:
- `auto-invite.js` default `isConfigured: () => isUserbotConfigured(db)` — already has `db` in `runAutoInviteForChat`
- `getClient: () => getUserbotClient(db)`
- `routes` `GET /auto-invite/status` → `configured: isUserbotConfigured(getDb())`

- [ ] **Step 4: Tests PASS + related auto-invite tests still pass**

```bash
cd backend && npm test -- telegram-userbot-session-store.test.js telegram-auto-invite.test.js
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(telegram): resolve userbot session from SQLite with env fallback"
```

Git author one-shot if needed. Do not push.

---

### Task 2: Auth login state machine

**Files:**
- Create: `backend/src/telegram/userbot/auth-login.js`
- Create: `backend/tests/telegram-userbot-auth-login.test.js`

**Interfaces:**
- Produces (deps injectable for tests):
  - `getAuthStatus(db, { getUserProfile? }) → { apiConfigured, sessionSet, pending, user }`
  - `startLogin(db, phone, deps?) → { pending: 'code' }`
  - `submitCode(db, code, deps?) → { pending: 'password'|'none', sessionSet }`
  - `submitPassword(db, password, deps?) → { pending: 'none', sessionSet }`
  - `cancelLogin() → void`
  - `logout(db) → void` — clear DB session + cancel + resetUserbotClient

Pending TTL: 10 minutes. Second `startLogin` cancels previous.

Deps for GramJS (inject in tests):

```js
{
  createLoginClient, // () => client-like
  // client methods used:
  // sendCodeFlow: { sendCode(phone), signIn({ phone, code }), signInWithPassword(password), session: { save() }, disconnect? }
}
```

Pragmatic approach matching GramJS `client.start` callbacks is awkward for HTTP — prefer explicit flow:

**Recommended implementation using injectable port:**

```js
// deps.telegramAuthApi
{
  sendCode({ apiId, apiHash, phone }) → { phoneCodeHash, clientHandle }
  signIn({ clientHandle, phone, code, phoneCodeHash }) → { session } | { needPassword: true }
  checkPassword({ clientHandle, password }) → { session }
  disconnect(clientHandle)
}
```

Production adapter in same file or `auth-gramjs.js` wrapping TelegramClient.

For TDD: unit-test state machine with fake `telegramAuthApi`; thin adapter can be lightly tested or smoke-only.

Status `user`: if sessionSet, optional `deps.fetchUser(db)` — can no-op in v1 (`user: null`) or call getSelfUserId after connect; keep best-effort, failures → `user: null`.

- [ ] **Step 1: Failing tests** — start→code success; start→code→password; cancel; reject start without api; expired pending; logout clears session

- [ ] **Step 2: Implement auth-login.js + GramJS adapter**

- [ ] **Step 3: PASS → commit**

```bash
git commit -m "feat(telegram): userbot interactive login state machine"
```

---

### Task 3: HTTP routes

**Files:**
- Modify: `backend/src/routes/telegram.js`
- Create: `backend/tests/telegram-userbot-auth-routes.test.js`

**Routes:**

| Method | Path | Body |
|--------|------|------|
| GET | `/userbot/auth/status` | — |
| POST | `/userbot/auth/start` | `{ phone }` |
| POST | `/userbot/auth/code` | `{ code }` |
| POST | `/userbot/auth/password` | `{ password }` |
| POST | `/userbot/auth/cancel` | — |
| POST | `/userbot/auth/logout` | — |

Map errors: missing api → 503; validation → 400; telegram errors → 400/502 with `error` string; never include session.

- [ ] **Step 1: Route tests** with mocked auth-login module OR inject — prefer calling router with stubbed functions via dependency injection if pattern exists; else `vi.mock` the auth-login module.

- [ ] **Step 2: Wire routes**

- [ ] **Step 3: PASS → commit**

```bash
git commit -m "feat(telegram): userbot auth HTTP API"
```

---

### Task 4: Frontend wizard on `/telegram`

**Files:**
- Modify: `frontend/src/api.js`
- Modify: `frontend/src/pages/Telegram.jsx`

**Hooks:**
- `useTelegramUserbotAuthStatus`
- `useTelegramUserbotAuthStart` / `Code` / `Password` / `Cancel` / `Logout` mutations; invalidate status (+ auto-invite status) on success

**UI:** Inside «Авто-добавление», above members table (or as first subsection **User-bot**):

1. Loading status
2. `!apiConfigured` → existing-style warning for API env vars
3. `sessionSet && !pending` → «User-bot подключён» + optional user label + **Выйти**
4. Else wizard by `pending`:
   - null + !sessionSet → phone input + «Отправить код»
   - `code` → code input + «Подтвердить» + «Отмена»
   - `password` → password input + «Войти» + «Отмена»
5. Keep members UI gated on `sessionSet` / `configured` as today (`auto-invite/status.configured` stays the gate)

- [ ] **Step 1: Implement UI + hooks**

- [ ] **Step 2: `npm run build` in frontend**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(telegram): userbot login wizard on /telegram"
```

---

### Task 5: Ops doc update

**Files:**
- Modify: `ops/telegram-userbot.md`

Document:
1. Set `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` in Dokploy (passthrough already in compose).
2. Prefer login via `/telegram` → User-bot wizard; session stored in SQLite volume.
3. CLI script remains emergency fallback (writes session you can paste into UI… actually CLI prints for env — say: prefer UI; CLI only if UI broken, then paste session via a future admin tool OR set env fallback).
4. Logout clears DB session only; remove env `TELEGRAM_USER_SESSION` if set to fully disconnect.
5. SQLite backups contain session — handle as secret.

- [ ] **Step 1: Update doc**

- [ ] **Step 2: Commit**

```bash
git commit -m "docs(ops): prefer UI login for telegram userbot session"
```

---

## Spec coverage

| Spec item | Task |
|-----------|------|
| Session in SQLite + env fallback | 1 |
| isUserbotConfigured / client reset | 1 |
| Pending login phone/code/2FA | 2 |
| Auth HTTP API + no session leak | 3 |
| `/telegram` wizard | 4 |
| Ops update | 5 |
| api_id/hash env-only | all |

## Placeholder / consistency scan

- Settings key: `telegram_user_session`
- Routes prefix: `/api/telegram/userbot/auth`
- Pending values: `null` | `"code"` | `"password"`
- `resetUserbotClient` name fixed across tasks
