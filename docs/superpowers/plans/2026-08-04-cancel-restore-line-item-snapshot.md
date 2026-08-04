# Cancel/restore line-item snapshot + calendar miss streak — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop false calendar cancels (3-miss streak) and restore line-item stages from a SQLite snapshot when a cancelled deal returns.

**Architecture:** Persist `calendar_miss_streak` + pre-cancel stage snapshot on `deals`. Calendar miss only cancels after streak ≥ 3; title-driven cancel stays immediate. `cancelDealInTwenty` writes the snapshot then sets opportunity + line items to `OTMENA`; `restoreDealInTwenty` restores opportunity and each line item from the snapshot.

**Tech Stack:** Node ESM, better-sqlite3, Vitest, Twenty GraphQL via axios.

**Spec:** `docs/superpowers/specs/2026-08-04-cancel-restore-line-item-snapshot-design.md`

## Global Constraints

- Work in repo `crmparserv2` on branch `staging` (or a feature branch off it).
- TDD: failing test → implement → pass → commit per task.
- Do not push unless asked.
- Do not change `isProtectedLineItemStage` sync rules.
- Title-driven `removeDealIds` cancel stays immediate (no streak).
- `CALENDAR_MISS_CANCEL_THRESHOLD = 3` exactly.
- Snapshot lives only in local SQLite (not Twenty fields).
- Restore returns only `stage` for line items (no print-sheet rollback).

---

## File map

| File | Responsibility |
|------|----------------|
| `backend/src/db/schema.sql` | New `deals` columns for fresh installs |
| `backend/src/db/migrate.js` | `ensureColumn` for existing DBs |
| `backend/src/services/calendar-missing.js` | Threshold constant, streak bump/reset, cancel-ready collection |
| `backend/tests/calendar-missing.test.js` | Streak unit tests |
| `backend/src/services/parser.js` | Use cancel-ready helper instead of raw missing list |
| `backend/src/services/twenty-sync.js` | Snapshot on cancel; restore line items + opportunity from snapshot |
| `backend/tests/twenty-sync.test.js` | Cancel snapshot + restore line-item tests (extend db mock) |
| Spec status | Mark Approved after implementation plan start / first task |

---

### Task 1: Schema + migration columns

**Files:**
- Modify: `backend/src/db/schema.sql` (deals table)
- Modify: `backend/src/db/migrate.js` (ensureColumn block near `twenty_stage`)
- Modify: `docs/superpowers/specs/2026-08-04-cancel-restore-line-item-snapshot-design.md` (status → Approved)

**Interfaces:**
- Produces: columns `calendar_miss_streak INTEGER NOT NULL DEFAULT 0`, `pre_cancel_opportunity_stage TEXT`, `line_item_stage_snapshot_json TEXT` on `deals`

- [ ] **Step 1: Update `schema.sql` deals table**

Add after `twenty_stage TEXT,`:

```sql
  calendar_miss_streak INTEGER NOT NULL DEFAULT 0,
  pre_cancel_opportunity_stage TEXT,
  line_item_stage_snapshot_json TEXT,
```

- [ ] **Step 2: Update `migrate.js`**

Immediately after `ensureColumn(db, 'deals', 'twenty_stage', 'TEXT');` add:

```js
  ensureColumn(db, 'deals', 'calendar_miss_streak', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'deals', 'pre_cancel_opportunity_stage', 'TEXT');
  ensureColumn(db, 'deals', 'line_item_stage_snapshot_json', 'TEXT');
```

- [ ] **Step 3: Mark spec Approved**

In the design spec header, set:

```markdown
**Статус:** Approved
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/db/schema.sql backend/src/db/migrate.js docs/superpowers/specs/2026-08-04-cancel-restore-line-item-snapshot-design.md
git commit -m "$(cat <<'EOF'
Add deals columns for cancel snapshot and calendar miss streak.

EOF
)"
```

---

### Task 2: Calendar miss streak helpers (TDD)

**Files:**
- Modify: `backend/src/services/calendar-missing.js`
- Modify: `backend/tests/calendar-missing.test.js`

**Interfaces:**
- Consumes: existing `isDealStillInCalendar`, `findDealsMissingFromCalendar` query shape, `CANCELLED_OPPORTUNITY_STAGE`
- Produces:
  - `export const CALENDAR_MISS_CANCEL_THRESHOLD = 3`
  - `export function bumpCalendarMissStreak(db, dealId): number`
  - `export function resetCalendarMissStreak(db, dealId): void`
  - `export function collectDealsReadyToCancelFromCalendar(db, calendarEventIds, startDate, endDate, calendarBookingNumbers = new Set()): deal[]`
    - For each synced non-`OTMENA` deal in parse range: if still in calendar → reset streak to 0; else bump streak and include in result iff new streak ≥ threshold
  - Keep `findDealsMissingFromCalendar` as a pure “is missing?” helper (no streak mutation) for existing tests

