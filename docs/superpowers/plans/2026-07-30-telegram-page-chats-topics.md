# Telegram page: chats, topics, webhook discovery — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Telegram into a crmparser sidebar page with webhook chat/topic discovery and okleyka destination `{ chatId, threadId? }`.

**Architecture:** SQLite caches chats/topics from a real webhook handler; settings store object destinations; outbound passes `message_thread_id`; frontend route `/telegram` replaces Settings tab.

**Tech Stack:** Node ESM, Express, better-sqlite3, Vitest, React (Vite), Telegram Bot HTTP API.

**Spec:** `docs/superpowers/specs/2026-07-30-telegram-page-chats-topics-design.md`

## Global Constraints

- Scope v1: only event `okleyka.send` (one chat + optional topic).
- No MTProto / long polling — HTTPS webhook only via `PUBLIC_BASE_URL`.
- Forum General topic = `threadId: 1`; non-forum chats omit `threadId`.
- Bot API cannot list all chats/topics — discovery via updates + manual add.
- TwentyView API unchanged; thread comes from parser settings.
- Work on branch `staging` in `crmparserv2`.
- TDD: failing test → implement → pass → commit per task.
- Do not commit secrets; do not push unless asked.

## File map

| File | Responsibility |
|------|----------------|
| `backend/src/db/migrate.js` + `schema.sql` | `telegram_chats`, `telegram_topics` |
| `backend/src/telegram/settings.js` | Token + destination parse/normalize |
| `backend/src/telegram/chat-store.js` | Upsert/list chats & topics |
| `backend/src/telegram/inbound.js` | Webhook update → store |
| `backend/src/telegram/outbound.js` | Optional `message_thread_id` |
| `backend/src/telegram/handle-okleyka-send.js` | Use destination object |
| `backend/src/telegram/api-client.js` | Shared Telegram HTTP helpers |
| `backend/src/routes/telegram.js` | Settings, chats, webhook admin, tests |
| `backend/src/config.js` | `publicBaseUrl` |
| `frontend/src/pages/Telegram.jsx` | New page |
| `frontend/src/App.jsx` + `Icons.jsx` | Nav + route |
| `frontend/src/pages/Settings.jsx` | Remove telegram tab + redirect |
| `frontend/src/api.js` | Hooks for new endpoints |
| `.env.example` + `docker-compose.yml` | `PUBLIC_BASE_URL` |

---

### Task 1: Destination settings (`getTelegramDestination`)

**Files:**
- Modify: `backend/src/telegram/settings.js`
- Modify: `backend/tests/telegram-send-log.test.js` (destination assertions)
- Create: `backend/tests/telegram-destination.test.js`

**Interfaces:**
- Produces:
  - `normalizeOkleykaDestination(raw) → { chatId: string, threadId: number|null } | null`
  - `getTelegramDestination(db, event) → { chatId: string, threadId: number|null } | null`
  - `getTelegramChatId(db, event) → string` — returns `getTelegramDestination(...)?.chatId ?? ''`

- [ ] **Step 1: Write failing tests**

```js
// backend/tests/telegram-destination.test.js
import { describe, expect, it } from 'vitest';
import { normalizeOkleykaDestination } from '../src/telegram/settings.js';

describe('normalizeOkleykaDestination', () => {
  it('parses legacy string chat id', () => {
    expect(normalizeOkleykaDestination('-1001')).toEqual({ chatId: '-1001', threadId: null });
  });
  it('parses object with threadId', () => {
    expect(normalizeOkleykaDestination({ chatId: '-1001', threadId: 42 })).toEqual({
      chatId: '-1001',
      threadId: 42,
    });
  });
  it('returns null for empty', () => {
    expect(normalizeOkleykaDestination('')).toBeNull();
    expect(normalizeOkleykaDestination(null)).toBeNull();
    expect(normalizeOkleykaDestination({ chatId: '' })).toBeNull();
  });
  it('coerces numeric threadId strings', () => {
    expect(normalizeOkleykaDestination({ chatId: '-1', threadId: '7' })).toEqual({
      chatId: '-1',
      threadId: 7,
    });
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd backend && npm test -- telegram-destination.test.js
```

Expected: FAIL (export missing / not a function)

- [ ] **Step 3: Implement in `settings.js`**

