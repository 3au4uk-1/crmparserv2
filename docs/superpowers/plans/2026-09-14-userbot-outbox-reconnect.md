# Okleyka Outbox + Userbot Auto-Reconnect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist okleyka sends in a SQLite outbox until Telegram accepts them, and automatically recreate the GramJS userbot client when the MTProto session goes stale.

**Architecture:** `POST okleyka.send` upserts `telegram_okleyka_outbox` and returns `{ queued: true }` without talking to Telegram. A single-flight drain claims `pending` rows FIFO, sends via existing `sendOkleykaToTelegram`, then writes `telegram_send_log` + wrap task. Transient failures reschedule the row and call `scheduleUserbotReconnect`. A 60s `getMe` watchdog catches stale-but-“connected” clients. Twenty View polls job status and does not show «Отправлено» until `sent`.

**Tech Stack:** Node ESM, better-sqlite3, Vitest, GramJS, Twenty logic functions, React deals-board dialog.

**Spec:** `docs/superpowers/specs/2026-09-14-userbot-outbox-reconnect-design.md`

## Global Constraints

- Queue lives only in crmparser SQLite (`telegram_okleyka_outbox`); `telegram_send_log` remains the success ledger for `alreadySent`.
- Enqueue does not call Telegram; drain is the only sender.
- One open (`pending`/`sending`) job per `line_item_id` (partial unique index).
- Updating a `sending` row’s payload is forbidden.
- Transient vs permanent errors follow the spec lists; transport errors also schedule reconnect.
- Reconnect must not loop on `AUTH_KEY_UNREGISTERED`, `SESSION_REVOKED`, or `userbot not configured`.
- Watchdog must not call `getUserbotClient` when no singleton exists.
- Do not restart the Node process to recover the userbot.
- Wrap-task failure after Telegram success stays a warning; do not requeue Telegram.
- UUID v4 only for new Twenty logic-function identifiers.
- Skip git commit steps unless the user explicitly asked to commit.

## File map

| File | Role |
|------|------|
| `backend/src/db/schema.sql`, `backend/src/db/migrate.js` | Outbox table + partial unique index |
| `backend/src/telegram/okleyka-outbox.js` | CRUD, coalesce, stale-sending recover, job status |
| `backend/src/telegram/okleyka-errors.js` | `classifyOkleykaError`, `retryDelaySeconds` |
| `backend/src/telegram/okleyka-drain.js` | Single-flight drain + kick |
| `backend/src/telegram/handle-okleyka-send.js` | Enqueue + kick drain |
| `backend/src/telegram/userbot/client.js` | `peekUserbotClientPromise` |
| `backend/src/telegram/userbot/reconnect.js` | `scheduleUserbotReconnect`, `initUserbotWatchdog`, `isAuthReconnectStop` |
| `backend/src/routes/twenty.js` | `GET /telegram/okleyka-jobs/:lineItemId` |
| `backend/src/index.js` | Recover stale sending, start watchdog, kick drain |
| `ops/telegram-userbot.md` | Operator note |
| `BrandingTwentyView` logic function + dialog | Poll until `sent`/`failed` |

---

### Task 1: Outbox store + migration

**Files:**
- Create: `backend/src/telegram/okleyka-outbox.js`
- Create: `backend/tests/okleyka-outbox.test.js`
- Modify: `backend/src/db/schema.sql` (after `telegram_send_log` indexes)
- Modify: `backend/src/db/migrate.js` (same `db.exec` block as other telegram tables)

**Interfaces:**
- Produces:
  - `enqueueOkleykaJob(db, input) → { id, status }`
  - `getOpenOkleykaJob(db, lineItemId) → row | undefined`
  - `getOkleykaJobForLineItem(db, lineItemId) → row | undefined` (open first, else latest by id)
  - `claimNextOkleykaJob(db) → row | undefined`
  - `completeOkleykaJob(db, id)`
  - `failOkleykaJob(db, id, error)`
  - `retryOkleykaJob(db, id, { error, delaySeconds })`
  - `recoverStaleOkleykaSending(db, { olderThanSeconds = 120 }) → number`

`input`: `{ lineItemId, opportunityId, text, fileUrls, sentBy, force }`

Row shape: table columns; `file_urls_json` is TEXT; helpers parse `fileUrls` array on read.

- [ ] **Step 1: Write failing tests**