- [ ] **Step 1: Write failing tests in `calendar-missing.test.js`**

Extend `makeDb` so deals are mutable Maps/objects and `prepare` supports streak SQL:

```js
function makeDb(deals) {
  const byId = new Map(deals.map((d) => [d.id, { calendar_miss_streak: 0, ...d }]));
  return {
    prepare(sql) {
      return {
        all(stageParam) {
          const rows = [...byId.values()];
          if (sql.includes('twenty_stage = ?') && !sql.includes('twenty_stage !=')) {
            return rows.filter((deal) => deal.twenty_id && deal.twenty_stage === stageParam);
          }
          return rows.filter(
            (deal) => deal.twenty_id && (deal.twenty_stage == null || deal.twenty_stage !== stageParam),
          );
        },
        get(dealId) {
          if (sql.includes('calendar_miss_streak') && sql.includes('WHERE id')) {
            const deal = byId.get(dealId);
            return deal ? { calendar_miss_streak: deal.calendar_miss_streak ?? 0 } : null;
          }
          return byId.get(dealId) || null;
        },
        run(...params) {
          if (sql.includes('calendar_miss_streak = 0')) {
            const deal = byId.get(params[0]);
            if (deal) deal.calendar_miss_streak = 0;
            return { changes: deal ? 1 : 0 };
          }
          if (sql.includes('calendar_miss_streak = calendar_miss_streak + 1')
            || sql.includes('calendar_miss_streak = ?')) {
            const dealId = params[params.length - 1];
            const deal = byId.get(dealId);
            if (!deal) return { changes: 0 };
            if (params.length === 2 && typeof params[0] === 'number') {
              deal.calendar_miss_streak = params[0];
            } else {
              deal.calendar_miss_streak = (deal.calendar_miss_streak ?? 0) + 1;
            }
            return { changes: 1 };
          }
          return { changes: 0 };
        },
      };
    },
    __get(id) {
      return byId.get(id);
    },
  };
}
```

Add imports for the new exports. Add tests:

```js
import {
  collectCalendarEventIds,
  collectCalendarBookingNumbers,
  findDealsMissingFromCalendar,
  findCancelledDealsBackInCalendar,
  CALENDAR_MISS_CANCEL_THRESHOLD,
  bumpCalendarMissStreak,
  resetCalendarMissStreak,
  collectDealsReadyToCancelFromCalendar,
} from '../src/services/calendar-missing.js';

it('exports miss cancel threshold of 3', () => {
  expect(CALENDAR_MISS_CANCEL_THRESHOLD).toBe(3);
});

it('bumps and resets calendar_miss_streak', () => {
  const db = makeDb([
    {
      id: 1,
      crm_event_id: '99',
      deal_key: '99#cal',
      twenty_id: 'opp-1',
      start_date: '2026-06-12T10:00:00+03:00',
      twenty_stage: null,
      calendar_miss_streak: 0,
    },
  ]);
  expect(bumpCalendarMissStreak(db, 1)).toBe(1);
  expect(db.__get(1).calendar_miss_streak).toBe(1);
  expect(bumpCalendarMissStreak(db, 1)).toBe(2);
  resetCalendarMissStreak(db, 1);
  expect(db.__get(1).calendar_miss_streak).toBe(0);
});

it('collectDealsReadyToCancelFromCalendar requires 3 consecutive misses', () => {
  const db = makeDb([
    {
      id: 2,
      crm_event_id: '99',
      deal_key: '99#cal',
      twenty_id: 'opp-2',
      start_date: '2026-06-12T10:00:00+03:00',
      twenty_stage: null,
      calendar_miss_streak: 0,
    },
  ]);
  const calendarIds = new Set(['10']);
  const r1 = collectDealsReadyToCancelFromCalendar(db, calendarIds, startDate, endDate);
  expect(r1).toEqual([]);
  expect(db.__get(2).calendar_miss_streak).toBe(1);

  const r2 = collectDealsReadyToCancelFromCalendar(db, calendarIds, startDate, endDate);
  expect(r2).toEqual([]);
  expect(db.__get(2).calendar_miss_streak).toBe(2);

  const r3 = collectDealsReadyToCancelFromCalendar(db, calendarIds, startDate, endDate);
  expect(r3.map((d) => d.id)).toEqual([2]);
  expect(db.__get(2).calendar_miss_streak).toBe(3);
});

it('resets streak when deal reappears in calendar before threshold', () => {
  const db = makeDb([
    {
      id: 2,
      crm_event_id: '99',
      deal_key: '99#cal',
      twenty_id: 'opp-2',
      start_date: '2026-06-12T10:00:00+03:00',
      twenty_stage: null,
      calendar_miss_streak: 0,
    },
  ]);
  collectDealsReadyToCancelFromCalendar(db, new Set(['10']), startDate, endDate);
  collectDealsReadyToCancelFromCalendar(db, new Set(['10']), startDate, endDate);
  expect(db.__get(2).calendar_miss_streak).toBe(2);

  const ready = collectDealsReadyToCancelFromCalendar(db, new Set(['99']), startDate, endDate);
  expect(ready).toEqual([]);
  expect(db.__get(2).calendar_miss_streak).toBe(0);
});

it('does not cancel-ready already OTMENA deals', () => {
  const db = makeDb([
    {
      id: 4,
      crm_event_id: '77',
      deal_key: '77#cal',
      twenty_id: 'opp-4',
      start_date: '2026-06-08T10:00:00+03:00',
      twenty_stage: 'OTMENA',
      calendar_miss_streak: 10,
    },
  ]);
  const ready = collectDealsReadyToCancelFromCalendar(db, new Set(['10']), startDate, endDate);
  expect(ready).toEqual([]);
});
```

