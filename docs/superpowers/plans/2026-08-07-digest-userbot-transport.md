# Digest User-bot Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send morning digest and handle `/завтра`/`/послезавтра` via Telegram user-bot (GramJS), removing Bot API dependency from the digest path.

**Architecture:** `runDigestForDay` sends via user-bot `sendMessage` to `digest.morning`. A NewMessage handler (like mention-forward) accepts commands only in that chat/topic. Bot webhook digest logic is removed. `test-send` for digest uses the same user-bot path.

**Tech Stack:** Node ESM, Vitest, GramJS (`telegram`), existing `outbound.js` / `userbot/client.js`.

## Global Constraints

- Destination key remains `digest.morning` (`{ chatId, threadId? }`).
- Commands only match that chat; if `threadId` set, topic must match.
- No `telegram_bot_token` / `callTelegram` on digest send, digest test, or digest commands.
- Okleyka path unchanged.
- YAGNI: no Bot API fallback.

## File map

| File | Role |
|------|------|
| `backend/src/telegram/digest/send.js` | `sendDigestText` via GramJS |
| `backend/src/telegram/digest/run.js` | Use user-bot instead of Bot API |
| `backend/src/telegram/digest/command-match.js` | Pure match: message vs digest.morning |
| `backend/src/telegram/userbot/digest-commands.js` | NewMessage handler + init |
| `backend/src/telegram/inbound.js` | Remove digest command handling |
| `backend/src/routes/telegram.js` | Digest test-send via user-bot |
| `backend/src/index.js` | `initDigestCommands()` |
| Tests | run, match, commands, test-send |

---

### Task 1: `sendDigestText` + wire `runDigestForDay`

**Files:**
- Create: `backend/src/telegram/digest/send.js`
- Modify: `backend/src/telegram/digest/run.js`
- Modify: `backend/tests/telegram-digest-run.test.js`

**Interfaces:**
- Produces: `sendDigestText({ client, chatId, threadId, text }) → Promise<void>`
- Consumes: `getUserbotClient`, `isUserbotConfigured` (injectable via deps for tests)

- [ ] **Step 1: Write failing run tests for user-bot send**

Replace bot-token mocks in `telegram-digest-run.test.js` with:

```js
const sendDigestText = vi.fn();
const isUserbotConfigured = vi.fn();
const getUserbotClient = vi.fn();

vi.mock('../src/telegram/digest/send.js', () => ({
  sendDigestText: (...a) => sendDigestText(...a),
}));
vi.mock('../src/telegram/userbot/client.js', () => ({
  isUserbotConfigured: (...a) => isUserbotConfigured(...a),
  getUserbotClient: (...a) => getUserbotClient(...a),
}));
```

Remove reliance on `getTelegramBotToken` / `callTelegram` for the happy path.

In `beforeEach`:
```js
isUserbotConfigured.mockReturnValue(true);
getUserbotClient.mockResolvedValue({ sendMessage: vi.fn() });
sendDigestText.mockResolvedValue(undefined);
```

Expectations: successful run calls `sendDigestText` with chat/thread/text; without user-bot returns `{ ok: false, error: 'no userbot' }` (or similar); without dest still `{ ok: false, error: 'no chat' }`.

Update any test that asserted `callTelegram(...)`.

- [ ] **Step 2: Run tests — expect FAIL**

`cd backend && npx vitest run tests/telegram-digest-run.test.js`

- [ ] **Step 3: Implement `send.js` and update `run.js`**

`send.js`:
```js
export async function sendDigestText({ client, chatId, threadId, text }) {
  if (!client) throw new Error('userbot client required');
  const messageText = String(text ?? '');
  if (!messageText.trim()) return;
  const replyTo = Number.isInteger(threadId) && threadId > 0 ? threadId : undefined;
  await client.sendMessage(chatId, {
    message: messageText,
    ...(replyTo ? { replyTo } : {}),
  });
}
```

`run.js` (send portion):
```js
import { getTelegramDestination } from '../settings.js';
import { getUserbotClient, isUserbotConfigured } from '../userbot/client.js';
import { sendDigestText } from './send.js';
// ... remove callTelegram / getTelegramBotToken from send path

export async function runDigestForDay({ db, offsetDays, chatId, threadId = null, now = new Date(), deps = {} }) {
  const configured = deps.isUserbotConfigured ?? isUserbotConfigured;
  const getClient = deps.getUserbotClient ?? getUserbotClient;
  const send = deps.sendDigestText ?? sendDigestText;

  if (!configured(db)) {
    console.log('[digest] skipped: user-bot not configured');
    return { ok: false, skipped: true, error: 'no userbot' };
  }

  const dest = getTelegramDestination(db, 'digest.morning');
  const targetChatId = chatId || dest?.chatId;
  if (!targetChatId) return { ok: false, skipped: true, error: 'no chat' };

  // ... existing fetch/omni/render unchanged ...

  const destThread = threadId ?? dest?.threadId ?? null;
  const client = await getClient(db);
  await send({ client, chatId: targetChatId, threadId: destThread, text });
  return { ok: true, text };
}
```

