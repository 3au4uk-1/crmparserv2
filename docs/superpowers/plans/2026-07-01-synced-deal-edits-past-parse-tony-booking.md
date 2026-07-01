# Synced Deal Edits, Past Parse, Tony Booking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unlock editing of synced deal items with automatic Twenty re-sync, allow manual parsing of past dates, and let users attach Tony booking IDs to existing calendar deals.

**Architecture:** Backend owns auto-resync via `resyncDealIfSynced()` called from item-mutation and booking-attach endpoints. Manual parse uses a new `normalizeManualParseRange()` without today-clamp; scheduler unchanged. Tony attach reuses import/parser fetch+classify pipeline, updates deal in place, preserves overrides by item name.

**Tech Stack:** Node.js (Express), better-sqlite3, Vitest; React + TanStack Query frontend.

**Spec:** [`docs/superpowers/specs/2026-07-01-synced-deal-edits-past-parse-tony-booking-design.md`](../specs/2026-07-01-synced-deal-edits-past-parse-tony-booking-design.md)

---

## File Map

| File | Responsibility |
|------|----------------|
| `backend/src/services/twenty-sync.js` | Add `resyncDealIfSynced` |
| `backend/src/routes/deals.js` | Auto-resync on item mutations; new `PATCH /:id/tony-booking` |
| `backend/src/services/attach-tony-booking.js` | Fetch Tony, update deal + items |
| `backend/src/utils/crm-dates.js` | Add `normalizeManualParseRange` |
| `backend/src/routes/parsing.js` | Use manual range normalizer |
| `backend/tests/resync-deal-if-synced.test.js` | Unit tests for helper |
| `backend/tests/deal-item-resync.test.js` | Route-level auto-resync tests |
| `backend/tests/attach-tony-booking.test.js` | Attach service tests |
| `backend/tests/crm-dates.test.js` | Extend with manual parse tests |
| `frontend/src/components/DealCard.jsx` | Remove readOnly; Tony booking field |
| `frontend/src/components/DealRow.jsx` | Same |
| `frontend/src/components/TonyBookingField.jsx` | New reusable booking input |
| `frontend/src/api.js` | Hook + mutation invalidation updates |
| `frontend/src/pages/Dashboard.jsx` | Remove date min; update hint |

---

### Task 1: `resyncDealIfSynced` helper

**Files:**
- Modify: `backend/src/services/twenty-sync.js`
- Create: `backend/tests/resync-deal-if-synced.test.js`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/resync-deal-if-synced.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const syncDealToTwentyMock = vi.fn();

vi.mock('../src/db/connection.js', () => {
  const deals = new Map();
  return {
    getDb: () => ({
      prepare(sql) {
        return {
          get(id) {
            if (sql.includes('SELECT twenty_id FROM deals')) {
              return deals.get(id) || null;
            }
            return null;
          },
        };
      },
    }),
    __seedDeal(id, twenty_id) {
      deals.set(id, { twenty_id });
    },
    __reset() {
      deals.clear();
    },
  };
});

vi.mock('../src/services/twenty-sync.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    syncDealToTwenty: (...args) => syncDealToTwentyMock(...args),
  };
});

import * as dbMock from '../src/db/connection.js';
import { resyncDealIfSynced } from '../src/services/twenty-sync.js';