```js
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migrate } from '../src/db/migrate.js';
import {
  enqueueOkleykaJob,
  getOpenOkleykaJob,
  claimNextOkleykaJob,
  completeOkleykaJob,
  recoverStaleOkleykaSending,
} from '../src/telegram/okleyka-outbox.js';

function dbWithOutbox() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)`);
  migrate(db);
  return db;
}

describe('okleyka-outbox', () => {
  it('coalesces pending jobs per line item', () => {
    const db = dbWithOutbox();
    const a = enqueueOkleykaJob(db, {
      lineItemId: 'li-1',
      text: 'first',
      fileUrls: [],
      force: false,
    });
    const b = enqueueOkleykaJob(db, {
      lineItemId: 'li-1',
      text: 'second',
      fileUrls: ['https://x'],
      force: true,
    });
    expect(b.id).toBe(a.id);
    expect(b.status).toBe('pending');
    const row = getOpenOkleykaJob(db, 'li-1');
    expect(row.text).toBe('second');
    expect(JSON.parse(row.file_urls_json)).toEqual(['https://x']);
    expect(row.force).toBe(1);
  });

  it('does not change payload while sending', () => {
    const db = dbWithOutbox();
    enqueueOkleykaJob(db, { lineItemId: 'li-1', text: 'a', fileUrls: [], force: false });
    const claimed = claimNextOkleykaJob(db);
    expect(claimed.status).toBe('sending');
    const again = enqueueOkleykaJob(db, { lineItemId: 'li-1', text: 'b', fileUrls: [], force: false });
    expect(again.id).toBe(claimed.id);
    expect(again.status).toBe('sending');
    expect(getOpenOkleykaJob(db, 'li-1').text).toBe('a');
  });

  it('requeues sending older than 120s', () => {
    const db = dbWithOutbox();
    enqueueOkleykaJob(db, { lineItemId: 'li-1', text: 'a', fileUrls: [], force: false });
    claimNextOkleykaJob(db);
    db.prepare(
      `UPDATE telegram_okleyka_outbox SET sending_started_at = datetime('now', '-3 minutes')`,
    ).run();
    expect(recoverStaleOkleykaSending(db)).toBe(1);
    expect(getOpenOkleykaJob(db, 'li-1').status).toBe('pending');
  });

  it('claim is FIFO and skips future next_attempt_at', () => {
    const db = dbWithOutbox();
    const first = enqueueOkleykaJob(db, { lineItemId: 'li-a', text: 'a', fileUrls: [], force: false });
    enqueueOkleykaJob(db, { lineItemId: 'li-b', text: 'b', fileUrls: [], force: false });
    completeOkleykaJob(db, first.id);
    // re-open first as pending in the future via retry helper in later task — for now:
    db.prepare(
      `INSERT INTO telegram_okleyka_outbox (line_item_id, text, status, next_attempt_at)
       VALUES ('li-c', 'c', 'pending', datetime('now', '+1 hour'))`,
    ).run();
    const next = claimNextOkleykaJob(db);
    expect(next.line_item_id).toBe('li-b');
  });
});
```

If `migrate(db)` is not the exported signature, match `migrate.js` (`export function migrate(db = getDb())`) — tests should pass `db`.

- [ ] **Step 2: Run test — expect FAIL**

`cd backend && npx vitest run tests/okleyka-outbox.test.js`

- [ ] **Step 3: Implement schema + store**

Add to `schema.sql` and `migrate.js`:

```sql
CREATE TABLE IF NOT EXISTS telegram_okleyka_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  line_item_id TEXT NOT NULL,
  opportunity_id TEXT,
  text TEXT NOT NULL,
  file_urls_json TEXT NOT NULL DEFAULT '[]',
  sent_by TEXT,
  force INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  error TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  sending_started_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_telegram_okleyka_outbox_open
  ON telegram_okleyka_outbox(line_item_id)
  WHERE status IN ('pending', 'sending');