Keep existing `findDealsMissingFromCalendar` tests unchanged (they still assert pure missing detection without streak).

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd backend && npm test -- tests/calendar-missing.test.js
```

Expected: FAIL — `CALENDAR_MISS_CANCEL_THRESHOLD` / new functions not exported.

- [ ] **Step 3: Implement in `calendar-missing.js`**

Add exports (keep `isDealStillInCalendar` private / non-exported):

```js
export const CALENDAR_MISS_CANCEL_THRESHOLD = 3;

export function bumpCalendarMissStreak(db, dealId) {
  db.prepare(`
    UPDATE deals
    SET calendar_miss_streak = COALESCE(calendar_miss_streak, 0) + 1
    WHERE id = ?
  `).run(dealId);
  const row = db.prepare('SELECT calendar_miss_streak FROM deals WHERE id = ?').get(dealId);
  return row?.calendar_miss_streak ?? 0;
}

export function resetCalendarMissStreak(db, dealId) {
  db.prepare('UPDATE deals SET calendar_miss_streak = 0 WHERE id = ?').run(dealId);
}

export function collectDealsReadyToCancelFromCalendar(
  db,
  calendarEventIds,
  startDate,
  endDate,
  calendarBookingNumbers = new Set(),
) {
  const deals = db.prepare(`
    SELECT * FROM deals
    WHERE twenty_id IS NOT NULL
      AND (twenty_stage IS NULL OR twenty_stage != ?)
  `).all(CANCELLED_OPPORTUNITY_STAGE);

  const ready = [];
  for (const deal of deals) {
    if (!isEventInRange({ start: deal.start_date }, startDate, endDate)) continue;

    if (isDealStillInCalendar(deal, calendarEventIds, calendarBookingNumbers)) {
      resetCalendarMissStreak(db, deal.id);
      continue;
    }

    const streak = bumpCalendarMissStreak(db, deal.id);
    if (streak >= CALENDAR_MISS_CANCEL_THRESHOLD) {
      ready.push({ ...deal, calendar_miss_streak: streak });
    }
  }
  return ready;
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd backend && npm test -- tests/calendar-missing.test.js
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/calendar-missing.js backend/tests/calendar-missing.test.js
git commit -m "$(cat <<'EOF'
Require 3 calendar misses before auto-cancelling a deal.

EOF
)"
```

---

### Task 3: Wire parser cancel queue to streak helper

**Files:**
- Modify: `backend/src/services/parser.js` (imports + cancel-queue block ~514–545)

**Interfaces:**
- Consumes: `collectDealsReadyToCancelFromCalendar`
- Produces: parser cancel loop only cancels streak-ready deals; title-driven `removeDealIds` unchanged

- [ ] **Step 1: Update imports in `parser.js`**

Replace `findDealsMissingFromCalendar` import with (or add):

```js
import {
  collectCalendarEventIds,
  collectCalendarBookingNumbers,
  collectDealsReadyToCancelFromCalendar,
  findCancelledDealsBackInCalendar,
} from './calendar-missing.js';
```

If `findDealsMissingFromCalendar` is unused after change, remove it from the import.

- [ ] **Step 2: Replace cancel-queue collection**

Replace:

```js
    const missingDeals = findDealsMissingFromCalendar(
      db,
      calendarEventIds,
      startDate,
      endDate,
      calendarBookingNumbers,
    );
