# Telegram Digest Destination UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate okleyka and morning-digest Telegram destinations in UI and routing so cron/commands always use `digest.morning`, independent of `okleyka.send`.

**Architecture:** Keep `telegram_chat_map` with two keys. Normalize both in `mergeChatMapEntry`. Stop passing invoking-chat ids into `runDigestForDay` from commands (errors still reply in invoke chat). Extend `POST /telegram/test-send` with `event`. Add a mirror UI section on `Telegram.jsx`.

**Tech Stack:** Node ESM, Vitest, Express, React (existing Telegram page + react-query hooks).

## Global Constraints

- Chat map keys: `okleyka.send` and `digest.morning` only for these destinations.
- Destination shape: `{ chatId: string, threadId?: number }` (legacy string chatId normalized).
- Commands `/завтра` / `/послезавтра` always target `digest.morning`; error replies stay in invoking chat.
- Do not put API secrets in git; Omni hint stays text-only in digest section description.
- YAGNI: no shared DestinationPicker component extraction in v1.

## File map

| File | Role |
|------|------|
| `backend/src/telegram/settings.js` | Normalize `digest.morning` in merge |
| `backend/src/telegram/inbound.js` | Commands without chat override |
| `backend/src/routes/telegram.js` | `test-send` event branching |
| `backend/tests/telegram-chat-map-merge.test.js` | Merge tests |
| `backend/tests/telegram-digest-commands.test.js` | Command destination tests |
| `backend/tests/telegram-test-send.test.js` | New route tests |
| `frontend/src/api.js` | `useTestTelegramSend({ event })` |
| `frontend/src/pages/Telegram.jsx` | Second section + okleyka description cleanup |

---

### Task 1: Normalize `digest.morning` in chat map merge

**Files:**
- Modify: `backend/src/telegram/settings.js`
- Test: `backend/tests/telegram-chat-map-merge.test.js`