Keep `runMorningDigests` skip when `digest.morning` missing; it may still check dest before calling `runDigestForDay`.

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add backend/src/telegram/digest/send.js backend/src/telegram/digest/run.js backend/tests/telegram-digest-run.test.js
git commit -m "feat(digest): send morning digest via user-bot"
```

---

### Task 2: Pure command match + remove bot inbound digest

**Files:**
- Create: `backend/src/telegram/digest/command-match.js`
- Create: `backend/tests/telegram-digest-command-match.test.js`
- Modify: `backend/src/telegram/inbound.js` — remove digest command block
- Modify: `backend/tests/telegram-digest-commands.test.js` — drop inbound digest invoke tests OR keep only `parseDigestCommand` tests

**Interfaces:**
- Produces: `messageMatchesDigestDest({ sourceChatId, messageThreadId, dest }) → boolean`

```js
export function messageMatchesDigestDest({ sourceChatId, messageThreadId, dest } = {}) {
  if (!dest?.chatId || !sourceChatId) return false;
  if (String(sourceChatId) !== String(dest.chatId)) return false;
  if (dest.threadId != null) {
    return Number(messageThreadId) === Number(dest.threadId);
  }
  return true;
}
```

- [ ] **Step 1: Write match tests** (matching chat+topic; wrong chat; wrong topic; dest without thread accepts any topic in that chat)

- [ ] **Step 2: FAIL then implement match module — PASS**

- [ ] **Step 3: Strip digest from `inbound.js`**

Remove `parseDigestCommand` / `runDigestForDay` / `sendDigestCommandError` usage for digest. Keep chat/topic discovery.

Update `telegram-digest-commands.test.js`: keep `parseDigestCommand` describe; remove or rewrite `processTelegramUpdate digest commands` tests so they assert digest is **not** invoked from bot webhook.

- [ ] **Step 4: Run** `npx vitest run tests/telegram-digest-command-match.test.js tests/telegram-digest-commands.test.js`

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(digest): match commands to digest.morning; drop bot webhook digest"
```

---

### Task 3: User-bot NewMessage digest commands

**Files:**
- Create: `backend/src/telegram/userbot/digest-commands.js`
- Create: `backend/tests/telegram-digest-userbot-commands.test.js`
- Modify: `backend/src/index.js` — call `initDigestCommands()`

**Interfaces:**
- Consumes: `parseDigestCommand`, `messageMatchesDigestDest`, `getTelegramDestination`, `runDigestForDay`, `sendDigestText`, `normalizePeerChatId` (from mention-forward)
- Produces: `initDigestCommands(deps?)`, `handleDigestCommandEvent({ client, db, message })`

Behavior:
1. Read text from message; `parseDigestCommand` → if null return.
2. `sourceChatId = normalizePeerChatId(message.peerId)` (or equivalent GramJS fields used elsewhere).
3. `messageThreadId = message.replyTo?.replyToMsgId` **only if** that is how forum topics appear in existing code — **inspect mention-forward / GramJS usage in repo** and match the same topic id extraction used for forum messages. Prefer whatever field already maps to Bot-API `threadId` in this codebase (check `reconcile` / topic upsert). If unclear, use `message.replyTo?.replyToMsgId` when `message.isTopicMessage` / forum flag is set — document choice in report.
4. If `!messageMatchesDigestDest(...)` return.
5. `await runDigestForDay({ db, offsetDays })`; on `ok:false` or throw, `sendDigestText` with «не удалось загрузить» to dest.

`initDigestCommands`: same `onUserbotClientReady` + `WeakSet` pattern as `initMentionForwarding`.

- [ ] **Step 1–4: TDD handler with mocked message objects + init registration smoke**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(digest): handle /завтра via user-bot in digest.morning"
```

---

### Task 4: `test-send` digest via user-bot + verify suite

**Files:**
- Modify: `backend/src/routes/telegram.js`
- Modify: `backend/tests/telegram-test-send.test.js`

Digest branch:
```js
if (event === 'digest.morning') {
  if (!isUserbotConfigured(db)) {
    return res.status(400).json({ ok: false, error: 'User-bot not configured' });
  }
  const client = await getUserbotClient(db);
  await sendDigestText({
    client,
    chatId: dest.chatId,
    threadId: dest.threadId,
    text: 'Тест утренней сводки',
  });
  return res.json({ ok: true });
}
```

Update tests: digest case expects user-bot send mock, not `callTelegram`; no bot token required.

- [ ] **Step 1–4: TDD then implement**

- [ ] **Step 5: Run focused suite**

```bash
cd backend && npx vitest run tests/telegram-digest-run.test.js tests/telegram-digest-command-match.test.js tests/telegram-digest-commands.test.js tests/telegram-digest-userbot-commands.test.js tests/telegram-test-send.test.js
```

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(telegram): digest test-send via user-bot"
```

---

## Spec coverage

| Spec | Task |
|------|------|
| User-bot send | 1 |
| No bot token on send | 1 |
| Command match only digest.morning | 2–3 |
| Remove bot inbound digest | 2 |
| NewMessage handler | 3 |
| test-send user-bot | 4 |
| Okleyka unchanged | 4 (default path) |

## Self-review

- Topic id extraction must match existing GramJS forum handling in this repo — Task 3 implementer must verify before locking the field name.
- Error reply text stays «не удалось загрузить» for continuity.