```

with:

```js
    const missingDeals = collectDealsReadyToCancelFromCalendar(
      db,
      calendarEventIds,
      startDate,
      endDate,
      calendarBookingNumbers,
    );
```

Keep log key `parse.cancel_queue` (same variable name is fine). Leave `plan.removeDealIds` → `cancelDealInTwenty` as-is.

- [ ] **Step 3: Smoke-run calendar-missing + a quick grep**

```bash
cd backend && npm test -- tests/calendar-missing.test.js
rg "findDealsMissingFromCalendar|collectDealsReadyToCancelFromCalendar" backend/src/services/parser.js
```

Expected: tests PASS; parser uses `collectDealsReadyToCancelFromCalendar`.

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/parser.js
git commit -m "$(cat <<'EOF'
Gate calendar auto-cancel on miss streak in the parse loop.

EOF
)"
```

---

### Task 4: Snapshot on cancel (TDD)

**Files:**
- Modify: `backend/src/services/twenty-sync.js` (`cancelDealInTwenty`)
- Modify: `backend/tests/twenty-sync.test.js` (db mock SQL handlers + tests)

**Interfaces:**
- Consumes: `listLineItemsForOpportunity` (already returns `id name stage istochnik`)
- Produces: on cancel, before Twenty mutations, persist:
  - `pre_cancel_opportunity_stage` = `deal.twenty_stage` (may be null)
  - `line_item_stage_snapshot_json` = `JSON.stringify(items.map(({id, stage}) => ({id, stage})))`
  - **Do not overwrite** if `line_item_stage_snapshot_json` is already a non-empty string
- Log `cancel.snapshot` via `logTwentyStep` with `{ lineItemCount, opportunityStage }`

- [ ] **Step 1: Extend db mock in `twenty-sync.test.js`**

In the `run(...)` handler, before the generic `return { changes: 1 }`, add:

```js
          if (sql.includes('line_item_stage_snapshot_json') && sql.includes('pre_cancel_opportunity_stage')) {
            const deal = deals.get(params[params.length - 1]);
            if (deal) {
              // UPDATE ... SET pre_cancel_opportunity_stage = ?, line_item_stage_snapshot_json = ?
              // WHERE id = ? AND (line_item_stage_snapshot_json IS NULL OR line_item_stage_snapshot_json = '')
              // params: [stage, json, id] OR clear: [null, null, 0, id]
              if (sql.includes('IS NULL OR')) {
                if (deal.line_item_stage_snapshot_json) return { changes: 0 };
                deal.pre_cancel_opportunity_stage = params[0];
                deal.line_item_stage_snapshot_json = params[1];
                return { changes: 1 };
              }
              deal.pre_cancel_opportunity_stage = params[0];
              deal.line_item_stage_snapshot_json = params[1];
              if (sql.includes('calendar_miss_streak')) {
                deal.calendar_miss_streak = params[2] ?? 0;
              }
              return { changes: 1 };
            }
            return { changes: 0 };
          }
```

Also extend the existing restore `status = NULL` UPDATE handler later in Task 5; for now ensure cancel UPDATE that sets `twenty_stage` still works.

Seed defaults in `__seedDeal`:

```js
deals.set(id, {
  calendar_miss_streak: 0,
  pre_cancel_opportunity_stage: null,
  line_item_stage_snapshot_json: null,
  ...deal,
  id,
});
```

- [ ] **Step 2: Write failing cancel snapshot test**

Inside `describe('cancelDealInTwenty'` / same file’s cancel tests section, add:

```js
  it('writes line-item stage snapshot before cancelling', async () => {
    const dealId = dbMock.__seedDeal({
      id: 7,
      twenty_id: 'opp-snap',
      twenty_stage: 'V_RABOTE',
      approval_status: 'synced',
      title: 'Snap deal',
      start_date: '2026-06-10',
      crm_event_id: 'e7',
    });

    axiosPost
      .mockResolvedValueOnce(gqlOk({ updateOpportunity: { id: 'opp-snap' } }))
      .mockResolvedValueOnce(gqlOk({
        dealLineItems: {
          edges: [
            { node: { id: 'li-a', name: 'Фриз', stage: 'V_PECHATI' } },
            { node: { id: 'li-b', name: 'Стойка', stage: 'NOVYY' } },
            { node: { id: 'li-c', name: 'Старое', stage: 'OTMENA' } },
          ],
        },
      }))
      .mockResolvedValueOnce(gqlOk({ updateDealLineItem: { id: 'li-a' } }))
      .mockResolvedValueOnce(gqlOk({ updateDealLineItem: { id: 'li-b' } }));

    await cancelDealInTwenty(dealId);

    const deal = dbMock.getDb().prepare('SELECT * FROM deals WHERE id = ?').get(dealId);
    expect(deal.pre_cancel_opportunity_stage).toBe('V_RABOTE');
    expect(JSON.parse(deal.line_item_stage_snapshot_json)).toEqual([
      { id: 'li-a', stage: 'V_PECHATI' },
      { id: 'li-b', stage: 'NOVYY' },
      { id: 'li-c', stage: 'OTMENA' },
    ]);
    expect(deal.twenty_stage).toBe('OTMENA');
  });

  it('does not overwrite an existing cancel snapshot when already cancelled', async () => {
    const existing = JSON.stringify([{ id: 'li-old', stage: 'OKLEYKA' }]);
    const dealId = dbMock.__seedDeal({
      id: 8,
      twenty_id: 'opp-keep-snap',
      twenty_stage: 'OTMENA',
      pre_cancel_opportunity_stage: 'V_RABOTE',
      line_item_stage_snapshot_json: existing,
      crm_event_id: 'e8',
    });

    const result = await cancelDealInTwenty(dealId);
    expect(result.skipped).toBe(true);
    const deal = dbMock.getDb().prepare('SELECT * FROM deals WHERE id = ?').get(dealId);
    expect(deal.line_item_stage_snapshot_json).toBe(existing);
    expect(axiosPost).not.toHaveBeenCalled();
  });
```

Also update the existing cancel test so listLineItems is still mocked in the same order: opportunity update → list → per-item updates. Current test order is already that — keep it. After snapshot is written **before** opportunity update, mock order stays the same if list is fetched before opp update. Spec order: list → write snapshot → opp OTMENA → line items OTMENA. **Change mock order in existing cancel test:**

```js
    axiosPost
      .mockResolvedValueOnce(gqlOk({
        dealLineItems: {
          edges: [
            { node: { id: 'li-novyy', name: 'Баннер', stage: 'NOVYY' } },
            { node: { id: 'li-protected', name: 'Ролл-ап', stage: 'V_PECHATI' } },
            { node: { id: 'li-cancelled', name: 'Наклейка', stage: 'OTMENA' } },
          ],
        },
      }))
      .mockResolvedValueOnce(gqlOk({ updateOpportunity: { id: 'opp-cancel' } }))
      .mockResolvedValueOnce(gqlOk({ updateDealLineItem: { id: 'li-novyy' } }))
      .mockResolvedValueOnce(gqlOk({ updateDealLineItem: { id: 'li-protected' } }));
```

And update assertions: first call is list query (or second if snapshot is local-only). Prefer: first axios call = list OR updateOpportunity depending on implementation — **implement list first**, so:

- calls[0] = ListLineItems
- calls[1] = CancelOpportunity  
- calls[2+] = updateDealLineItem

Update existing test expectations accordingly:

```js
    expect(axiosPost.mock.calls[1][1].variables.input.stage).toBe('OTMENA');
```

- [ ] **Step 3: Run cancel-related tests — expect FAIL**

```bash
cd backend && npm test -- tests/twenty-sync.test.js
```

Expected: FAIL on snapshot assertions / call order.

- [ ] **Step 4: Implement snapshot in `cancelDealInTwenty`**

Replace the try-body start with:

```js
  try {
    const existingLineItems = await listLineItemsForOpportunity(
      gql,
      twenty.apiUrl,
      twenty.apiToken,
      deal.twenty_id,
    );

    const existingSnapshot = deal.line_item_stage_snapshot_json;
    if (!existingSnapshot) {
      const snapshot = existingLineItems.map((li) => ({ id: li.id, stage: li.stage ?? null }));
      db.prepare(`
        UPDATE deals
        SET pre_cancel_opportunity_stage = ?,
            line_item_stage_snapshot_json = ?
        WHERE id = ?
          AND (line_item_stage_snapshot_json IS NULL OR line_item_stage_snapshot_json = '')
      `).run(deal.twenty_stage ?? null, JSON.stringify(snapshot), dealId);
      logTwentyStep('cancel.snapshot', {
        lineItemCount: snapshot.length,
        opportunityStage: deal.twenty_stage ?? null,
      });
    }

    const oppResp = await gql(
      twenty.apiUrl,
      twenty.apiToken,
      `mutation CancelOpportunity($id: ID!, $input: OpportunityUpdateInput!) {
        updateOpportunity(id: $id, data: $input) { id }
      }`,
      { id: deal.twenty_id, input: { stage: CANCELLED_OPPORTUNITY_STAGE } }
    );
    assertHttpSuccess(oppResp, twenty.apiUrl);
    assertGqlSuccess(oppResp, 'Failed to cancel opportunity in Twenty');

    // Re-list inside cancelLineItemsForOpportunity (v1: no signature change).
    const lineItemCancel = await cancelLineItemsForOpportunity(
      gql,
      twenty.apiUrl,
      twenty.apiToken,
      deal.twenty_id,
      { assertHttpSuccess, assertGqlSuccess },
    );
```

