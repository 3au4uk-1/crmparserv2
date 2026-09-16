# Okleyka outbox + userbot auto-reconnect

**Date:** 2026-09-14  
**Repos:** `crmparserv2` (queue, drain, GramJS recovery), `BrandingTwentyView` (send dialog)  
**Status:** approved for planning  

## Problem

GramJS userbot is a process singleton. After hours through the Xray SOCKS proxy the MTProto socket goes stale: `_updateLoop` logs `Error: TIMEOUT`, `getUserbotClient` still returns the same promise, and «Отправить в чат» fails until someone restarts `crmparser`. Successful Telegram sends do not retry; a click during the outage is lost.

## Goals

- Click «Отправить» / «Отправить ещё раз» **always persists** the payload until Telegram has accepted it (or a permanent error).
- Queue survives **userbot death** and **crmparser container restart** (SQLite on `crmparser-data`).
- Dead userbot **reconnects itself** (no Dokploy restart). Ready hooks (mention forward, digest commands, Team App mirror) re-attach on the new client.
- Dialog does **not** show «Отправлено» until `telegram_send_log` has a row for that send.
- One pending job per line item: a second click updates the payload, does not enqueue a second Telegram message.

## Non-goals (v1)

- Queueing digest, auto-invite, mention-forward, or Team App mirror.
- Auto-retry of wrap-task (`WRAP_OKLEYKA`) if Telegram succeeded and Twenty task create failed (existing `wrap_task_failed` warning).
- Changing Xray / VLESS / TLS.
- At-most-once Telegram delivery (at-least-once: a crash after Telegram ACK and before `send_log` may duplicate one message).
- Operator UI on crmparser `/telegram` for inspecting the outbox.
- Push/websocket from crmparser to Twenty; dialog **polls**.

## Decisions

| Topic | Choice |
|-------|--------|
| Queue store | New SQLite table `telegram_okleyka_outbox` in crmparser |
| Send API | Existing `POST /api/twenty/telegram/events` (`okleyka.send`) **enqueues** then kicks drain; does not wait for Telegram |
| Status API | `GET /api/twenty/telegram/okleyka-jobs/:lineItemId` — latest job for that line item |
| Userbot recovery | Watchdog: `resetUserbotClient` + new `connect`, exponential backoff, skip auth/session errors |
| UI | Dialog stays open: «В очереди…» / poll until `sent` \| `alreadySent` \| `failed` |
| Coalesce | Unique pending/sending row per `line_item_id` |
| Drain | Single-flight FIFO (`id ASC`), one Telegram send at a time |

---

## 1. Outbox schema

```sql
CREATE TABLE telegram_okleyka_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  line_item_id TEXT NOT NULL,
  opportunity_id TEXT,
  text TEXT NOT NULL,
  file_urls_json TEXT NOT NULL DEFAULT '[]',
  sent_by TEXT,
  force INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL, -- pending | sending | sent | failed
  error TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT, -- datetime, null = due now
  sending_started_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_telegram_okleyka_outbox_open
  ON telegram_okleyka_outbox(line_item_id)
  WHERE status IN ('pending', 'sending');
```

`telegram_send_log` stays the success ledger (`alreadySent`, CRM patch). Outbox `sent` is bookkeeping; operators and UI treat **send_log** as source of truth for “already sent”.

### Status rules

| Status | Meaning |
|--------|---------|
| `pending` | Waiting for drain (userbot may be down) |
| `sending` | Drain claimed this row; Telegram in flight |
| `sent` | Telegram accepted; send_log written; wrap attempted |
| `failed` | Permanent; do not auto-retry. Operator can click send again (`force` or new payload → new/updated open job) |

On **process start**: any `sending` older than **120 seconds** → `pending` (crash while in flight). Younger `sending` is left alone so a live drain is not stolen.

---

## 2. Enqueue (`okleyka.send`)