```js
export function normalizeOkleykaDestination(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'string') {
    const chatId = raw.trim();
    return chatId ? { chatId, threadId: null } : null;
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const chatId = String(raw.chatId ?? '').trim();
    if (!chatId) return null;
    let threadId = null;
    if (raw.threadId != null && raw.threadId !== '') {
      const n = Number(raw.threadId);
      if (Number.isInteger(n) && n > 0) threadId = n;
    }
    return { chatId, threadId };
  }
  return null;
}

export function getTelegramDestination(db, event) {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'telegram_chat_map'`).get();
  if (!row?.value) return null;
  try {
    const map = JSON.parse(row.value);
    return normalizeOkleykaDestination(map?.[event]);
  } catch {
    return null;
  }
}

export function getTelegramChatId(db, event) {
  return getTelegramDestination(db, event)?.chatId ?? '';
}
```

Keep existing `getTelegramBotToken`.

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd backend && npm test -- telegram-destination.test.js telegram-send-log.test.js
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/telegram/settings.js backend/tests/telegram-destination.test.js backend/tests/telegram-send-log.test.js
git commit -m "$(cat <<'EOF'
feat(telegram): normalize okleyka destination chatId+threadId

EOF
)"
```

---

### Task 2: SQLite chat/topic store

**Files:**
- Modify: `backend/src/db/migrate.js`
- Modify: `backend/src/db/schema.sql`
- Create: `backend/src/telegram/chat-store.js`
- Create: `backend/tests/telegram-chat-store.test.js`

**Interfaces:**
- Produces:
  - `upsertTelegramChat(db, { chatId, title, type, isForum, username, active, source })`
  - `upsertTelegramTopic(db, { chatId, threadId, name, source })`
  - `listTelegramChats(db, { activeOnly = true }) → rows`
  - `listTelegramTopics(db, chatId) → rows`

- [ ] **Step 1: Write failing store tests** (in-memory better-sqlite3)

```js
import Database from 'better-sqlite3';
import { describe, expect, it, beforeEach } from 'vitest';
import {
  upsertTelegramChat,
  upsertTelegramTopic,
  listTelegramChats,
  listTelegramTopics,
} from '../src/telegram/chat-store.js';

function openDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE telegram_chats (
      chat_id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT '',
      is_forum INTEGER NOT NULL DEFAULT 0,
      username TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      source TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );
    CREATE TABLE telegram_topics (
      chat_id TEXT NOT NULL,
      thread_id INTEGER NOT NULL,
      name TEXT,
      source TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      PRIMARY KEY (chat_id, thread_id)
    );
  `);
  return db;
}

