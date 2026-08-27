# Telegram user-bot auto-invite — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the branding bot joins an order group, a GramJS user-bot joins, gets invite rights, and invites a configurable member list; user-bot stays in the chat.

**Architecture:** Existing Bot API webhook triggers a non-blocking `runAutoInviteForChat`; orchestration uses Bot API for invite links + promote, and a GramJS client for join/invite; SQLite stores members + per-chat run idempotency; `/telegram` UI manages the list.

**Tech Stack:** Node ESM, Express, better-sqlite3, Vitest, React (Vite), Telegram Bot HTTP API, GramJS (`telegram` npm).

**Spec:** `docs/superpowers/specs/2026-07-30-telegram-userbot-auto-invite-design.md`

## Global Constraints

- Work on branch `staging` in `crmparserv2`.
- Staging first; never commit `TELEGRAM_USER_SESSION` / api_hash.
- Bot needs admin rights in order chats: **Invite users** + **Add new admins**.
- Privacy-blocked users = soft fail (`partial`), not hard crash.
- Webhook must return `ok: true` quickly — auto-invite runs async (`setImmediate` / queue).
- TDD: failing test → implement → pass → commit per task.
- Do not push unless asked.
- Prefer Composer 2.5 for implementer subagents if the human requested it for this feature track.

## File map

| File | Responsibility |
|------|----------------|
| `backend/src/db/schema.sql` + `migrate.js` | `telegram_auto_invite_members`, `telegram_auto_invite_runs` |
| `backend/src/telegram/auto-invite-store.js` | Member CRUD + run idempotency |
| `backend/src/telegram/bot-admin.js` | `createInviteLink`, `promoteUserbot` via Bot API |
| `backend/src/telegram/userbot/client.js` | GramJS singleton + `isConfigured` |
| `backend/src/telegram/userbot/actions.js` | `joinInviteLink`, `inviteUser`, `resolvePeer`, `getSelfUserId` |
| `backend/src/telegram/auto-invite.js` | Orchestration `runAutoInviteForChat` |
| `backend/src/telegram/inbound.js` | Fire async trigger on bot join |
| `backend/src/config.js` | `telegramApiId`, `telegramApiHash`, `telegramUserSession` |
| `backend/src/routes/telegram.js` | Members CRUD, session status, force retry |
| `frontend/src/pages/Telegram.jsx` + `api.js` | «Авто-добавление» section |
| `.env.example` + `docker-compose.yml` | Pass new env vars |
| `backend/scripts/telegram-userbot-login.mjs` | One-shot StringSession generator |
| `ops/telegram-userbot.md` | Ops notes for api_id/session/Dokploy |

---

### Task 1: Schema + auto-invite store

**Files:**
- Modify: `backend/src/db/schema.sql`
- Modify: `backend/src/db/migrate.js` (same DDL after `telegram_topics`)
- Create: `backend/src/telegram/auto-invite-store.js`
- Create: `backend/tests/telegram-auto-invite-store.test.js`

**Interfaces:**
- Produces:
  - `normalizeUsername(raw) → string|null` — strip `@`, trim, lower for storage compare; store without `@`
  - `upsertAutoInviteMember(db, { username?, userId?, displayName?, active? }) → row`
  - `listAutoInviteMembers(db, { activeOnly?: boolean }) → rows[]`
  - `updateAutoInviteMember(db, id, patch) → row|null`
  - `deleteAutoInviteMember(db, id) → boolean`
  - `tryBeginAutoInviteRun(db, chatId) → { started: true } | { started: false, reason, existing }`
  - `finishAutoInviteRun(db, chatId, { status, detail })`
  - `getAutoInviteRun(db, chatId) → row|null`
  - `resetAutoInviteRun(db, chatId)` — delete row for force retry

- [ ] **Step 1: Write failing tests**

```js
// backend/tests/telegram-auto-invite-store.test.js
import { describe, expect, it, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  normalizeUsername,
  upsertAutoInviteMember,
  listAutoInviteMembers,
  tryBeginAutoInviteRun,
  finishAutoInviteRun,
  resetAutoInviteRun,
} from '../src/telegram/auto-invite-store.js';

function memDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE telegram_auto_invite_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT,
      user_id TEXT,
      display_name TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE telegram_auto_invite_runs (
      chat_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT,
      detail_json TEXT
    );
  `);
  return db;
}

describe('normalizeUsername', () => {
  it('strips @ and trims', () => {
    expect(normalizeUsername('@Foo_Bar')).toBe('Foo_Bar');
    expect(normalizeUsername('  x  ')).toBe('x');
    expect(normalizeUsername('')).toBeNull();
  });
});