describe('resyncDealIfSynced', () => {
  beforeEach(() => {
    dbMock.__reset();
    syncDealToTwentyMock.mockReset();
    syncDealToTwentyMock.mockResolvedValue({ action: 'updated', twentyId: 'opp-1' });
  });

  it('returns null when deal has no twenty_id', async () => {
    dbMock.__seedDeal(1, null);
    const result = await resyncDealIfSynced(1);
    expect(result).toBeNull();
    expect(syncDealToTwentyMock).not.toHaveBeenCalled();
  });

  it('calls syncDealToTwenty when twenty_id present', async () => {
    dbMock.__seedDeal(2, 'opp-2');
    const result = await resyncDealIfSynced(2);
    expect(syncDealToTwentyMock).toHaveBeenCalledWith(2);
    expect(result).toEqual({ action: 'updated', twentyId: 'opp-1' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- tests/resync-deal-if-synced.test.js`
Expected: FAIL — `resyncDealIfSynced` is not exported

- [ ] **Step 3: Implement helper**

Add before `export async function syncDealToTwenty` in `backend/src/services/twenty-sync.js`:

```js
export async function resyncDealIfSynced(dealId) {
  const db = getDb();
  const deal = db.prepare('SELECT twenty_id FROM deals WHERE id = ?').get(dealId);
  if (!deal?.twenty_id) return null;
  return syncDealToTwenty(dealId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- tests/resync-deal-if-synced.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/twenty-sync.js backend/tests/resync-deal-if-synced.test.js
git commit -m "feat: add resyncDealIfSynced helper for synced deal edits"
```

---

### Task 2: Auto-resync on item mutation routes

**Files:**
- Modify: `backend/src/routes/deals.js`
- Create: `backend/tests/deal-item-resync.test.js`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/deal-item-resync.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const resyncDealIfSyncedMock = vi.fn();

vi.mock('../src/services/twenty-sync.js', () => ({
  syncDealToTwenty: vi.fn(),
  buildSyncPreview: vi.fn(),
  resyncDealIfSynced: (...args) => resyncDealIfSyncedMock(...args),
}));

vi.mock('../src/services/blacklist.js', () => ({
  loadBlacklist: () => [],
  createBlacklistEntry: vi.fn(() => ({ id: 1, pattern: 'test', matchType: 'exact' })),
}));

vi.mock('../src/services/restoration.js', () => ({
  loadRestorationList: () => [],
  createRestorationEntry: vi.fn(() => ({ id: 1, pattern: 'test', matchType: 'exact' })),
}));

import { getDb, initDb } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import dealsRouter from '../src/routes/deals.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/deals', dealsRouter);
  return app;
}

describe('deal item mutations auto-resync', () => {
  let dealId;
  let itemId;

  beforeEach(() => {
    initDb();
    migrate();
    const db = getDb();
    db.prepare('DELETE FROM deal_items').run();
    db.prepare('DELETE FROM deals').run();
    resyncDealIfSyncedMock.mockReset();
    resyncDealIfSyncedMock.mockResolvedValue({ action: 'updated', twentyId: 'opp-1' });

    const r = db.prepare(`
      INSERT INTO deals (crm_event_id, deal_key, data_source, title, twenty_id, approval_status)
      VALUES ('evt1', 'evt1#cal', 'calendar', 'Test', 'opp-1', 'synced')
    `).run();
    dealId = r.lastInsertRowid;
    const ir = db.prepare(`
      INSERT INTO deal_items (deal_id, name, price, quantity, classification)
      VALUES (?, 'Banner', 1000, '1', 'keyword_match')
    `).run(dealId);
    itemId = ir.lastInsertRowid;
  });

  it('PATCH sync-override triggers resyncDealIfSynced', async () => {
    const res = await request(createApp())
      .patch(`/deals/${dealId}/items/${itemId}/sync-override`)
      .send({ syncOverride: 'exclude' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      sync: { action: 'updated', twentyId: 'opp-1' },
    });
    expect(resyncDealIfSyncedMock).toHaveBeenCalledWith(dealId);
  });
});
```

Add dev dependency if missing:

```bash
cd backend && npm install -D supertest
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- tests/deal-item-resync.test.js`
Expected: FAIL — response lacks `sync` field

- [ ] **Step 3: Wire routes**

In `backend/src/routes/deals.js`:

1. Import `resyncDealIfSynced` from `twenty-sync.js`.
2. Add helper at top of file:

```js
async function respondWithOptionalSync(res, dealId) {
  const sync = await resyncDealIfSynced(dealId);
  res.json({ success: true, ...(sync ? { sync } : {}) });
}
```

3. Convert these handlers to `async` and call `respondWithOptionalSync` instead of `res.json({ success: true })`:

- `POST /:id/items/reset-sync-overrides`
- `PATCH /:dealId/items/:itemId/sync-override`
- `POST /:dealId/items/:itemId/blacklist`
- `POST /:dealId/items/:itemId/restoration`

Example for sync-override:

```js
router.patch('/:dealId/items/:itemId/sync-override', async (req, res, next) => {
  try {
    const { syncOverride } = req.body;
    if (!VALID_SYNC_OVERRIDES.has(syncOverride ?? null)) {
      return res.status(400).json({ error: 'syncOverride must be include, exclude, or null' });
    }
    const db = getDb();
    const item = db.prepare(
      'SELECT id FROM deal_items WHERE id = ? AND deal_id = ?'
    ).get(req.params.itemId, req.params.dealId);
    if (!item) return res.status(404).json({ error: 'Item not found' });

    db.prepare('UPDATE deal_items SET sync_override = ? WHERE id = ?').run(syncOverride, item.id);
    await respondWithOptionalSync(res, Number(req.params.dealId));
  } catch (err) {
    next(err);
  }
});
```

Apply the same pattern to the other three endpoints.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- tests/deal-item-resync.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/deals.js backend/tests/deal-item-resync.test.js backend/package.json backend/package-lock.json
git commit -m "feat: auto-resync synced deals after item mutations"
```

---

### Task 3: Frontend — unlock synced deal editing

**Files:**
- Modify: `frontend/src/components/DealCard.jsx`
- Modify: `frontend/src/components/DealRow.jsx`
- Modify: `frontend/src/api.js`

- [ ] **Step 1: Remove readOnly lock**

In `DealCard.jsx` line ~111 and `DealRow.jsx` line ~117, change:

```jsx
<DealItems dealId={deal.id} items={details?.items} />
```

(remove `readOnly` prop entirely; default is `false` in `DealItems.jsx`)

- [ ] **Step 2: Extend mutation invalidation**

In `frontend/src/api.js`, add `sync-logs` invalidation to these hooks' `onSuccess`:

- `useUpdateItemSyncOverride`
- `useResetSyncOverrides`
- `useAddItemToBlacklist`
- `useAddItemToRestoration`

Example for `useUpdateItemSyncOverride`:

```js
onSuccess: (_, { dealId }) => {
  qc.invalidateQueries({ queryKey: ['deal', dealId] });
  qc.invalidateQueries({ queryKey: ['deals'] });
  qc.invalidateQueries({ queryKey: ['sync-logs'] });
},
```

- [ ] **Step 3: Manual smoke check**

1. Start app, open a synced deal, expand items.
2. Toggle a checkbox — should not be disabled; request should complete.
3. Verify «Пересинхр.» still visible for retry.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/DealCard.jsx frontend/src/components/DealRow.jsx frontend/src/api.js
git commit -m "feat: allow editing synced deal items in UI"
```

---

### Task 4: `normalizeManualParseRange`

**Files:**
- Modify: `backend/src/utils/crm-dates.js`
- Modify: `backend/tests/crm-dates.test.js`

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/crm-dates.test.js`:

```js
import { normalizeManualParseRange } from '../src/utils/crm-dates.js';

describe('normalizeManualParseRange', () => {
  const now = new Date('2026-06-05T12:00:00+03:00');

  it('allows start date before today', () => {
    const { start } = normalizeManualParseRange('2026-05-01', '2026-07-31', now);
    expect(start).toContain('2026-05-01');
  });

  it('throws when from > to', () => {
    expect(() => normalizeManualParseRange('2026-07-31', '2026-05-01', now)).toThrow();
  });

  it('defaults missing bounds to today + 2 weeks', () => {
    const { startDate, endDate } = normalizeManualParseRange(undefined, undefined, now);
    expect(startDate).toBe('2026-06-05');
    expect(endDate).toBe('2026-06-19');
  });
});
```

Update the import at top of file to include `normalizeManualParseRange`.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- tests/crm-dates.test.js`
Expected: FAIL — export not found

- [ ] **Step 3: Implement**

Add to `backend/src/utils/crm-dates.js` after `normalizeParseRange`:

```js
/** Manual parse only: no min-date clamp; validates from <= to. */
export function normalizeManualParseRange(startDate, endDate, now = new Date()) {
  const defaults = getDefaultParseRange(now);
  let start = startDate || defaults.start;
  let end = endDate || defaults.end;

  if (DATE_INPUT_RE.test(start)) {
    start = `${start}T00:00:00${crmOffsetSuffix()}`;
  }
  if (DATE_INPUT_RE.test(end)) {
    end = `${end}T23:59:59${crmOffsetSuffix()}`;
  }

  const startTs = parseEventDate(start)?.getTime() ?? 0;
  const endTs = parseEventDate(end)?.getTime() ?? 0;
  if (startTs > endTs) {
    throw new Error('from must be <= to');
  }

  return { start, end };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- tests/crm-dates.test.js`
Expected: PASS (including existing `normalizeParseRange` clamp regression tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/crm-dates.js backend/tests/crm-dates.test.js
git commit -m "feat: add normalizeManualParseRange for past-date parsing"
```

---

### Task 5: Wire manual parse route + Dashboard UI

**Files:**
- Modify: `backend/src/routes/parsing.js`
- Modify: `frontend/src/pages/Dashboard.jsx`

- [ ] **Step 1: Update parsing route**

In `backend/src/routes/parsing.js`:

```js
import { getDefaultParseRange, normalizeManualParseRange } from '../utils/crm-dates.js';
```

In `POST /run` handler, replace `normalizeParseRange` with `normalizeManualParseRange`. Wrap in try/catch for range error → 400:

```js
try {
  const { start, end } = normalizeManualParseRange(startDate, endDate);
  const result = await runParsing(start, end);
  res.json(result);
} catch (err) {
  if (err.message === 'from must be <= to') {
    return res.status(400).json({ error: err.message });
  }
  throw err;
}
```

- [ ] **Step 2: Update Dashboard**

In `frontend/src/pages/Dashboard.jsx`:

1. Change hint text (line ~62):

```jsx
<p className="text-sm text-ink-muted mt-1 max-w-lg">
  По умолчанию — с сегодня на 2 недели вперёд. Для ручного запуска можно указать прошлые даты.
</p>
```

2. Remove `min={defaults?.startDate || undefined}` from the «С» date input (keep `min` on «По» as `dateRange.from`).

- [ ] **Step 3: Verify**

Run: `cd backend && npm test -- tests/crm-dates.test.js tests/scheduler.test.js`
Expected: PASS

Manual: set «С» to a past date, run parsing — should not clamp to today.

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/parsing.js frontend/src/pages/Dashboard.jsx
git commit -m "feat: allow manual parsing for past dates"
```

---

### Task 6: `attachTonyBooking` service

**Files:**
- Create: `backend/src/services/attach-tony-booking.js`
- Create: `backend/tests/attach-tony-booking.test.js`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/attach-tony-booking.test.js` (reuse fixture from import-by-booking):

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tonyHtml = fs.readFileSync(path.join(__dirname, 'fixtures/tony-order-169120.html'), 'utf-8');

vi.mock('../src/services/tony-auth.js', () => ({
  tonyLogin: vi.fn().mockResolvedValue(undefined),
  getTonyConfig: () => ({ baseUrl: 'https://tony.test', login: 'u', password: 'p' }),
}));

vi.mock('../src/services/tony-client.js', () => ({
  fetchTonyOrderHtml: vi.fn(),
}));

vi.mock('../src/services/twenty-sync.js', () => ({
  resyncDealIfSynced: vi.fn().mockResolvedValue({ action: 'updated', twentyId: 'opp-1' }),
}));

vi.mock('../src/services/classifier.js', () => ({
  classifyItems: vi.fn(async (items) =>
    items.map((item) => ({
      ...item,
      classification: 'keyword_match',
      classification_confidence: 1,
    })),
  ),
}));

import { getDb, initDb } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { fetchTonyOrderHtml } from '../src/services/tony-client.js';
import { resyncDealIfSynced } from '../src/services/twenty-sync.js';
import { attachTonyBooking } from '../src/services/attach-tony-booking.js';
import { bookingDealKey } from '../src/services/deal-keys.js';

describe('attachTonyBooking', () => {
  beforeEach(() => {
    initDb();
    migrate();
    const db = getDb();
    db.prepare('DELETE FROM deal_items').run();
    db.prepare('DELETE FROM deals').run();
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('keywords', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(JSON.stringify(['брендинг', 'баннер', 'печать']));
    vi.mocked(fetchTonyOrderHtml).mockResolvedValue(tonyHtml);
    vi.mocked(resyncDealIfSynced).mockClear();
  });

  it('attaches booking to calendar deal and preserves sync_override', async () => {
    const db = getDb();
    const dealInsert = db.prepare(`
      INSERT INTO deals (crm_event_id, deal_key, data_source, title, company_code, twenty_id, approval_status)
      VALUES ('evt1', 'evt1#cal', 'calendar', 'Calendar Event', 'ACME', 'opp-1', 'synced')
    `).run();
    const dealId = dealInsert.lastInsertRowid;
    db.prepare(`
      INSERT INTO deal_items (deal_id, name, price, quantity, classification, sync_override)
      VALUES (?, 'Old banner', 500, '1', 'keyword_match', 'include')
    `).run(dealId);

    const result = await attachTonyBooking(dealId, '169120');

    expect(result.bookingNumber).toBe('169120');
    const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(dealId);
    expect(deal.tony_order_id).toBe('169120');
    expect(deal.deal_key).toBe(bookingDealKey('169120'));
    expect(deal.data_source).toBe('tony');
    expect(deal.title).toBe('Calendar Event');
    expect(deal.company_code).toBe('ACME');
    expect(resyncDealIfSynced).toHaveBeenCalledWith(dealId);

    const items = db.prepare('SELECT * FROM deal_items WHERE deal_id = ?').all(dealId);
    expect(items.length).toBeGreaterThan(0);
  });

  it('throws 409 when booking owned by another deal', async () => {
    const db = getDb();
    db.prepare(`
      INSERT INTO deals (crm_event_id, deal_key, data_source, title, tony_order_id)
      VALUES ('evt2', 'booking#169120', 'tony', 'Other', '169120')
    `).run();
    const cal = db.prepare(`
      INSERT INTO deals (crm_event_id, deal_key, data_source, title)
      VALUES ('evt1', 'evt1#cal', 'calendar', 'Mine')
    `).run();

    await expect(attachTonyBooking(cal.lastInsertRowid, '169120')).rejects.toMatchObject({
      status: 409,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- tests/attach-tony-booking.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement service**

Create `backend/src/services/attach-tony-booking.js`:

```js
import { getDb } from '../db/connection.js';
import { tonyLogin, getTonyConfig } from './tony-auth.js';
import { fetchTonyOrderHtml } from './tony-client.js';
import { parseTonyOrder } from './tony-parser.js';
import {
  buildTonyDealFields,
  buildTonyItems,
  tonyContentHash,
} from './tony-mapping.js';
import { classifyItems } from './classifier.js';
import { bookingDealKey } from './deal-keys.js';
import {
  buildOverrideMap,
  replaceDealItemsPreservingOverrides,
} from './deal-items-update.js';
import { resyncDealIfSynced } from './twenty-sync.js';

function getSetting(key) {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row?.value || '';
}

async function ensureTonyReady() {
  const { login, password, baseUrl } = getTonyConfig();
  if (!baseUrl) throw Object.assign(new Error('Tony not configured'), { status: 500 });
  if (!login || !password) {
    throw Object.assign(new Error('Tony credentials not configured'), { status: 500 });
  }
  await tonyLogin();
}

export async function attachTonyBooking(dealId, bookingNumber) {
  if (!/^\d+$/.test(bookingNumber)) {
    throw Object.assign(new Error('bookingNumber must contain only digits'), { status: 400 });
  }

  const db = getDb();
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(dealId);
  if (!deal) throw Object.assign(new Error('Deal not found'), { status: 404 });

  const targetKey = bookingDealKey(bookingNumber);
  const conflict = db.prepare('SELECT id FROM deals WHERE deal_key = ? AND id != ?').get(targetKey, dealId);
  if (conflict) {
    throw Object.assign(new Error('Бронь уже привязана к другой сделке'), { status: 409 });
  }

  await ensureTonyReady();
  const tonyHtml = await fetchTonyOrderHtml(bookingNumber);
  if (!tonyHtml) throw Object.assign(new Error('Бронь не найдена'), { status: 404 });

  const order = parseTonyOrder(tonyHtml);
  if (!order?.items?.length) {
    throw Object.assign(new Error('Нет позиций в заказе Tony'), { status: 404 });
  }

  const keywords = JSON.parse(getSetting('keywords') || '[]');
  const classifiedItems = await classifyItems(
    buildTonyItems(order),
    keywords,
    getSetting('llm_prompt'),
  );
  const fields = buildTonyDealFields(order);
  const hash = tonyContentHash(order);

  const existingItems = db.prepare('SELECT * FROM deal_items WHERE deal_id = ?').all(dealId);
  const overrideMap = buildOverrideMap(existingItems);

  db.prepare(`
    UPDATE deals SET
      tony_order_id = ?,
      deal_key = ?,
      data_source = 'tony',
      address = ?, work_time = ?, arrival_time = ?, dismantle_time = ?,
      load_date = ?, load_time = ?, budget = ?,
      start_date = ?, end_date = ?,
      content_hash = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    bookingNumber,
    targetKey,
    fields.address,
    fields.work_time,
    fields.arrival_time,
    fields.dismantle_time,
    fields.load_date,
    fields.load_time,
    fields.budget,
    fields.start_date,
    fields.end_date,
    hash,
    dealId,
  );

  replaceDealItemsPreservingOverrides(db, dealId, classifiedItems, overrideMap);

  const sync = await resyncDealIfSynced(dealId);
  const itemCount = db.prepare('SELECT COUNT(*) AS c FROM deal_items WHERE deal_id = ?').get(dealId).c;

  return {
    success: true,
    dealId,
    bookingNumber,
    itemCount,
    sync,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- tests/attach-tony-booking.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/attach-tony-booking.js backend/tests/attach-tony-booking.test.js
git commit -m "feat: add attachTonyBooking service"
```

---

### Task 7: `PATCH /deals/:id/tony-booking` route

**Files:**
- Modify: `backend/src/routes/deals.js`

- [ ] **Step 1: Add route**

In `backend/src/routes/deals.js`, import `attachTonyBooking` and add:

```js
router.patch('/:id/tony-booking', async (req, res, next) => {
  try {
    const bookingNumber = String(req.body?.bookingNumber ?? '').trim();
    const result = await attachTonyBooking(Number(req.params.id), bookingNumber);
    res.json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
});
```

Place this route **before** `router.get('/:id', ...)` or ensure Express won't confuse paths — actually `/:id/tony-booking` is more specific than `/:id` for PATCH, but `GET /:id` is fine. Put after `POST /:id/resync`.

- [ ] **Step 2: Add route test**

Append to `backend/tests/deal-item-resync.test.js` or create minimal test in `attach-tony-booking.test.js` using supertest with mocked `attachTonyBooking`.

- [ ] **Step 3: Run full backend tests**

Run: `cd backend && npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/deals.js
git commit -m "feat: add PATCH /deals/:id/tony-booking endpoint"
```

---

### Task 8: Frontend Tony booking field

**Files:**
- Create: `frontend/src/components/TonyBookingField.jsx`
- Modify: `frontend/src/components/DealCard.jsx`
- Modify: `frontend/src/components/DealRow.jsx`
- Modify: `frontend/src/api.js`

- [ ] **Step 1: Add API hook**

In `frontend/src/api.js`:

```js
export function useAttachTonyBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId, bookingNumber }) =>
      api.patch(`/deals/${dealId}/tony-booking`, { bookingNumber }).then((r) => r.data),
    onSuccess: (_, { dealId }) => {
      qc.invalidateQueries({ queryKey: ['deal', dealId] });
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['sync-logs'] });
    },
  });
}
```

- [ ] **Step 2: Create component**

Create `frontend/src/components/TonyBookingField.jsx`:

```jsx
import { useState } from 'react';
import { useAttachTonyBooking } from '../api';

export default function TonyBookingField({ dealId, currentBookingId }) {
  const [value, setValue] = useState(currentBookingId || '');
  const attach = useAttachTonyBooking();

  function handleSubmit(e) {
    e.preventDefault();
    const bookingNumber = value.trim();
    if (!/^\d+$/.test(bookingNumber)) return;
    attach.mutate({ dealId, bookingNumber });
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2 mb-4" onClick={(e) => e.stopPropagation()}>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-ink-muted text-xs font-medium">ID брони Tony</span>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={value}
          onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))}
          placeholder="169120"
          className="input-field w-32"
          disabled={attach.isPending}
        />
      </label>
      <button type="submit" disabled={attach.isPending || !/^\d+$/.test(value.trim())} className="btn-secondary btn-sm">
        {attach.isPending ? 'Загрузка...' : 'Привязать'}
      </button>
      {attach.isError && (
        <p className="text-xs text-pastel-red-text w-full">{attach.error?.response?.data?.error || attach.error?.message}</p>
      )}
    </form>
  );
}
```

- [ ] **Step 3: Add to DealCard and DealRow**

Import and place `<TonyBookingField dealId={deal.id} currentBookingId={details?.tony_order_id} />` above `<DealItems ...>` in expanded sections of both components.

- [ ] **Step 4: Manual smoke check**

1. Open calendar deal without `tony_order_id`.
2. Enter valid booking number → items load from Tony.
3. Synced deal → Twenty updates (check logs).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/TonyBookingField.jsx frontend/src/components/DealCard.jsx frontend/src/components/DealRow.jsx frontend/src/api.js
git commit -m "feat: add Tony booking attach UI on deal detail"
```

---

## Final Verification

- [ ] Run: `cd backend && npm test` — all pass
- [ ] Build frontend: `cd frontend && npm run build` — no errors
- [ ] Smoke: synced deal checkbox → auto-sync; past parse; Tony attach

---

## Spec Coverage Checklist

| Spec requirement | Task |
|------------------|------|
| Unlock synced deal UI | Task 3 |
| Auto-resync on item mutations | Tasks 1–2 |
| Keep «Пересинхр.» button | Task 3 (no removal) |
| `normalizeManualParseRange` | Task 4 |
| Manual parse route | Task 5 |
| Scheduler unchanged | Task 4–5 (no scheduler edits) |
| `attachTonyBooking` + conflict 409 | Task 6 |
| `PATCH /tony-booking` | Task 7 |
| Tony booking UI | Task 8 |
| Preserve sync_override on attach | Task 6 test |
| Preserve calendar title/contacts on attach | Task 6 implementation |