describe('telegram chat-store', () => {
  let db;
  beforeEach(() => { db = openDb(); });

  it('upserts chat and lists active only', () => {
    upsertTelegramChat(db, {
      chatId: '-100', title: 'A', type: 'supergroup', isForum: true,
      username: null, active: true, source: 'webhook',
    });
    upsertTelegramChat(db, {
      chatId: '-200', title: 'B', type: 'group', isForum: false,
      username: null, active: false, source: 'manual',
    });
    expect(listTelegramChats(db, { activeOnly: true })).toHaveLength(1);
    expect(listTelegramChats(db, { activeOnly: false })).toHaveLength(2);
  });

  it('upserts topics per chat', () => {
    upsertTelegramChat(db, {
      chatId: '-100', title: 'A', type: 'supergroup', isForum: true,
      username: null, active: true, source: 'webhook',
    });
    upsertTelegramTopic(db, { chatId: '-100', threadId: 3, name: 'Ops', source: 'webhook' });
    upsertTelegramTopic(db, { chatId: '-100', threadId: 3, name: 'Ops2', source: 'webhook' });
    const topics = listTelegramTopics(db, '-100');
    expect(topics).toHaveLength(1);
    expect(topics[0].name).toBe('Ops2');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd backend && npm test -- telegram-chat-store.test.js
```

- [ ] **Step 3: Implement `chat-store.js` + migration DDL**

In `migrate.js` (after telegram_send_log block) and `schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS telegram_chats (
  chat_id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT '',
  is_forum INTEGER NOT NULL DEFAULT 0,
  username TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL,
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS telegram_topics (
  chat_id TEXT NOT NULL,
  thread_id INTEGER NOT NULL,
  name TEXT,
  source TEXT NOT NULL,
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (chat_id, thread_id)
);
```

Implement upserts with `INSERT ... ON CONFLICT DO UPDATE`, set `last_seen_at` to `datetime('now')`. On topic name: if incoming name is empty, preserve existing non-empty name.

- [ ] **Step 4: Run — expect PASS**

```bash
cd backend && npm test -- telegram-chat-store.test.js
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/db/migrate.js backend/src/db/schema.sql backend/src/telegram/chat-store.js backend/tests/telegram-chat-store.test.js
git commit -m "$(cat <<'EOF'
feat(telegram): add chats/topics SQLite store

EOF
)"
```

---

### Task 3: Webhook inbound discovery

**Files:**
- Modify: `backend/src/telegram/inbound.js`
- Create: `backend/tests/telegram-inbound.test.js`

**Interfaces:**
- Consumes: `upsertTelegramChat`, `upsertTelegramTopic`
- Produces: `processTelegramUpdate(db, update) → void`; `handleTelegramWebhook(req, res)`

- [ ] **Step 1: Write failing tests for `processTelegramUpdate`**

Cover:
1. `my_chat_member` member → active chat
2. `my_chat_member` left → `active=0`
3. `message` with `forum_topic_created` → topic with name
4. `message` with `is_topic_message` + `message_thread_id` → topic (name may be null)

Use in-memory schema from Task 2.

- [ ] **Step 2: Run — expect FAIL**

```bash
cd backend && npm test -- telegram-inbound.test.js
```

- [ ] **Step 3: Implement**

```js
import { getDb } from '../db/connection.js';
import { upsertTelegramChat, upsertTelegramTopic } from './chat-store.js';

const MEMBER_OK = new Set(['member', 'administrator', 'creator']);

export function processTelegramUpdate(db, update) {
  if (update.my_chat_member) {
    const m = update.my_chat_member;
    const chat = m.chat;
    const status = m.new_chat_member?.status;
    upsertTelegramChat(db, {
      chatId: String(chat.id),
      title: chat.title || chat.username || '',
      type: chat.type || '',
      isForum: Boolean(chat.is_forum),
      username: chat.username || null,
      active: MEMBER_OK.has(status),
      source: 'webhook',
    });
    return;
  }
  const msg = update.message || update.channel_post;
  if (!msg?.chat) return;
  const chat = msg.chat;
  upsertTelegramChat(db, {
    chatId: String(chat.id),
    title: chat.title || chat.username || '',
    type: chat.type || '',
    isForum: Boolean(chat.is_forum),
    username: chat.username || null,
    active: true,
    source: 'webhook',
  });
  const created = msg.forum_topic_created;
  const edited = msg.forum_topic_edited;
  if ((created || edited) && msg.message_thread_id) {
    upsertTelegramTopic(db, {
      chatId: String(chat.id),
      threadId: msg.message_thread_id,
      name: created?.name || edited?.name || null,
      source: 'webhook',
    });
  } else if (msg.is_topic_message && msg.message_thread_id) {
    upsertTelegramTopic(db, {
      chatId: String(chat.id),
      threadId: msg.message_thread_id,
      name: null,
      source: 'webhook',
    });
  }
}

export function handleTelegramWebhook(req, res) {
  const db = getDb();
  const secretRow = db
    .prepare(`SELECT value FROM settings WHERE key = 'telegram_webhook_secret'`)
    .get();
  const expected = (secretRow?.value ?? '').trim();
  if (expected) {
    const got = req.get('X-Telegram-Bot-Api-Secret-Token') || '';
    if (got !== expected) return res.status(401).json({ ok: false, error: 'invalid secret' });
  }
  try {
    processTelegramUpdate(db, req.body || {});
  } catch (err) {
    console.error('[telegram] webhook process error:', err.message);
  }
  return res.json({ ok: true });
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd backend && npm test -- telegram-inbound.test.js
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/telegram/inbound.js backend/tests/telegram-inbound.test.js
git commit -m "$(cat <<'EOF'
feat(telegram): discover chats/topics from webhook updates

EOF
)"
```

---

### Task 4: Outbound `message_thread_id` + okleyka handler

**Files:**
- Modify: `backend/src/telegram/outbound.js`
- Modify: `backend/src/telegram/handle-okleyka-send.js`
- Modify: `backend/src/routes/telegram.js` (`test-send`)
- Modify: `backend/tests/telegram-outbound.test.js`
- Modify: `backend/tests/telegram-okleyka-send.test.js` if needed

**Interfaces:**
- Consumes: `getTelegramDestination`
- Produces: `sendOkleykaToTelegram({ ..., threadId? })` adds `message_thread_id` when positive int

- [ ] **Step 1: Failing outbound test**

```js
it('passes message_thread_id when threadId set', async () => {
  const fetchImpl = vi.fn(async () => ({
    ok: true,
    json: async () => ({ ok: true, result: { message_id: 1 } }),
  }));
  await sendOkleykaToTelegram({
    token: 't', chatId: '-1', threadId: 9, text: 'hi', fileUrls: [], fetchImpl,
  });
  const body = JSON.parse(fetchImpl.mock.calls[0][1].body);
  expect(body.message_thread_id).toBe(9);
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd backend && npm test -- telegram-outbound.test.js
```

- [ ] **Step 3: Implement**

In `sendTextMessage` / `sendPhotoAlbum`, accept `threadId` and if `Number.isInteger(threadId) && threadId > 0`, add `message_thread_id: threadId` to JSON body and FormData (`form.append('message_thread_id', String(threadId))`).

Update `handleOkleykaSend`:

```js
const dest = getTelegramDestination(db, event);
if (!token || !dest?.chatId) throw configError('Telegram не настроен');
const { chatId, threadId } = dest;
await sendOkleyka({ token, chatId, threadId, text, fileUrls });
```

Update `routes/telegram.js` `test-send` the same way.

- [ ] **Step 4: Run related tests — PASS**

```bash
cd backend && npm test -- telegram-outbound.test.js telegram-okleyka-send.test.js
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/telegram/outbound.js backend/src/telegram/handle-okleyka-send.js backend/src/routes/telegram.js backend/tests/telegram-outbound.test.js backend/tests/telegram-okleyka-send.test.js
git commit -m "$(cat <<'EOF'
feat(telegram): send okleyka into forum topic via message_thread_id

EOF
)"
```

---

### Task 5: Telegram HTTP API routes (chats, webhook admin, settings shape)

**Files:**
- Create: `backend/src/telegram/api-client.js`
- Modify: `backend/src/routes/telegram.js`
- Modify: `backend/src/config.js` — `publicBaseUrl: (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '')`
- Modify: `.env.example`, `docker-compose.yml` (pass `PUBLIC_BASE_URL`)
- Create: `backend/tests/telegram-chat-map-merge.test.js`

**Interfaces:**
- `GET /api/telegram/chats?active=1`
- `GET /api/telegram/chats/:chatId/topics`
- `POST /api/telegram/chats` body `{ chatId }` → getChat + upsert manual
- `POST /api/telegram/chats/:chatId/topics` body `{ threadId, name? }`
- `GET /api/telegram/webhook/status`
- `POST /api/telegram/webhook/setup`
- `POST /api/telegram/webhook/teardown`
- `PUT /api/telegram/settings` — normalize `okleyka.send` via `mergeChatMapEntry`

- [ ] **Step 1: Unit test for chat map merge**

```js
import { describe, expect, it } from 'vitest';
import { mergeChatMapEntry } from '../src/telegram/settings.js';

describe('mergeChatMapEntry', () => {
  it('stores object destination for okleyka.send', () => {
    expect(mergeChatMapEntry({}, { 'okleyka.send': { chatId: '-1', threadId: 1 } })).toEqual({
      'okleyka.send': { chatId: '-1', threadId: 1 },
    });
  });
  it('normalizes legacy string', () => {
    expect(mergeChatMapEntry({}, { 'okleyka.send': '-100' })).toEqual({
      'okleyka.send': { chatId: '-100' },
    });
  });
});
```

Implement `mergeChatMapEntry` next to `normalizeOkleykaDestination`.

- [ ] **Step 2: Implement `api-client.js` + routes**

```js
export async function callTelegram(token, method, body, fetchImpl = globalThis.fetch) {
  const resp = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const data = await resp.json();
  if (!data.ok) {
    const err = new Error(data.description || 'Telegram API error');
    err.status = 502;
    throw err;
  }
  return data.result;
}
```

`setup`:
1. If `!config.publicBaseUrl` → 400 `{ error: 'PUBLIC_BASE_URL not set' }`
2. Ensure secret (`crypto.randomBytes(24).toString('hex')` if empty)
3. `setWebhook({ url: `${publicBaseUrl}/api/telegram/webhook`, secret_token, allowed_updates: ['message','channel_post','my_chat_member'] })`

Status returns `{ publicBaseUrlConfigured, webhookUrl, secretSet, telegram?: getWebhookInfo }`.

- [ ] **Step 3: Run backend tests**

```bash
cd backend && npm test
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/telegram/api-client.js backend/src/routes/telegram.js backend/src/config.js backend/src/telegram/settings.js .env.example docker-compose.yml backend/tests/telegram-chat-map-merge.test.js
git commit -m "$(cat <<'EOF'
feat(telegram): chats API and webhook setup/teardown endpoints

EOF
)"
```

---

### Task 6: Frontend `/telegram` page + nav

**Files:**
- Create: `frontend/src/pages/Telegram.jsx`
- Modify: `frontend/src/App.jsx` — nav item + route
- Modify: `frontend/src/components/ui/Icons.jsx` — `/telegram` icon
- Modify: `frontend/src/api.js` — hooks
- Modify: `frontend/src/pages/Settings.jsx` — remove tab; redirect `tab=telegram`

**api.js hooks:**
- `useTelegramChats(activeOnly)`
- `useTelegramTopics(chatId)`
- `useAddTelegramChat()` / `useAddTelegramTopic()`
- `useTelegramWebhookStatus()`
- `useSetupTelegramWebhook()` / `useTeardownTelegramWebhook()`

- [ ] **Step 1: Route + nav + page shell** (`PageHeader` + three sections)

- [ ] **Step 2: Bot section** — token, getMe, webhook status/setup/teardown

- [ ] **Step 3: Chats section** — list, inactive toggle, manual add

- [ ] **Step 4: Okleyka section** — chat select; if forum, topic select with **General (thread 1)**; save object destination; test send

```js
function readOkleykaDest(chatMap) {
  const raw = chatMap?.['okleyka.send'];
  if (!raw) return { chatId: '', threadId: '' };
  if (typeof raw === 'string') return { chatId: raw, threadId: '' };
  return {
    chatId: raw.chatId || '',
    threadId: raw.threadId != null ? String(raw.threadId) : '',
  };
}
```

For forum save: require `threadId` (default `'1'` if unset). For non-forum: omit `threadId` key.

- [ ] **Step 5: Settings cleanup + redirect**

```js
useEffect(() => {
  if (params.get('tab') === 'telegram') navigate('/telegram', { replace: true });
}, [params, navigate]);
```

Remove `{ id: 'telegram', ... }` from tabs and `{activeTab === 'telegram' && ...}`.

- [ ] **Step 6: Build frontend**

```bash
cd frontend && npm run build
```

Expected: success

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/Telegram.jsx frontend/src/App.jsx frontend/src/components/ui/Icons.jsx frontend/src/api.js frontend/src/pages/Settings.jsx
git commit -m "$(cat <<'EOF'
feat(telegram): sidebar page with chat/topic picker

EOF
)"
```

---

### Task 7: Staging `PUBLIC_BASE_URL` + verify

**Files:** Dokploy env only (unless docs already touched in Task 5)

- [ ] **Step 1: Set on `crmparser-staging`**

```
PUBLIC_BASE_URL=https://<public-staging-crmparser-host>
```

Redeploy compose.

- [ ] **Step 2: Manual verify**

1. Open `/telegram` on staging  
2. Save token → Setup webhook  
3. Add bot to forum group; post in a topic  
4. Chat + topic appear  
5. Select destination → Test send lands in topic  

- [ ] **Step 3:** No git commit for env-only change; note URL in PR/chat when done.

---

## Spec coverage checklist

| Spec item | Task |
|-----------|------|
| Sidebar `/telegram`, remove Settings tab, soft redirect | 6 |
| Tables `telegram_chats` / `telegram_topics` | 2 |
| Destination object + legacy string | 1, 5 |
| Webhook process + secret | 3, 5 |
| Discovery update types | 3 |
| setWebhook / deleteWebhook + PUBLIC_BASE_URL | 5, 7 |
| Manual chat/topic add | 5, 6 |
| List APIs | 5 |
| Forum General thread 1 + outbound | 4, 6 |
| Twenty API unchanged | 4 |
| Unit tests | 1–5 |

## Self-review

- Spec sections mapped to tasks; no TBD steps.
- Names `getTelegramDestination` / `normalizeOkleykaDestination` / `mergeChatMapEntry` consistent.
- General topic fixed as `threadId: 1` in UI + outbound rules.