Import `listLineItemsForOpportunity` from `./twenty-line-items-sync.js` alongside `cancelLineItemsForOpportunity`.

- [ ] **Step 5: Run tests — expect PASS**

```bash
cd backend && npm test -- tests/twenty-sync.test.js
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/twenty-sync.js backend/tests/twenty-sync.test.js
git commit -m "$(cat <<'EOF'
Snapshot line-item stages before cancelling a deal in Twenty.

EOF
)"
```

---

### Task 5: Restore opportunity + line items from snapshot (TDD)

**Files:**
- Modify: `backend/src/services/twenty-sync.js` (`restoreDealInTwenty`)
- Modify: `backend/tests/twenty-sync.test.js`

**Interfaces:**
- Consumes: `pre_cancel_opportunity_stage`, `line_item_stage_snapshot_json`
- Produces: restore opp stage from snapshot (fallback `getOpportunityStage()`); restore each line item `stage`; on full success clear snapshot fields + `calendar_miss_streak = 0`
- Skip missing ids (GQL payload without id / null update) with `logTwentyStep('restore.line_item_skipped', { lineItemId })`
- On transport/assert failure mid line-item loop: do not clear snapshot; rethrow after `restore.partial` log

- [ ] **Step 1: Extend db mock clear-snapshot UPDATE**

Handle SQL like:

```sql
UPDATE deals SET
  twenty_stage = ?,
  status = NULL,
  pre_cancel_opportunity_stage = NULL,
  line_item_stage_snapshot_json = NULL,
  calendar_miss_streak = 0,
  synced_at = datetime('now'),
  twenty_error = NULL,
  updated_at = datetime('now')
WHERE id = ?
```

In mock `run`, when `sql.includes('line_item_stage_snapshot_json = NULL')`:

```js
            const deal = deals.get(params[params.length - 1]);
            if (deal) {
              deal.twenty_stage = params[0];
              deal.status = null;
              deal.pre_cancel_opportunity_stage = null;
              deal.line_item_stage_snapshot_json = null;
              deal.calendar_miss_streak = 0;
              deal.synced_at = 'now';
              deal.twenty_error = null;
            }
            return { changes: 1 };
```

Ensure this branch is checked **before** the older `status = NULL` branch, or merge into it.

- [ ] **Step 2: Write failing restore tests**

Replace/extend existing restore test:

```js
  it('restores opportunity and line-item stages from snapshot', async () => {
    const snapshot = [
      { id: 'li-a', stage: 'V_PECHATI' },
      { id: 'li-b', stage: 'NOVYY' },
      { id: 'li-c', stage: 'OTMENA' },
    ];
    const dealId = dbMock.__seedDeal({
      id: 5,
      twenty_id: 'opp-restore',
      twenty_stage: 'OTMENA',
      status: 'отмена',
      pre_cancel_opportunity_stage: 'V_RABOTE',
      line_item_stage_snapshot_json: JSON.stringify(snapshot),
      calendar_miss_streak: 3,
      crm_event_id: 'e5',
    });

    axiosPost
      .mockResolvedValueOnce(gqlOk({ updateOpportunity: { id: 'opp-restore' } }))
      .mockResolvedValueOnce(gqlOk({ updateDealLineItem: { id: 'li-a' } }))
      .mockResolvedValueOnce(gqlOk({ updateDealLineItem: { id: 'li-b' } }))
      .mockResolvedValueOnce(gqlOk({ updateDealLineItem: { id: 'li-c' } }));

    const result = await restoreDealInTwenty(dealId);

    expect(result.action).toBe('restored');
    expect(result.stage).toBe('V_RABOTE');
    expect(axiosPost.mock.calls[0][1].variables.input.stage).toBe('V_RABOTE');

    const lineUpdates = axiosPost.mock.calls.slice(1);
    expect(lineUpdates.map(([, body]) => body.variables)).toEqual([
      { id: 'li-a', input: { stage: 'V_PECHATI' } },
      { id: 'li-b', input: { stage: 'NOVYY' } },
      { id: 'li-c', input: { stage: 'OTMENA' } },
    ]);

    const deal = dbMock.getDb().prepare('SELECT * FROM deals WHERE id = ?').get(dealId);
    expect(deal.twenty_stage).toBe('V_RABOTE');
    expect(deal.status).toBeNull();
    expect(deal.pre_cancel_opportunity_stage).toBeNull();
    expect(deal.line_item_stage_snapshot_json).toBeNull();
    expect(deal.calendar_miss_streak).toBe(0);
  });

  it('falls back to settings opportunity stage when snapshot stage missing', async () => {
    const dealId = dbMock.__seedDeal({
      id: 9,
      twenty_id: 'opp-fallback',
      twenty_stage: 'OTMENA',
      status: 'отмена',
      pre_cancel_opportunity_stage: null,
      line_item_stage_snapshot_json: '[]',
      crm_event_id: 'e9',
    });

    axiosPost.mockResolvedValueOnce(gqlOk({ updateOpportunity: { id: 'opp-fallback' } }));

    const result = await restoreDealInTwenty(dealId);
    expect(result.stage).toBe('NOVYY');
    expect(axiosPost.mock.calls[0][1].variables.input.stage).toBe('NOVYY');
  });

  it('keeps snapshot when a line-item restore hits a GQL error', async () => {
    const snapshot = [{ id: 'li-a', stage: 'V_PECHATI' }, { id: 'li-b', stage: 'NOVYY' }];
    const dealId = dbMock.__seedDeal({
      id: 10,
      twenty_id: 'opp-partial',
      twenty_stage: 'OTMENA',
      status: 'отмена',
      pre_cancel_opportunity_stage: 'V_RABOTE',
      line_item_stage_snapshot_json: JSON.stringify(snapshot),
      crm_event_id: 'e10',
    });

    axiosPost
      .mockResolvedValueOnce(gqlOk({ updateOpportunity: { id: 'opp-partial' } }))
      .mockResolvedValueOnce(gqlOk({ updateDealLineItem: { id: 'li-a' } }))
      .mockResolvedValueOnce({
        status: 200,
        data: { errors: [{ message: 'boom' }] },
      });

    await expect(restoreDealInTwenty(dealId)).rejects.toThrow(/boom|Failed/);

    const deal = dbMock.getDb().prepare('SELECT * FROM deals WHERE id = ?').get(dealId);
    expect(deal.line_item_stage_snapshot_json).toBe(JSON.stringify(snapshot));
    expect(deal.pre_cancel_opportunity_stage).toBe('V_RABOTE');
  });
```

- [ ] **Step 3: Run tests — expect FAIL**

```bash
cd backend && npm test -- tests/twenty-sync.test.js
```

Expected: FAIL — restore does not update line items / clear snapshot.

- [ ] **Step 4: Implement `restoreDealInTwenty`**