```

Implement `okleyka-outbox.js` with the functions above. `enqueueOkleykaJob`: if open `pending`, UPDATE payload and `next_attempt_at = datetime('now')`; if open `sending`, return that row unchanged; else INSERT `pending`. `claimNextOkleykaJob`: `SELECT ... WHERE status = 'pending' AND (next_attempt_at IS NULL OR datetime(next_attempt_at) <= datetime('now')) ORDER BY id ASC LIMIT 1`, then UPDATE to `sending` + `sending_started_at = datetime('now')`. `recoverStaleOkleykaSending`: `UPDATE ... SET status = 'pending', sending_started_at = NULL WHERE status = 'sending' AND datetime(sending_started_at) <= datetime('now', '-' || ? || ' seconds')`.

- [ ] **Step 4: Run tests — expect PASS**

`cd backend && npx vitest run tests/okleyka-outbox.test.js`

- [ ] **Step 5: Commit** (skip unless asked)

---

### Task 2: Error classification + backoff

**Files:**
- Create: `backend/src/telegram/okleyka-errors.js`
- Create: `backend/tests/okleyka-errors.test.js`

**Interfaces:**
- Produces:
  - `classifyOkleykaError(err) → 'transient' | 'permanent'`
  - `retryDelaySeconds(attemptCount) → number` — 5, 15, 45, 120, 300 (cap). `attemptCount` is the count **after** increment (1 → 5s).
  - `isTransportError(err) → boolean` — subset of transient that should reconnect (TIMEOUT, disconnected, Connection, ECONNRESET, ETIMEDOUT, fetch failed, SOCKS/proxy). HTTP 5xx download is transient but **not** transport (no reconnect).

```js
export function classifyOkleykaError(err) {
  const msg = String(err?.message ?? err ?? '');
  const status = Number(err?.status);
  if (status === 400 || status === 503) return 'permanent';
  if (/userbot not configured/i.test(msg)) return 'permanent';
  if (/download failed: HTTP 4\d\d/i.test(msg)) return 'permanent';
  if (isTransportError(err)) return 'transient';
  if (/download failed: HTTP 5\d\d/i.test(msg)) return 'transient';
  if (/TIMEOUT|disconnected|ECONNRESET|ETIMEDOUT|fetch failed|SOCKS|proxy/i.test(msg)) {
    return 'transient';
  }
  return 'permanent';
}
```

Download 4xx is permanent **at drain** after the outbound helper already threw; the “3 download attempts” from the spec is implemented in Task 3 by treating the first two download 4xx as transient via `attempt_count < 3` in drain (override classify for that message).

- [ ] **Step 1: Write failing tests** for TIMEOUT → transient, `userbot not configured` → permanent, delay sequence, HTTP 404 download + attempt_count 1–2 vs 3 handled in drain tests (here only classify 404 as permanent).

- [ ] **Step 2:** `cd backend && npx vitest run tests/okleyka-errors.test.js` — FAIL

- [ ] **Step 3:** Implement `okleyka-errors.js`

- [ ] **Step 4:** PASS

- [ ] **Step 5: Commit** (skip unless asked)

---

### Task 3: Drain loop

**Files:**
- Create: `backend/src/telegram/okleyka-drain.js`
- Create: `backend/tests/okleyka-drain.test.js`

**Interfaces:**
- Consumes: outbox functions, `classifyOkleykaError`, `retryDelaySeconds`, `isTransportError`
- Produces:
  - `kickOkleykaDrain(db, deps = {}) → Promise<void>` — non-blocking; single-flight (`drainInFlight`)
  - `runOkleykaDrain(db, deps = {}) → Promise<void>` — process due jobs until none (used by tests)

`deps`: `getUserbotClient`, `isUserbotConfigured`, `sendOkleykaToTelegram`, `getTelegramDestination`, `insertSendLog`, `hashOkleykaPayload`, `findLastSend`, `patchOkleykaTelegramFields`, `createWrapOkleykaTask`, `scheduleUserbotReconnect`, `now` (optional).

Algorithm for one job:

1. `claimNextOkleykaJob`. If none, stop.
2. Destination missing or `!isUserbotConfigured()` → `failOkleykaJob` permanent, continue.
3. If `!force` and `findLastSend(db, 'okleyka.send', lineItemId)` → `completeOkleykaJob` without Telegram.
4. `client = await getUserbotClient(db)`.
5. `sendOkleykaToTelegram({ client, chatId, threadId, text, fileUrls })`.
6. Success: `insertSendLog`, patch CRM (catch → log, do not fail job), wrap (catch → log `wrap_task_failed`), `completeOkleykaJob`.
7. Catch: if download HTTP 4xx and `attempt_count + 1 < 3` treat as transient; else `classifyOkleykaError`. Transient → `retryOkleykaJob` with `retryDelaySeconds(attempt_count+1)`; if `isTransportError` call `scheduleUserbotReconnect(db, err.message)`. Permanent → `failOkleykaJob`.

Log lines from spec.

- [ ] **Step 1: Failing tests**

```js
it('sends, logs, wraps, marks sent', async () => { /* ... */ });
it('does not call telegram when send_log exists and force is 0', async () => { /* ... */ });
it('on TIMEOUT retries pending and schedules reconnect', async () => { /* ... */ });
it('on userbot not configured marks failed', async () => { /* ... */ });
it('keeps telegram success if wrap throws', async () => { /* ... */ });
```

Use memory DB + migrate + enqueue a job; inject mocks in `deps`. `kickOkleykaDrain` should `await runOkleykaDrain` when `drainInFlight` is null; tests call `await runOkleykaDrain(db, deps)`.

- [ ] **Step 2:** `cd backend && npx vitest run tests/okleyka-drain.test.js` — FAIL

- [ ] **Step 3:** Implement drain. Export `__resetOkleykaDrainForTests()` clearing `drainInFlight`.

- [ ] **Step 4:** PASS

- [ ] **Step 5: Commit** (skip unless asked)

---

### Task 4: Enqueue from `handleOkleykaSend`

**Files:**
- Modify: `backend/src/telegram/handle-okleyka-send.js`
- Modify: `backend/tests/telegram-okleyka-send.test.js`

**Interfaces:**
- Consumes: `enqueueOkleykaJob`, `kickOkleykaDrain`
- Changes return of success path to `{ ok: true, queued: true, jobId, status }`
- Must **not** call `getUserbotClient` / `sendOkleykaToTelegram` in this request

Keep validation + 503 if missing userbot/chat. Keep `alreadySent` short-circuit.

`memoryDb()` in tests must also `CREATE TABLE telegram_okleyka_outbox` **or** call `migrate`. Easiest: add outbox DDL to `memoryDb()` matching migrate (or `migrate` after settings table). Prefer copying the CREATE from Task 1 into `memoryDb` so tests stay isolated.

Rewrite tests that expected immediate send:

- alreadySent: unchanged, send not called, drain not kicked.
- success: `createWrapOkleykaTask` / `sendOkleykaToTelegram` **not** called; result `queued: true`; outbox row exists; `kickOkleykaDrain` called (inject `kickOkleykaDrain: vi.fn()`).
- wrap-on-send tests move conceptually to drain tests (already in Task 3); delete or skip send-path wrap tests that no longer apply.

- [ ] **Step 1:** Update tests first (they fail against old handler that still sends).

- [ ] **Step 2:** `cd backend && npx vitest run tests/telegram-okleyka-send.test.js` — FAIL (queued assertions)

- [ ] **Step 3:** Replace send/patch/wrap block with enqueue + kick:

```js
const job = enqueueOkleykaJob(db, {
  lineItemId,
  opportunityId: body?.opportunityId,
  text,
  fileUrls,
  sentBy: resolveSentBy(body?.sentBy),
  force,
});
console.log(`[telegram] okleyka queued job=${job.id} lineItem=${lineItemId}`);
const kick = deps.kickOkleykaDrain ?? kickOkleykaDrain;
void kick(db).catch((err) => console.error('[telegram] okleyka drain kick:', err.message));
return { ok: true, queued: true, jobId: job.id, status: job.status };
```

- [ ] **Step 4:** PASS `telegram-okleyka-send.test.js` and `okleyka-drain.test.js`

- [ ] **Step 5: Commit** (skip unless asked)

---

### Task 5: Job status GET

**Files:**
- Modify: `backend/src/telegram/okleyka-outbox.js` — `getOkleykaJobStatus(db, lineItemId)` combining job + send_log
- Create: `backend/tests/okleyka-job-status.test.js`
- Modify: `backend/src/routes/twenty.js`

**Interfaces:**
- Produces: `getOkleykaJobStatus(db, lineItemId) → { job, alreadySent, lastSentAt }`
- `job`: `{ id, status, error, updatedAt }` or `null`
- Route: `GET /telegram/okleyka-jobs/:lineItemId` (router is mounted at `/api/twenty`)

```js
router.get('/telegram/okleyka-jobs/:lineItemId', (req, res) => {
  const lineItemId = String(req.params.lineItemId || '').trim();
  if (!lineItemId) return res.status(400).json({ error: 'lineItemId required' });
  res.json(getOkleykaJobStatus(getDb(), lineItemId));
});
```

Open job wins over latest terminal. `alreadySent`/`lastSentAt` from `findLastSend(db, 'okleyka.send', lineItemId)`.

- [ ] **Step 1:** Tests for null job, pending job, sent job + alreadySent from log.

- [ ] **Step 2:** FAIL

- [ ] **Step 3:** Implement helper + route

- [ ] **Step 4:** PASS

- [ ] **Step 5: Commit** (skip unless asked)

---

### Task 6: Userbot reconnect + watchdog

**Files:**
- Modify: `backend/src/telegram/userbot/client.js` — add `peekUserbotClientPromise()`
- Create: `backend/src/telegram/userbot/reconnect.js`
- Create: `backend/tests/telegram-userbot-reconnect.test.js`

**Interfaces:**
- `peekUserbotClientPromise() → Promise<TelegramClient> | undefined`
- `isAuthReconnectStop(err) → boolean` — message matches `/AUTH_KEY_UNREGISTERED|SESSION_REVOKED|userbot not configured/i`
- `scheduleUserbotReconnect(db, reason, deps = {}) → void` — single-flight
- `initUserbotWatchdog(db, deps = {})` — `setInterval` 60s; export `__resetUserbotReconnectForTests()`
- `USERBOT_WATCHDOG_MS = 60_000`, `USERBOT_GETME_TIMEOUT_MS = 10_000`
- Reconnect delays: 2s, 5s, 15s, 45s, then 300s cap. Reset to 2s after successful `getUserbotClient`.

`scheduleUserbotReconnect` algorithm (inject `sleep`, `getUserbotClient`, `resetUserbotClient`, `kickOkleykaDrain`, `onReconnectStop`):

1. If `reconnectInFlight`, return.
2. Set flag, log `[telegram] userbot reconnect scheduled (${reason})`.
3. `resetUserbotClient()`.
4. Loop: `sleep(delay)`; try `await getUserbotClient(db)`; on success log `[telegram] userbot reconnected (${reason})`, reset delay, `kickOkleykaDrain(db)`, clear flag, return; on `isAuthReconnectStop` log `[telegram] userbot reconnect stopped: ${msg}`, clear flag, return; else increase delay and continue.

Watchdog tick:

```js
const existing = peekUserbotClientPromise();
if (!existing || reconnectInFlight) return;
try {
  const client = await existing;
  await Promise.race([
    client.getMe(),
    sleep(USERBOT_GETME_TIMEOUT_MS).then(() => {
      throw new Error('TIMEOUT');
    }),
  ]);
} catch (err) {
  scheduleUserbotReconnect(db, err.message, deps);
}
```

Do not call `getUserbotClient` here.

- [ ] **Step 1: Tests**

```js
it('reconnects once, kicks drain, runs getUserbotClient after reset', async () => { /* fake timers */ });
it('second scheduleUserbotReconnect is a no-op while in flight', async () => {});
it('stops on AUTH_KEY_UNREGISTERED', async () => {});
it('watchdog skips when peekUserbotClientPromise is empty', async () => {});
it('watchdog schedules reconnect when getMe times out', async () => {});
```

Use `vi.useFakeTimers()`.

- [ ] **Step 2:** FAIL

- [ ] **Step 3:** Implement

- [ ] **Step 4:** PASS

- [ ] **Step 5: Commit** (skip unless asked)

---

### Task 7: Process wiring + ops doc

**Files:**
- Modify: `backend/src/index.js` — after `migrate()`: `recoverStaleOkleykaSending(getDb())`; after digest/mention inits: `initUserbotWatchdog(getDb())`; `void kickOkleykaDrain(getDb())`
- Modify: `ops/telegram-userbot.md` — short section: outbox + auto-reconnect; operators should not restart crmparser for TIMEOUT; re-login still required if session revoked

No new env vars.

- [ ] **Step 1:** If there is an existing index/startup test, extend it; otherwise a small test that `recoverStaleOkleykaSending` is exported and `initUserbotWatchdog` is a function (do not boot full Express).

- [ ] **Step 2–4:** Wire `index.js` + doc.

- [ ] **Step 5: Commit** (skip unless asked)

Run the crmparser telegram-related vitest files together:

`cd backend && npx vitest run tests/okleyka-outbox.test.js tests/okleyka-errors.test.js tests/okleyka-drain.test.js tests/okleyka-job-status.test.js tests/telegram-okleyka-send.test.js tests/telegram-userbot-reconnect.test.js`

---

### Task 8: Twenty logic function + client

**Repo:** `BrandingTwentyView`

**Files:**
- Create via `yarn twenty dev:add logicFunction` named `telegram-okleyka-job` (generates UUID v4) → `src/logic-functions/telegram-okleyka-job.ts`
- Modify: `src/constants/universal-identifiers.ts` — export the generated UUID (replace scaffold if the CLI already wrote one)
- Modify: `src/deals-board/api/crmparser.ts` — `fetchOkleykaJob(lineItemId)`
- Modify: `src/deals-board/api/crmparser.test.ts`
- Modify: `src/deals-board/utils/send-okleyka-payload.ts` + test — map `queued: true` to `{ ok: true, queued: true, jobId, status }` (not `sent`)

Logic function (mirror `line-item-sync.ts` GET):

```ts
httpRouteTriggerSettings: {
  path: '/crmparser/telegram/okleyka-job/:lineItemId',
  httpMethod: 'GET',
  isAuthRequired: true,
}
```

Proxy: `crmparserProxyFetch(\`/twenty/telegram/okleyka-jobs/${encodeURIComponent(lineItemId)}\`)`

Client:

```ts
export async function fetchOkleykaJob(lineItemId: string): Promise<OkleykaJobStatus> {
  return logicFunctionFetch(
    `/crmparser/telegram/okleyka-job/${encodeURIComponent(lineItemId)}`,
  );
}
```

`sendOkleykaPayload`: if `result.queued` return `{ ok: true, queued: true, jobId: result.jobId, status: result.status }` and **do not** imply sent.

- [ ] **Step 1:** Client/payload tests fail until types exist

- [ ] **Step 2:** FAIL

- [ ] **Step 3:** Add function + client

- [ ] **Step 4:** `npx vitest run src/deals-board/api/crmparser.test.ts src/deals-board/utils/send-okleyka-payload.test.ts`

- [ ] **Step 5: Commit** (skip unless asked)

---

### Task 9: Okleyka dialog poll

**Repo:** `BrandingTwentyView`

**Files:**
- Modify: `src/deals-board/ui/OkleykaMessageDialog.tsx`
- Create: `src/deals-board/ui/OkleykaMessageDialog.queued.test.ts` **or** extract poll helper `src/deals-board/utils/wait-okleyka-job.ts` and test that (prefer helper for TDD without full React)

**Interfaces:**
- `waitOkleykaJob(lineItemId, { fetchJob, intervalMs = 2000, maxMs = 300_000, sleep }) → Promise<{ status, error }>`
  - Poll until `job.status` is `sent` or `failed`
  - Fetch errors: continue polling (do not reject)
  - Timeout: resolve `{ status: 'pending' }` (dialog stays «В очереди…»; job remains in SQLite)

Dialog `handleSend`:

1. POST payload.
2. `alreadySent` → existing UI.
3. `!result.ok` → `setSendError`.
4. If `result.queued`: keep `sending` true, label «В очереди…», `await waitOkleykaJob(lineItemId)`.
5. `sent` → `setSent(true)`, dismiss 800ms.
6. `failed` → `setSendError(job.error)`, `setSending(false)`.
7. `pending` after max wait → leave «В очереди…» / `setSending(false)` with muted hint that it will send in the background (no fake «Отправлено»).

Button: `sending` or queued wait → disabled; text «В очереди…» when queued.

- [ ] **Step 1:** Tests for wait helper: sent, failed, fetch throw then sent, maxMs pending.

- [ ] **Step 2:** FAIL

- [ ] **Step 3:** Helper + dialog wire

- [ ] **Step 4:** PASS those tests

- [ ] **Step 5: Commit** (skip unless asked)

After Twenty changes: `yarn twenty apply` (or project’s usual apply) so the GET route exists on the workspace. Note in the PR/handoff.

---

## Spec coverage

| Spec section | Task |
|--------------|------|
| Outbox schema + coalesce + stale sending | 1 |
| Enqueue / alreadySent / no Telegram in POST | 4 |
| GET job status + Twenty proxy | 5, 8 |
| Drain FIFO, wrap, transient/permanent | 2, 3 |
| Reconnect + getMe watchdog | 6, 7 |
| Dialog poll | 8, 9 |
| Ops logs / runbook | 7 |

## Placeholder scan

None by design: function names, routes, delays, and SQL are copied from the spec.