Keep current validation: `event`, `lineItemId`, `text` (string), `fileUrls` array. Destination (`okleyka.send` chat) and userbot **config** (session present) still required; missing config is **503** and **does not** enqueue (nothing to drain toward).

If `!force` and `findLastSend` exists → `{ ok: false, alreadySent: true, lastSentAt }` as today. No outbox row.

Else upsert the open job for `line_item_id`:

- If an open job is `pending`: update `text`, `file_urls_json`, `force`, `sent_by`; clear `error`; `next_attempt_at = now`.
- If an open job is `sending`: **do not change payload** (Telegram may already be in flight). Return that `jobId` with `status: "sending"`. Operator can send again after `sent`/`failed`.
- If none: insert `pending`.
- Kick drain (non-blocking).
- Return **200** with that row’s id and status (`pending` or `sending`):

```json
{
  "ok": true,
  "queued": true,
  "jobId": 42,
  "status": "pending"
}
```

HTTP stays fast so Twenty’s 60s logic-function timeout is irrelevant to Telegram.

`alreadySent` is evaluated **only at enqueue**, not again at drain, except: if drain sees a send_log row and `force` is false (race), mark job `sent` without a second Telegram call.

---

## 3. Status (`GET …/okleyka-jobs/:lineItemId`)

Auth: same bearer as other `/api/twenty/*`.

Response:

```json
{
  "job": null,
  "alreadySent": false,
  "lastSentAt": null
}
```

`job` when an open or latest terminal row exists:

```json
{
  "id": 42,
  "status": "pending",
  "error": null,
  "updatedAt": "2026-09-14T13:00:00.000Z"
}
```

Priority: open (`pending`/`sending`) over latest `sent`/`failed`. `alreadySent` / `lastSentAt` from send_log so the dialog can still offer «Отправить ещё раз».

Twenty: new logic function `telegram-okleyka-job` → `GET /crmparser/telegram/okleyka-job/:lineItemId` proxying this route. Use `yarn twenty dev:add logicFunction` for a valid UUID v4.

---

## 4. Drain

Module: `backend/src/telegram/okleyka-outbox.js` (store) + `okleyka-drain.js` (loop).

- One drain at a time (`drainInFlight`).
- Pick the oldest row with `status IN ('pending')` and (`next_attempt_at` IS NULL OR `<= now`).
- Set `sending` + `sending_started_at`.
- `getUserbotClient` → `sendOkleykaToTelegram` (existing).
- On success: `insertSendLog`, CRM patch, `createWrapOkleykaTask` (same try/catch as today), set `sent`. Then next row.
- On **transient** error: `pending`, `attempt_count++`, `next_attempt_at` with backoff, **schedule userbot reconnect** if the error looks like transport. Do not mark `failed`.
- On **permanent** error: `failed` + `error` message for the dialog.

**Transient:** GramJS `TIMEOUT`, `disconnected`, `Connection`, `ECONNRESET`, `ETIMEDOUT`, `fetch failed`, SOCKS/proxy failures, HTTP 5xx from file download.

**Permanent:** 4xx validation, destination missing at drain time, userbot not configured (session wiped), HTTP 4xx downloading a file after **3** download attempts.

Backoff for pending retry: 5s, 15s, 45s, 2m, then 5m cap. Independent of reconnect backoff.

FIFO: never start row N+1 while N is `sending`.

---

## 5. Userbot reconnect

Extend `backend/src/telegram/userbot/client.js` (keep `resetUserbotClient` / `onUserbotClientReady`).

New: `scheduleUserbotReconnect(reason)` — single-flight.

1. If a reconnect is already waiting/in flight, no-op.
2. `resetUserbotClient()` (disconnect old client).
3. Wait backoff: 2s, 5s, 15s, 45s, cap **5 minutes**. Reset backoff to 2s after a **successful** `getUserbotClient`.
4. Next `getUserbotClient` creates a new `TelegramClient` + `connect`. Existing ready hooks run (WeakSet on client instance already prevents double-attach per instance).
5. On success: log `[telegram] userbot reconnected (reason)`, kick okleyka drain.
6. On **auth/session** errors (`AUTH_KEY_UNREGISTERED`, `SESSION_REVOKED`, `userbot not configured`): stop the loop, log once, do not spin. Operator must re-login via `/telegram`.
7. Other connect failures: continue backoff.