```js
export async function restoreDealInTwenty(dealId) {
  const twenty = requireTwentyConfig();
  const db = getDb();
  const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(dealId);
  if (!deal) throw new Error(`Deal ${dealId} not found`);
  if (!deal.twenty_id) return null;
  if (deal.twenty_stage !== CANCELLED_OPPORTUNITY_STAGE) {
    return { twentyId: deal.twenty_id, action: 'restored', skipped: true };
  }

  const stage = deal.pre_cancel_opportunity_stage || getOpportunityStage();
  let snapshot = [];
  if (deal.line_item_stage_snapshot_json) {
    try {
      snapshot = JSON.parse(deal.line_item_stage_snapshot_json);
      if (!Array.isArray(snapshot)) snapshot = [];
    } catch {
      snapshot = [];
    }
  }

  beginTwentySyncContext({
    dealId,
    twentyId: deal.twenty_id,
    mode: 'restore',
    title: deal.title,
  });

  logTwentyStep('restore.start', { oppId: deal.twenty_id, stage, lineItemCount: snapshot.length });

  try {
    const oppResp = await gql(
      twenty.apiUrl,
      twenty.apiToken,
      `mutation RestoreOpportunity($id: ID!, $input: OpportunityUpdateInput!) {
        updateOpportunity(id: $id, data: $input) { id }
      }`,
      { id: deal.twenty_id, input: { stage } }
    );
    assertHttpSuccess(oppResp, twenty.apiUrl);
    assertGqlSuccess(oppResp, 'Failed to restore opportunity in Twenty');

    for (const entry of snapshot) {
      if (!entry?.id) continue;
      const resp = await gql(
        twenty.apiUrl,
        twenty.apiToken,
        `mutation UpdateDealLineItem($id: ID!, $input: DealLineItemUpdateInput!) {
          updateDealLineItem(id: $id, data: $input) { id }
        }`,
        { id: entry.id, input: { stage: entry.stage ?? null } }
      );
      try {
        assertHttpSuccess(resp, twenty.apiUrl);
        assertGqlSuccess(resp, `Failed to restore line item ${entry.id} in Twenty`);
      } catch (err) {
        const msg = String(err.message || err);
        // Treat obvious not-found as skip; everything else aborts and keeps snapshot
        if (/not found|does not exist/i.test(msg)) {
          logTwentyStep('restore.line_item_skipped', { lineItemId: entry.id, error: msg });
          continue;
        }
        logTwenty('warn', 'restore.partial', { lineItemId: entry.id, error: msg });
        throw err;
      }
      if (!resp.data?.data?.updateDealLineItem?.id) {
        logTwentyStep('restore.line_item_skipped', { lineItemId: entry.id });
        continue;
      }
    }

    db.prepare(`
      UPDATE deals SET
        twenty_stage = ?,
        status = NULL,
        pre_cancel_opportunity_stage = NULL,
        line_item_stage_snapshot_json = NULL,
        calendar_miss_streak = 0,
        synced_at = datetime('now'),
        twenty_error = NULL,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(stage, dealId);

    logSyncRun(dealId, 'success', deal.twenty_id, null, 'restored');
    logTwentyStep('restore.done', { oppId: deal.twenty_id, stage });
    return { twentyId: deal.twenty_id, action: 'restored', stage };
  } catch (err) {
    logTwenty('error', 'restore.failed', { error: err.message });
    db.prepare("UPDATE deals SET twenty_error = ? WHERE id = ?").run(err.message, dealId);
    logSyncRun(dealId, 'failed', deal.twenty_id, err.message, 'restored');
    throw err;
  } finally {
    endTwentySyncContext();
  }
}
```

Note: if `assertGqlSuccess` always throws on any GraphQL error, the not-found heuristic may never hit in unit tests — that is fine; the GQL-error test covers snapshot retention.

- [ ] **Step 5: Run tests — expect PASS**

```bash
cd backend && npm test -- tests/twenty-sync.test.js tests/calendar-missing.test.js
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/twenty-sync.js backend/tests/twenty-sync.test.js
git commit -m "$(cat <<'EOF'
Restore line-item stages from cancel snapshot when a deal returns.

EOF
)"
```

---

### Task 6: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run full backend test suite**

```bash
cd backend && npm test
```

Expected: all tests PASS.

- [ ] **Step 2: Spec self-check against implementation**

Confirm each spec requirement has code:

| Spec requirement | Task |
|------------------|------|
| streak ≥ 3 | Task 2–3 |
| title-driven immediate | Task 3 (unchanged path) |
| snapshot on cancel | Task 4 |
| restore line items | Task 5 |
| columns migrated | Task 1 |
| no overwrite snapshot | Task 4 |
| partial restore keeps snapshot | Task 5 |

- [ ] **Step 3: Commit plan doc if not already committed**

If this plan file is still untracked:

```bash
git add docs/superpowers/plans/2026-08-04-cancel-restore-line-item-snapshot.md
git commit -m "$(cat <<'EOF'
Add implementation plan for cancel/restore line-item snapshots.

EOF
)"
```

---

## Spec coverage self-review

| Spec item | Plan task |
|-----------|-----------|
| `CALENDAR_MISS_CANCEL_THRESHOLD = 3` | Task 2 |
| bump/reset streak | Task 2 |
| cancel-ready only after 3 misses | Task 2–3 |
| title-driven immediate cancel | Task 3 (no change to removeDealIds) |
| SQLite columns | Task 1 |
| snapshot before OTMENA | Task 4 |
| do not overwrite snapshot | Task 4 |
| restore opp from pre_cancel / fallback | Task 5 |
| restore line item stages | Task 5 |
| clear snapshot + streak on success | Task 5 |
| keep snapshot on GQL fail | Task 5 |
| skip missing ids | Task 5 |
| tests listed in spec | Tasks 2, 4, 5 |
| non-goals (UI, soft-cancel, Twenty fields) | not scheduled |

No placeholders left after inline fixes above.