describe('members', () => {
  let db;
  beforeEach(() => { db = memDb(); });

  it('rejects empty username and userId', () => {
    expect(() => upsertAutoInviteMember(db, {})).toThrow(/username|user/i);
  });

  it('inserts and lists active members', () => {
    upsertAutoInviteMember(db, { username: '@Alice', displayName: 'A' });
    upsertAutoInviteMember(db, { userId: '42', active: false });
    expect(listAutoInviteMembers(db, { activeOnly: true })).toHaveLength(1);
    expect(listAutoInviteMembers(db, { activeOnly: false })).toHaveLength(2);
  });
});

describe('runs idempotency', () => {
  let db;
  beforeEach(() => { db = memDb(); });

  it('allows first begin, blocks success/partial, allows after reset', () => {
    expect(tryBeginAutoInviteRun(db, '-1001').started).toBe(true);
    finishAutoInviteRun(db, '-1001', { status: 'success', detail: { ok: true } });
    expect(tryBeginAutoInviteRun(db, '-1001').started).toBe(false);
    resetAutoInviteRun(db, '-1001');
    expect(tryBeginAutoInviteRun(db, '-1001').started).toBe(true);
  });

  it('retries failed runs', () => {
    tryBeginAutoInviteRun(db, '-1002');
    finishAutoInviteRun(db, '-1002', { status: 'failed', detail: { error: 'x' } });
    expect(tryBeginAutoInviteRun(db, '-1002').started).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd backend && npm test -- telegram-auto-invite-store.test.js
```

Expected: FAIL (module missing)

- [ ] **Step 3: Add DDL to `schema.sql` and `migrate.js`**

```sql
CREATE TABLE IF NOT EXISTS telegram_auto_invite_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT,
  user_id TEXT,
  display_name TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS telegram_auto_invite_runs (
  chat_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at TEXT,
  detail_json TEXT
);
```

- [ ] **Step 4: Implement `auto-invite-store.js`**

`tryBeginAutoInviteRun` rules:
- No row → INSERT `pending`, `started: true`
- `failed` → UPDATE to `pending`, clear finished/detail, `started: true`
- `pending` older than 15 minutes → treat as retry (UPDATE to pending, `started: true`)
- `success` | `partial` | fresh `pending` → `started: false`

`upsertAutoInviteMember`: require `username || userId`; normalize username; set `updated_at`.

- [ ] **Step 5: Run tests — expect PASS**

```bash
cd backend && npm test -- telegram-auto-invite-store.test.js
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/db/schema.sql backend/src/db/migrate.js backend/src/telegram/auto-invite-store.js backend/tests/telegram-auto-invite-store.test.js
git commit -m "feat(telegram): auto-invite members and run store"
```

---

### Task 2: Bot admin helpers (invite link + promote)

**Files:**
- Create: `backend/src/telegram/bot-admin.js`
- Create: `backend/tests/telegram-bot-admin.test.js`
- Consumes: `callTelegram` from `backend/src/telegram/api-client.js`

**Interfaces:**
- Produces:
  - `createChatInviteLink(token, chatId, { fetchImpl }) → { inviteLink: string }`
  - `promoteChatMemberForInvite(token, chatId, userId, { fetchImpl }) → void`
- Uses Bot API methods `createChatInviteLink`, `promoteChatMember` with `can_invite_users: true` (other can_* false/omit as Telegram allows).

- [ ] **Step 1: Failing tests** with mock `fetchImpl` asserting URL/body and returning `{ ok: true, result: { invite_link: 'https://t.me/+x' } }`.

- [ ] **Step 2: Implement `bot-admin.js`**

```js
import { callTelegram } from './api-client.js';

export async function createChatInviteLink(token, chatId, { fetchImpl } = {}) {
  const result = await callTelegram(
    token,
    'createChatInviteLink',
    {
      chat_id: chatId,
      name: 'auto-invite',
      member_limit: 10,
    },
    fetchImpl,
  );
  return { inviteLink: result.invite_link };
}

export async function promoteChatMemberForInvite(token, chatId, userId, { fetchImpl } = {}) {
  await callTelegram(
    token,
    'promoteChatMember',
    {
      chat_id: chatId,
      user_id: Number(userId),
      can_invite_users: true,
      can_manage_chat: false,
      can_delete_messages: false,
      can_restrict_members: false,
      can_promote_members: false,
      can_change_info: false,
      can_pin_messages: false,
      can_manage_video_chats: false,
    },
    fetchImpl,
  );
}
```

Note: if `callTelegram` signature differs (outbound uses another shape), adapt to existing `api-client.js` — do not duplicate HTTP wrappers.

- [ ] **Step 3: Tests PASS → commit**

```bash
git commit -m "feat(telegram): bot invite link and promote helpers"
```

---

### Task 3: User-bot actions (injectable port + GramJS adapter)

**Files:**
- Create: `backend/src/telegram/userbot/actions.js` (port functions taking `client` deps)
- Create: `backend/src/telegram/userbot/client.js` (lazy GramJS from config)
- Modify: `backend/src/config.js` — `telegramApiId`, `telegramApiHash`, `telegramUserSession`
- Modify: `backend/package.json` — add dependency `telegram`
- Create: `backend/tests/telegram-userbot-actions.test.js`
- Modify: `.env.example`

**Interfaces:**
- Produces:
  - `isUserbotConfigured(config) → boolean`
  - `getUserbotClient()` → GramJS client | throws if missing config
  - `joinChatByInviteLink(client, inviteLink) → void`
  - `resolveUser(client, { userId?, username? }) → { userId: string, username?: string }`
  - `inviteUserToChat(client, chatId, userId) → void`
  - `getSelfUserId(client) → string`

Design for TDD: export pure wrappers that call `client.invoke(...)` / methods on an injected fake client in tests — real GramJS only in `client.js`.

- [ ] **Step 1: Add dependency**

```bash
cd backend && npm install telegram
```

- [ ] **Step 2: Failing tests** with fake client:

```js
it('resolveUser prefers userId', async () => {
  const client = { getEntity: vi.fn(async () => ({ id: 99n, username: 'x' })) };
  const r = await resolveUser(client, { userId: '99' });
  expect(r.userId).toBe('99');
});

it('joinChatByInviteLink extracts invite hash and calls import', async () => {
  // fake invoke recording Api.messages.ImportChatInvite
});
```

Implement invite join by parsing `https://t.me/+HASH` / `t.me/joinchat/HASH` and calling GramJS `ImportChatInvite` / `JoinChatInvite` as required by library version.

- [ ] **Step 3: Implement client singleton**

```js
// client.js sketch
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { config } from '../../config.js';

let clientPromise;

export function isUserbotConfigured(cfg = config) {
  return Boolean(cfg.telegramApiId && cfg.telegramApiHash && cfg.telegramUserSession);
}

export async function getUserbotClient() {
  if (!isUserbotConfigured()) throw Object.assign(new Error('userbot not configured'), { status: 503 });
  if (!clientPromise) {
    const session = new StringSession(config.telegramUserSession);
    const client = new TelegramClient(session, Number(config.telegramApiId), config.telegramApiHash, {
      connectionRetries: 3,
    });
    clientPromise = client.connect().then(() => client);
  }
  return clientPromise;
}
```

- [ ] **Step 4: Config + `.env.example`**

```js
telegramApiId: process.env.TELEGRAM_API_ID || '',
telegramApiHash: process.env.TELEGRAM_API_HASH || '',
telegramUserSession: process.env.TELEGRAM_USER_SESSION || '',
```

- [ ] **Step 5: Tests PASS → commit**

```bash
git commit -m "feat(telegram): GramJS userbot client and actions"
```

---

### Task 4: Orchestration `runAutoInviteForChat`

**Files:**
- Create: `backend/src/telegram/auto-invite.js`
- Create: `backend/tests/telegram-auto-invite.test.js`

**Interfaces:**
- Consumes: store, `getTelegramBotToken`, bot-admin, userbot actions
- Produces:
  - `runAutoInviteForChat(db, chatId, { force?: boolean, deps? }) → { status, detail }`
  - `scheduleAutoInvite(db, chatId)` — `setImmediate(() => run...).unref?.()` with error log

Deps injectable for tests:

```js
{
  getToken,
  createInviteLink,
  promote,
  getClient,
  joinInvite,
  resolveUser,
  inviteUser,
  getSelfUserId,
  listMembers, // default listAutoInviteMembers activeOnly
}
```

Flow:
1. If `force` → `resetAutoInviteRun`
2. `tryBeginAutoInviteRun` — if not started, return existing
3. If `!isUserbotConfigured` → finish `failed` `{ error: 'userbot not configured' }`
4. `createInviteLink` → `joinInvite` → `getSelfUserId` → `promote`
5. For each active member: resolve (persist `user_id` via `updateAutoInviteMember` when resolved), invite; catch privacy → per-user `failed`
6. Aggregate: any hard step fail before invites → `failed`; any member fail → `partial`; else `success`
7. Always `finishAutoInviteRun`

- [ ] **Step 1: Failing orchestration tests** (happy path + privacy partial + skip when success exists + force retry)

- [ ] **Step 2: Implement `auto-invite.js`**

- [ ] **Step 3: PASS → commit**

```bash
git commit -m "feat(telegram): auto-invite orchestration"
```

---

### Task 5: Webhook trigger + HTTP API

**Files:**
- Modify: `backend/src/telegram/inbound.js`
- Modify: `backend/src/routes/telegram.js`
- Modify: `frontend/src/api.js` (hooks)
- Create: `backend/tests/telegram-auto-invite-routes.test.js` (supertest or handler-level)

**Interfaces:**
- On `my_chat_member` after upsert chat: if status in MEMBER_OK and chat.type in `group|supergroup` → `scheduleAutoInvite(db, String(chat.id))`
- Routes:
  - `GET /api/telegram/auto-invite/status` → `{ configured: boolean }` (never session)
  - `GET /api/telegram/auto-invite/members`
  - `POST /api/telegram/auto-invite/members` body `{ username?, userId?, displayName? }`
  - `PATCH /api/telegram/auto-invite/members/:id` body patch
  - `DELETE /api/telegram/auto-invite/members/:id`
  - `POST /api/telegram/auto-invite/runs/:chatId/retry` → `runAutoInviteForChat(..., { force: true })`

- [ ] **Step 1: Tests for schedule called on join; routes CRUD; status hides secrets**

- [ ] **Step 2: Wire inbound + routes**

- [ ] **Step 3: PASS → commit**

```bash
git commit -m "feat(telegram): auto-invite webhook trigger and API"
```

---

### Task 6: Frontend «Авто-добавление»

**Files:**
- Modify: `frontend/src/pages/Telegram.jsx`
- Modify: `frontend/src/api.js`

**UI:**
- Section after Bot (before Chats): title «Авто-добавление»
- If `!configured`: warning «Задайте TELEGRAM_API_ID / HASH / USER_SESSION на сервере»
- Else: table of members + form (username, user_id, name) + active checkbox + delete
- Hint text: боту нужны права Invite users и Add new admins; privacy может блокировать инвайт
- Optional small «Retry chat_id» input + button calling retry endpoint

- [ ] **Step 1: Implement UI + hooks** (follow existing Telegram.jsx patterns / React Query style in `api.js`)

- [ ] **Step 2: `npm run build` in frontend — expect success**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(telegram): auto-invite members UI on /telegram"
```

---

### Task 7: Ops — login script, compose env, staging checklist

**Files:**
- Create: `backend/scripts/telegram-userbot-login.mjs` (interactive phone login → print StringSession; uses dotenv locally)
- Create: `ops/telegram-userbot.md`
- Modify: `docker-compose.yml` — pass `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_USER_SESSION`
- Modify: Dokploy raw compose for `crmparser-staging` the same way (ops step, not necessarily in git if raw-only)

**Login script behavior:**
- Read `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` from env
- Prompt phone + code (+ 2FA if needed)
- Print session string once; exit
- Document: run only on trusted machine; paste into Dokploy secrets

**Staging checklist (manual):**
1. Set secrets on Dokploy; ensure compose `environment` includes the three vars (same pitfall as `PUBLIC_BASE_URL`)
2. Redeploy
3. `/telegram` shows configured=true; add 1–2 test members
4. Create test group; add bot as admin with Invite + Add admins
5. Expect user-bot + members join; run status success/partial in DB or via retry API
6. Re-add event does not duplicate (idempotent)

- [ ] **Step 1: Script + ops doc + compose**

- [ ] **Step 2: Commit (no secrets)**

```bash
git commit -m "docs(ops): telegram userbot session setup and compose env"
```

- [ ] **Step 3: Human/ops sets Dokploy secrets and verifies staging** (report in `.superpowers/sdd/` if using SDD ledger)

---

## Spec coverage check

| Spec item | Task |
|-----------|------|
| Trigger on bot join | 5 |
| Invite link → join → promote → invite | 2, 3, 4 |
| User-bot stays | 4 (no leave call) |
| Members UI username/id | 1, 6 |
| Resolve persist user_id | 4 |
| Idempotency + force retry | 1, 4, 5 |
| Secrets / no frontend leak | 3, 5, 7 |
| Staging ops | 7 |
| Privacy soft-fail | 4 |

## Placeholder / consistency scan

- Table names fixed: `telegram_auto_invite_members`, `telegram_auto_invite_runs`
- Function names aligned across tasks: `runAutoInviteForChat`, `tryBeginAutoInviteRun`, `scheduleAutoInvite`
- Env names: `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_USER_SESSION`