**Who calls `scheduleUserbotReconnect`:**

1. Drain, on transient send error (covers «Отправить» while the session is already dead).
2. A **60s watchdog**: if a singleton client already exists, run `getMe` (or equivalent) with a **10s** timeout. Failure or timeout → reconnect. Success → no-op. Skip the tick if reconnect is in flight or there is no client yet.

`client.connected === true` is **not** sufficient: production `TIMEOUT` in `_updateLoop` leaves the singleton looking connected. Periodic `getMe` is the health check.

Do **not** restart the Node process. Do **not** call `getUserbotClient` from the watchdog when `clientPromise` is empty (that would connect at idle forever; first send/reconcile still connects as today).

---

## 6. Twenty View dialog

`sendOkleykaPayload` / `OkleykaMessageDialog`:

- POST as today. If `alreadySent` → existing notice.
- If `queued: true` → set local state `queued`, poll GET every **2s** (max ~5 min UI wait; job remains in SQLite after that).
- `job.status === 'sent'` → «Отправлено», dismiss as today.
- `job.status === 'failed'` → show `job.error`, keep dialog, allow retry (POST again).
- While `pending`/`sending`: button disabled, label «В очереди…».
- Poll errors (parser down): keep «В очереди…», do not flip to failed; the job is in SQLite.

Do not treat HTTP 200 `{ queued: true }` as success-sent.

---

## 7. Testing

crmparserv2 (vitest):

- Outbox upsert coalesces by `line_item_id`.
- Enqueue with existing send_log + `!force` → alreadySent, no row.
- Drain success → send_log + status `sent`; wrap invoked.
- Transient send error → stays `pending`, reconnect scheduled (mock).
- Permanent error → `failed`.
- Stale `sending` (>120s) reset to `pending` on startup helper.
- Reconnect: `resetUserbotClient` then new client; ready hook runs again; auth error stops loop.
- `handleOkleykaSend` returns `queued` without calling Telegram in the request (Telegram only from drain).

BrandingTwentyView:

- Dialog: queued → poll → sent.
- Dialog: failed shows error, no auto-dismiss.

---

## 8. Files (expected)

**crmparserv2**

- `backend/src/db/schema.sql`, `backend/src/db/migrate.js` — table + partial unique index
- `backend/src/telegram/okleyka-outbox.js` — CRUD
- `backend/src/telegram/okleyka-drain.js` — drain loop
- `backend/src/telegram/userbot/client.js` — reconnect watchdog
- `backend/src/telegram/handle-okleyka-send.js` — enqueue + kick drain
- `backend/src/routes/twenty.js` — GET job status; POST behavior via handle
- `backend/src/index.js` — start drain + stale-sending reset + watchdog
- Tests next to existing `telegram-okleyka-send.test.js`
- `ops/telegram-userbot.md` — outbox + auto-reconnect note

**BrandingTwentyView**

- `src/logic-functions/telegram-okleyka-job.ts` (new, via `yarn twenty dev:add`)
- `src/deals-board/api/crmparser.ts` — `fetchOkleykaJob`
- `src/deals-board/ui/OkleykaMessageDialog.tsx` + payload helper/tests

---

## 9. Ops

No new env vars required. Optional later: `TELEGRAM_USERBOT_RECONNECT_CAP_MS` — not in v1.

Logs:

- `[telegram] okleyka queued job=<id> lineItem=<uuid>`
- `[telegram] okleyka drain sent job=<id>`
- `[telegram] okleyka drain transient job=<id>: <message>`
- `[telegram] userbot reconnect scheduled (<reason>)`
- `[telegram] userbot reconnected (reason)`
- `[telegram] userbot reconnect stopped: <auth error>`