**Interfaces:**
- Consumes: `normalizeOkleykaDestination(raw)`
- Produces: `mergeChatMapEntry` also normalizes/clears `digest.morning` like `okleyka.send`

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/telegram-chat-map-merge.test.js`:

```js
  it('stores object destination for digest.morning', () => {
    expect(
      mergeChatMapEntry({}, { 'digest.morning': { chatId: '-200', threadId: 3 } }),
    ).toEqual({
      'digest.morning': { chatId: '-200', threadId: 3 },
    });
  });

  it('normalizes legacy string for digest.morning', () => {
    expect(mergeChatMapEntry({}, { 'digest.morning': '-200' })).toEqual({
      'digest.morning': { chatId: '-200' },
    });
  });

  it('preserves okleyka.send when patching digest.morning', () => {
    const existing = { 'okleyka.send': { chatId: '-100', threadId: 1 } };
    expect(
      mergeChatMapEntry(existing, { 'digest.morning': { chatId: '-200', threadId: 9 } }),
    ).toEqual({
      'okleyka.send': { chatId: '-100', threadId: 1 },
      'digest.morning': { chatId: '-200', threadId: 9 },
    });
  });

  it('clears digest.morning when patch is empty or null', () => {
    const existing = { 'digest.morning': { chatId: '-200', threadId: 3 } };
    expect(mergeChatMapEntry(existing, { 'digest.morning': '' })).toEqual({
      'digest.morning': '',
    });
    expect(mergeChatMapEntry(existing, { 'digest.morning': null })).toEqual({
      'digest.morning': '',
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run tests/telegram-chat-map-merge.test.js`

Expected: FAIL — `digest.morning` stored as raw string / not cleared like okleyka.

- [ ] **Step 3: Implement merge for both destination keys**

In `backend/src/telegram/settings.js`, replace the `okleyka.send`-only branch with a shared helper:

```js
const CHAT_DESTINATION_KEYS = new Set(['okleyka.send', 'digest.morning']);

function applyDestinationPatch(result, key, raw) {
  if (raw == null || raw === '') {
    result[key] = '';
    return;
  }
  const normalized = normalizeOkleykaDestination(raw);
  if (normalized) {
    const entry = { chatId: normalized.chatId };
    if (normalized.threadId != null) {
      entry.threadId = normalized.threadId;
    }
    result[key] = entry;
  }
}

export function mergeChatMapEntry(existing, incoming) {
  const result = { ...existing };
  for (const [key, raw] of Object.entries(incoming)) {
    if (CHAT_DESTINATION_KEYS.has(key)) {
      applyDestinationPatch(result, key, raw);
    } else {
      result[key] = raw;
    }
  }
  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run tests/telegram-chat-map-merge.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/telegram/settings.js backend/tests/telegram-chat-map-merge.test.js
git commit -m "feat(telegram): normalize digest.morning in chat map merge"
```

---

### Task 2: Commands always use `digest.morning`

**Files:**
- Modify: `backend/src/telegram/inbound.js`
- Test: `backend/tests/telegram-digest-commands.test.js`

**Interfaces:**
- Consumes: `runDigestForDay({ db, offsetDays })` — omit `chatId`/`threadId` so run resolves `digest.morning`
- Produces: error path still `sendDigestCommandError(db, invokeChatId, invokeThreadId)`

- [ ] **Step 1: Update failing expectations in tests**

In `backend/tests/telegram-digest-commands.test.js`, change the two invoke assertions:

```js
  it('invokes runDigestForDay for /завтра', async () => {
    processTelegramUpdate(testDb, {
      message: {
        chat: { id: -100, title: 'Ops', type: 'supergroup' },
        text: '/завтра',
      },
    });
    await vi.waitFor(() => {
      expect(runDigestForDayMock).toHaveBeenCalledWith({
        db: testDb,
        offsetDays: 1,
      });
    });
  });

  it('invokes runDigestForDay for /послезавтра without invoke thread override', async () => {
    processTelegramUpdate(testDb, {
      message: {
        chat: { id: -100, title: 'Forum', type: 'supergroup', is_forum: true },
        message_thread_id: 42,
        text: '/послезавтра@MyBot',
      },
    });
    await vi.waitFor(() => {
      expect(runDigestForDayMock).toHaveBeenCalledWith({
        db: testDb,
        offsetDays: 2,
      });
    });
  });
```

Keep existing error-reply tests that assert `callTelegram` to invoke chat `-100` — they must still pass.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run tests/telegram-digest-commands.test.js`

Expected: FAIL — still called with `chatId: '-100'`.

- [ ] **Step 3: Change inbound command dispatch**

In `backend/src/telegram/inbound.js`, replace the digest command block with:

```js
  const offset = parseDigestCommand(text);
  if (offset != null) {
    const invokeChatId = String(chat.id);
    const invokeThreadId = msg.message_thread_id || null;
    void runDigestForDay({ db, offsetDays: offset })
      .then((result) => {
        if (result?.ok === false) {
          sendDigestCommandError(db, invokeChatId, invokeThreadId);
        }
      })
      .catch((err) => {
        console.error('[digest] command failed:', err.message);
        sendDigestCommandError(db, invokeChatId, invokeThreadId);
      });
  }
```

Do not pass invoke chat into `runDigestForDay`. `run.js` already falls back to `getTelegramDestination(db, 'digest.morning')` when `chatId` is omitted.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run tests/telegram-digest-commands.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/telegram/inbound.js backend/tests/telegram-digest-commands.test.js
git commit -m "feat(digest): send command digests only to digest.morning"
```

---

### Task 3: `test-send` supports `event`

**Files:**
- Modify: `backend/src/routes/telegram.js` (`POST /test-send`)
- Create: `backend/tests/telegram-test-send.test.js`

**Interfaces:**
- Consumes: `req.body.event` ∈ `okleyka.send` | `digest.morning` (default `okleyka.send`)
- Produces: `{ ok: true }` or 400 with clear error

- [ ] **Step 1: Write the failing route tests**

Create `backend/tests/telegram-test-send.test.js`:

```js
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const callTelegramMock = vi.fn();
const sendOkleykaMock = vi.fn();
const getUserbotClientMock = vi.fn();
const isUserbotConfiguredMock = vi.fn();

vi.mock('../src/telegram/api-client.js', () => ({
  callTelegram: (...args) => callTelegramMock(...args),
  callTelegramGetMe: vi.fn(),
}));

vi.mock('../src/telegram/outbound.js', () => ({
  sendOkleykaToTelegram: (...args) => sendOkleykaMock(...args),
}));

vi.mock('../src/telegram/userbot/client.js', () => ({
  getUserbotClient: (...args) => getUserbotClientMock(...args),
  isUserbotConfigured: (...args) => isUserbotConfiguredMock(...args),
}));

vi.mock('../src/db/connection.js', () => ({
  getDb: () => globalThis.__testSendDb,
}));

function openDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);`);
  return db;
}

describe('POST /telegram/test-send', () => {
  let app;

  beforeEach(async () => {
    vi.clearAllMocks();
    globalThis.__testSendDb = openDb();
    isUserbotConfiguredMock.mockReturnValue(true);
    getUserbotClientMock.mockResolvedValue({});
    sendOkleykaMock.mockResolvedValue(undefined);
    callTelegramMock.mockResolvedValue({});
    vi.resetModules();
    const router = (await import('../src/routes/telegram.js')).default;
    app = express();
    app.use(express.json());
    app.use('/telegram', router);
  });

  it('defaults to okleyka.send via user-bot', async () => {
    globalThis.__testSendDb
      .prepare(`INSERT INTO settings (key, value) VALUES ('telegram_chat_map', ?)`)
      .run(JSON.stringify({ 'okleyka.send': { chatId: '-100', threadId: 1 } }));

    const res = await request(app).post('/telegram/test-send').send({});
    expect(res.status).toBe(200);
    expect(sendOkleykaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: '-100',
        threadId: 1,
        text: 'Тест из crmparser',
      }),
    );
  });

  it('sends digest.morning ping via bot API', async () => {
    globalThis.__testSendDb
      .prepare(`INSERT INTO settings (key, value) VALUES (?, ?), (?, ?)`)
      .run(
        'telegram_bot_token',
        'tok',
        'telegram_chat_map',
        JSON.stringify({ 'digest.morning': { chatId: '-200', threadId: 9 } }),
      );

    const res = await request(app)
      .post('/telegram/test-send')
      .send({ event: 'digest.morning' });
    expect(res.status).toBe(200);
    expect(callTelegramMock).toHaveBeenCalledWith('tok', 'sendMessage', {
      chat_id: '-200',
      text: 'Тест утренней сводки',
      message_thread_id: 9,
    });
    expect(sendOkleykaMock).not.toHaveBeenCalled();
  });

  it('returns 400 when digest.morning missing', async () => {
    globalThis.__testSendDb
      .prepare(`INSERT INTO settings (key, value) VALUES ('telegram_bot_token', ?)`)
      .run('tok');

    const res = await request(app)
      .post('/telegram/test-send')
      .send({ event: 'digest.morning' });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });
});
```

If `supertest` / `express` import patterns differ in this repo, mirror the closest existing route test (e.g. `backend/tests/decor-mk-lists.test.js`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run tests/telegram-test-send.test.js`

Expected: FAIL — digest event ignored / always okleyka path.

- [ ] **Step 3: Implement event branching**

Replace `POST /test-send` handler in `backend/src/routes/telegram.js`:

```js
router.post('/test-send', async (req, res, next) => {
  try {
    const db = getDb();
    const event =
      req.body?.event === 'digest.morning' ? 'digest.morning' : 'okleyka.send';
    const dest = getTelegramDestination(db, event);
    if (!dest?.chatId) {
      return res.status(400).json({
        ok: false,
        error: `${event} chat_id not configured`,
      });
    }

    if (event === 'digest.morning') {
      const token = getTelegramBotToken(db);
      if (!token) {
        return res.status(400).json({ ok: false, error: 'Bot token not configured' });
      }
      const body = {
        chat_id: dest.chatId,
        text: 'Тест утренней сводки',
      };
      if (dest.threadId != null) body.message_thread_id = dest.threadId;
      await callTelegram(token, 'sendMessage', body);
      return res.json({ ok: true });
    }

    if (!isUserbotConfigured(db)) {
      return res.status(400).json({ ok: false, error: 'User-bot not configured' });
    }
    const client = await getUserbotClient(db);
    await sendOkleykaToTelegram({
      client,
      chatId: dest.chatId,
      threadId: dest.threadId,
      text: 'Тест из crmparser',
      fileUrls: [],
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npx vitest run tests/telegram-test-send.test.js`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/telegram.js backend/tests/telegram-test-send.test.js
git commit -m "feat(telegram): test-send event for digest.morning"
```

---

### Task 4: Telegram UI — second destination section

**Files:**
- Modify: `frontend/src/api.js` (`useTestTelegramSend`)
- Modify: `frontend/src/pages/Telegram.jsx`

**Interfaces:**
- Consumes: `PUT /telegram/settings` with `chatMap: { 'digest.morning': entry }`; `POST /telegram/test-send` with `{ event: 'digest.morning' }`
- Produces: independent okleyka vs digest form state

- [ ] **Step 1: Allow event on test-send hook**

In `frontend/src/api.js`:

```js
export function useTestTelegramSend() {
  return useMutation({
    mutationFn: (body = {}) => api.post('/telegram/test-send', body).then((r) => r.data),
  });
}
```

- [ ] **Step 2: Add digest destination state + save/test handlers**

In `Telegram.jsx`:

1. Rename helper usage: keep `readOkleykaDest` or generalize:

```js
function readChatDest(chatMap, key) {
  const raw = chatMap?.[key];
  if (!raw) return { chatId: '', threadId: '' };
  if (typeof raw === 'string') return { chatId: raw, threadId: '' };
  return {
    chatId: raw.chatId || '',
    threadId: raw.threadId != null ? String(raw.threadId) : '',
  };
}
```

2. Add state: `digestChatId`, `digestThreadId` (and reuse or duplicate forum topic helpers for the digest-selected chat — mirror okleyka: `useTelegramTopics` when selected digest chat `isForum`).

3. `useEffect` load from `telegramSettings?.chatMap` via `readChatDest(map, 'digest.morning')`.

4. `saveDigestDest` — same validation as `saveOkleykaDest`, but:

```js
await updateTelegramSettings.mutateAsync({
  chatMap: { 'digest.morning': entry },
});
```

5. `onTestDigestSend`:

```js
await testTelegramSend.mutateAsync({ event: 'digest.morning' });
```

6. Keep okleyka test as `mutateAsync()` or `mutateAsync({})`.

- [ ] **Step 3: Split sections in JSX**

- **Оклейка → отправка** `description`: only okleyka (remove digest/Omni text). Example:

```text
Куда user-bot отправляет сообщения okleyka.send из Twenty.
```

- Add **Утренняя сводка** section after okleyka (before mention-forward), mirroring chat/topic/save/test controls bound to digest state.
- Description example:

```text
Cron 09:00 и команды /завтра /послезавтра → digest.morning. Omni (🧠): digest_omni_api_key или OMNI_API_KEY; модель oc/deepseek-v4-flash-free, fallback auto. Пока чат не выбран — сводка не отправляется.
```

- [ ] **Step 4: Smoke check locally**

- Open Telegram page: two sections, independent selects.
- Saving okleyka must not clear digest (and reverse) — verify via network PUT body / reload.
- No frontend unit test required if repo has none for this page; backend tests from Tasks 1–3 cover routing.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api.js frontend/src/pages/Telegram.jsx
git commit -m "feat(ui): separate digest.morning destination from okleyka"
```

---

### Task 5: Ops note (no code) + final verification

**Files:** none required (optional progress ledger under `.superpowers/sdd/` if using SDD)

- [ ] **Step 1: Run focused backend suite**

```bash
cd backend && npx vitest run tests/telegram-chat-map-merge.test.js tests/telegram-digest-commands.test.js tests/telegram-test-send.test.js
```

Expected: all PASS

- [ ] **Step 2: After deploy**

On staging/prod UI: set **Утренняя сводка** to a chat/topic **different** from оклейка; «Тест в чат»; then `/завтра` from another chat should land in digest destination.

- [ ] **Step 3: Commit only if a progress/docs file was added**

Otherwise skip empty commit.

---

## Spec coverage checklist

| Spec item | Task |
|-----------|------|
| UI separate sections | 4 |
| Normalize `digest.morning` | 1 |
| Commands → `digest.morning` only | 2 |
| Error in invoke chat | 2 |
| Cron unchanged | (no task — already correct) |
| `test-send` event | 3 |
| Omni hint on digest section | 4 |
| Ops different chats | 5 |

## Self-review

- No TBD placeholders.
- Command call shape updated consistently in Task 2 tests + inbound.
- `test-send` default remains `okleyka.send`.
- UI does not require DestinationPicker extraction.
