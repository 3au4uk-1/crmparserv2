# Parent + smeta deal grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One commercial job becomes one deals-board row with visible smetas inside, without dropping Tony bookings, Bitrix links, line items, or money.

**Architecture:** Parser stays SoT: one Tony booking = one `deals` row; N Bitrix IDs live in `deal_bitrix_links`; confirmed groups live in `deal_groups`. Twenty mirrors a parent opportunity plus `parentOpportunityId` on children. The board hides children, expands smetas, and writes groups only through the existing crmparser proxy (`/api/twenty/...`). Print/expense/payment resolve the canonical Bitrix from the parser group.

**Tech Stack:** Node ESM, Vitest, better-sqlite3, Express; Twenty app (`twenty-sdk`) in `BrandingTwentyView`; existing `crmparserProxyFetch` + logic functions.

**Spec:** `docs/superpowers/specs/2026-09-16-deal-groups-parent-smeta-design.md`

**Repos:** Tasks 1–8 in `crmparserv2`. Tasks 9–10 in `C:\Users\Василий\Documents\projects\BrandingTwentyView`. Do not start TwentyView until Task 7 API exists.

## Global Constraints

- No silent merge: suggestions never insert `deal_groups`; only `confirmDealGroup` / modal POST does.
- Do not delete smeta `twenty_id`, line items, or Bitrix/Tony URLs on link or unlink.
- Do not cancel a synced `#cal` deal when a title gains multiple bookings.
- Empty/404 Tony does not drop a booking smeta.
- `deals.crm_lead_id` is a mirror of the smeta’s canonical Bitrix, not the only store.
- Parent opportunity has no line items; `amount` = Σ child amounts; payments and `rashod*` = canonical after rollup.
- Print/freza rows stay append-only; new rows use parent name + canonical Bitrix URL.
- Stage `DUBL` is unused for grouping.
- Two payments in a group → canonical is not auto-picked.
- Manual `name_locked` / `canonical_locked` are never overwritten by parse.
- Bitrix link roles: payment if that Bitrix has `payment_amount > 0` or event title matches `/оплат/i`, else `booking`.
- Soft suggest window: `load_date` (else `start_date`) ± 2 days; shared title token length ≥ 2 excluding company code, dates, booking numbers.
- UUID v4 only for new Twenty field ids.
- After TwentyView field/logic edits: `yarn twenty apply` then `yarn test:unit`.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `backend/src/db/schema.sql`, `backend/src/db/migrate.js` | `deal_bitrix_links`, `deal_groups`, `deal_group_members` + backfill |
| `backend/src/services/deal-bitrix-links.js` | upsert/list/role/mirror `crm_lead_id` / Twenty LINKS payload |
| `backend/src/services/tony-reconcile.js` | keep `#cal` `twenty_id` when title gains many bookings |
| `backend/src/services/parser.js` | append Bitrix links; do not skip empty Tony bookings |
| `backend/src/services/twenty-opportunity.js` | `bitrixLink` primary + `secondaryLinks` |
| `backend/src/services/deal-group-suggest.js` | hard/soft candidates |
| `backend/src/services/deal-groups.js` | confirm/unlink/dissolve/canonical/money/rollup |
| `backend/src/services/deal-group-twenty.js` | create/update parent opp, set `parentOpportunityId`, copy aggregates |
| `backend/src/routes/twenty.js` | `/deal-groups` GET/POST/PATCH |
| `backend/src/services/print-sheet-row-builder.js` | parent name + canonical Bitrix URL |
| `backend/src/services/expense-sync.js` | targets = canonical `twenty_id` when grouped |
| `backend/src/services/payment-sync.js` | Twenty push canonical+parent only when grouped |
| `BrandingTwentyView/src/fields/opportunity-parent.field.ts` | MANY_TO_ONE `parentOpportunity` |
| `BrandingTwentyView/src/fields/opportunity-child-smetas.field.ts` | ONE_TO_MANY inverse |
| `BrandingTwentyView/src/deals-board/utils/search.ts` | hide children; search via child names |
| `BrandingTwentyView/src/deals-board/DealsTable/DealRow.tsx` | nested smetas on expand |
| `BrandingTwentyView/src/logic-functions/deal-groups-*.ts` | proxy GET/POST/PATCH/unlink to parser |
| `BrandingTwentyView/src/deals-board/LinkDealsModal.tsx` | confirm/unlink UI |

---

### Task 1: Bitrix links store

**Files:**
- Modify: `backend/src/db/schema.sql`
- Modify: `backend/src/db/migrate.js`
- Create: `backend/src/services/deal-bitrix-links.js`
- Test: `backend/tests/deal-bitrix-links.test.js`
- Test: `backend/tests/migrate-deal-bitrix-links.test.js`

**Interfaces:**
- Consumes: `deals.crm_lead_id`, `deals.payment_amount`, event title
- Produces:
  - `inferBitrixLinkRole({ eventTitle, paymentAmount }) → 'payment' | 'booking'`
  - `upsertDealBitrixLink(db, { dealId, bitrixId, role, isCanonical? }) → void`
  - `listDealBitrixLinks(db, dealId) → Array<{ bitrixId, role, isCanonical }>`
  - `mirrorCanonicalCrmLeadId(db, dealId) → void` (sets `deals.crm_lead_id` from `is_canonical=1`)
  - `buildBitrixLinkInput(links) → { primaryLinkUrl, primaryLinkLabel, secondaryLinks }`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/deal-bitrix-links.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  inferBitrixLinkRole,
  upsertDealBitrixLink,
  listDealBitrixLinks,
  mirrorCanonicalCrmLeadId,
  buildBitrixLinkInput,
} from '../src/services/deal-bitrix-links.js';

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE deals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      crm_lead_id TEXT,
      payment_amount REAL
    );
    CREATE TABLE deal_bitrix_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      bitrix_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('payment', 'booking', 'other')),
      is_canonical INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (deal_id, bitrix_id)
    );
  `);
  db.prepare('INSERT INTO deals (crm_lead_id) VALUES (NULL)').run();
  return db;
}

describe('deal-bitrix-links', () => {
  let db;
  beforeEach(() => { db = createDb(); });
  afterEach(() => db.close());

  it('infers payment from title or amount', () => {
    expect(inferBitrixLinkRole({ eventTitle: 'ПРО/Для оплаты А7', paymentAmount: 0 })).toBe('payment');
    expect(inferBitrixLinkRole({ eventTitle: 'ПРО/точка', paymentAmount: 100 })).toBe('payment');
    expect(inferBitrixLinkRole({ eventTitle: 'ПРО/точка', paymentAmount: 0 })).toBe('booking');
  });

  it('appends a second Bitrix id without wiping the first', () => {
    upsertDealBitrixLink(db, { dealId: 1, bitrixId: '111', role: 'booking', isCanonical: true });
    upsertDealBitrixLink(db, { dealId: 1, bitrixId: '222', role: 'payment' });
    const links = listDealBitrixLinks(db, 1);
    expect(links.map((l) => l.bitrixId).sort()).toEqual(['111', '222']);
    expect(links.filter((l) => l.isCanonical)).toHaveLength(1);
  });

  it('mirrors canonical bitrix onto deals.crm_lead_id', () => {
    upsertDealBitrixLink(db, { dealId: 1, bitrixId: '111', role: 'booking', isCanonical: true });
    upsertDealBitrixLink(db, { dealId: 1, bitrixId: '222', role: 'payment' });
    mirrorCanonicalCrmLeadId(db, 1);
    expect(db.prepare('SELECT crm_lead_id FROM deals WHERE id = 1').get().crm_lead_id).toBe('111');
  });

  it('builds Twenty LINKS with secondary urls', () => {
    const input = buildBitrixLinkInput([
      { bitrixId: '111', isCanonical: true },
      { bitrixId: '222', isCanonical: false },
    ]);
    expect(input.primaryLinkLabel).toBe('Bitrix #111');
    expect(input.secondaryLinks).toEqual([
      { url: 'https://prointeractive.bitrix24.ru/crm/deal/details/222/?any', label: 'Bitrix #222' },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- tests/deal-bitrix-links.test.js`

Expected: FAIL module not found.

- [ ] **Step 3: Implement schema + helpers**

Add to `schema.sql` and the same `CREATE TABLE IF NOT EXISTS` inside `migrate()`:

```sql
CREATE TABLE IF NOT EXISTS deal_bitrix_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  bitrix_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('payment', 'booking', 'other')),
  is_canonical INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (deal_id, bitrix_id)
);
CREATE INDEX IF NOT EXISTS idx_deal_bitrix_links_bitrix ON deal_bitrix_links(bitrix_id);
```

Backfill in `migrate()` after the table exists:

```js
db.prepare(`
  INSERT OR IGNORE INTO deal_bitrix_links (deal_id, bitrix_id, role, is_canonical)
  SELECT id, TRIM(crm_lead_id), 'booking', 1
  FROM deals
  WHERE crm_lead_id IS NOT NULL AND TRIM(crm_lead_id) != ''
`).run();
```

Implement `deal-bitrix-links.js`:

```js
const BITRIX_URL = (id) => `https://prointeractive.bitrix24.ru/crm/deal/details/${id}/?any`;

export function inferBitrixLinkRole({ eventTitle, paymentAmount }) {
  if (Number(paymentAmount) > 0) return 'payment';
  if (/оплат/i.test(String(eventTitle || ''))) return 'payment';
  return 'booking';
}

export function upsertDealBitrixLink(db, { dealId, bitrixId, role, isCanonical }) {
  const id = String(bitrixId).trim();
  const existing = db.prepare(
    'SELECT id, is_canonical FROM deal_bitrix_links WHERE deal_id = ? AND bitrix_id = ?',
  ).get(dealId, id);
  if (!existing) {
    const hasCanonical = db.prepare(
      'SELECT 1 FROM deal_bitrix_links WHERE deal_id = ? AND is_canonical = 1',
    ).get(dealId);
    const canonical = isCanonical === true || (!hasCanonical && isCanonical !== false) ? 1 : 0;
    db.prepare(`
      INSERT INTO deal_bitrix_links (deal_id, bitrix_id, role, is_canonical)
      VALUES (?, ?, ?, ?)
    `).run(dealId, id, role, canonical);
    return;
  }
  db.prepare('UPDATE deal_bitrix_links SET role = ? WHERE id = ?').run(role, existing.id);
}

export function listDealBitrixLinks(db, dealId) {
  return db.prepare(
    'SELECT bitrix_id AS bitrixId, role, is_canonical AS isCanonical FROM deal_bitrix_links WHERE deal_id = ? ORDER BY id',
  ).all(dealId).map((r) => ({ ...r, isCanonical: Boolean(r.isCanonical) }));
}

export function mirrorCanonicalCrmLeadId(db, dealId) {
  const row = db.prepare(
    'SELECT bitrix_id FROM deal_bitrix_links WHERE deal_id = ? AND is_canonical = 1',
  ).get(dealId);
  if (!row) return;
  db.prepare('UPDATE deals SET crm_lead_id = ? WHERE id = ?').run(row.bitrix_id, dealId);
}

export function buildBitrixLinkInput(links) {
  const canonical = links.find((l) => l.isCanonical) || links[0];
  if (!canonical) return null;
  return {
    primaryLinkUrl: BITRIX_URL(canonical.bitrixId),
    primaryLinkLabel: `Bitrix #${canonical.bitrixId}`,
    secondaryLinks: links
      .filter((l) => l.bitrixId !== canonical.bitrixId)
      .map((l) => ({ url: BITRIX_URL(l.bitrixId), label: `Bitrix #${l.bitrixId}` })),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Add `backend/tests/migrate-deal-bitrix-links.test.js` that runs `migrate()` on a db with `deals.crm_lead_id = '2050903'` and asserts one `deal_bitrix_links` row `(bitrix_id=2050903, is_canonical=1)`.

Run: `cd backend && npm test -- tests/deal-bitrix-links.test.js tests/migrate-deal-bitrix-links.test.js tests/migrate-deal-identity.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/db/schema.sql backend/src/db/migrate.js backend/src/services/deal-bitrix-links.js backend/tests/deal-bitrix-links.test.js backend/tests/migrate-deal-bitrix-links.test.js
git commit -m "feat: store multiple Bitrix links per booking smeta"
```

---

### Task 2: Parser no longer drops bookings or Bitrix ids

**Files:**
- Modify: `backend/src/services/parser.js` (applyEvent Tony empty-items branch and `crm_lead_id = ?` writes)
- Modify: `backend/src/services/tony-reconcile.js`
- Test: `backend/tests/tony-reconcile.test.js`
- Test: `backend/tests/parser-bitrix-links.test.js`

**Interfaces:**
- Consumes: `upsertDealBitrixLink`, `inferBitrixLinkRole`, `mirrorCanonicalCrmLeadId`, `planEventReconciliation`
- Produces: `planEventReconciliation` relinks `#cal` → first booking when `desired.length > 1` if that `booking#` is free; `#cal` is **not** in `removeDealIds` when it has `twenty_id` and bookings appeared. `attachEventBitrixLink(db, dealId, { leadId, title, paymentAmount })`. Empty Tony `items` falls through to calendar write, keeping `tony_order_id`.

- [ ] **Step 1: Write the failing tests**

Extend `backend/tests/tony-reconcile.test.js` — replace the expectation that a `#cal` with `twenty_id` is removed when two bookings appear:

```js
  it('relinks a synced calendar deal to the first booking instead of cancelling', () => {
    const id = db.prepare(
      "INSERT INTO deals (crm_event_id, deal_key, data_source, twenty_id) VALUES ('evt1', 'evt1#cal', 'calendar', 'opp-1') RETURNING id",
    ).get().id;
    const plan = planEventReconciliation(db, 'evt1', ['169120', '168973']);
    expect(plan.relink).toEqual({
      dealId: id,
      newDealKey: bookingDealKey('169120'),
      bookingNumber: '169120',
    });
    expect(plan.removeDealIds).toEqual([]);
    expect(plan.desired).toHaveLength(2);
  });
```

Keep the old “cal removed” behavior only when `twenty_id` is null.

Add `backend/tests/parser-bitrix-links.test.js`:

```js
  it('keeps both Bitrix ids on one booking deal', () => {
    attachEventBitrixLink(db, 1, { leadId: '2050903', title: 'точка', paymentAmount: 0 });
    attachEventBitrixLink(db, 1, { leadId: '2049067', title: 'Для оплаты', paymentAmount: 10 });
    expect(listDealBitrixLinks(db, 1).map((l) => l.bitrixId).sort()).toEqual(['2049067', '2050903']);
  });
```

Export `useCalendarFallbackForTonyOrder(order)` from `parser.js`: `true` when `order` is missing or `order.items.length === 0`. Test that empty `{ items: [] }` is `true`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npm test -- tests/tony-reconcile.test.js tests/parser-bitrix-links.test.js`

Expected: FAIL on relink / attach helper missing.

- [ ] **Step 3: Implement**

In `planEventReconciliation`, when `existingCal.length === 1 && desired.length >= 1 && desired[0].bookingNumber`:

- If first `booking#` is free → `relink` even for `desired.length > 1`.
- If the cal row has `twenty_id` and is not relinked, **do not** push it to `removeDealIds`.

In `parser.js` `applyEvent`:

- Replace `crm_lead_id = ?` as the only Bitrix store: after insert/update call `attachEventBitrixLink`.
- Change the `if (order.items.length === 0) { counters.skippedDeals++; continue; }` block to log a warning and treat as no-Tony (`order = undefined`) so calendar items still write.

```js
export function attachEventBitrixLink(db, dealId, { leadId, title, paymentAmount }) {
  if (!leadId || !String(leadId).trim()) return;
  const deal = db.prepare('SELECT payment_amount FROM deals WHERE id = ?').get(dealId);
  upsertDealBitrixLink(db, {
    dealId,
    bitrixId: String(leadId).trim(),
    role: inferBitrixLinkRole({
      eventTitle: title,
      paymentAmount: paymentAmount ?? deal?.payment_amount ?? 0,
    }),
  });
  const links = listDealBitrixLinks(db, dealId);
  const locked = links.some((l) => l.isCanonical);
  if (!locked) {
    // first link already canonical via upsert; nothing else
  }
  mirrorCanonicalCrmLeadId(db, dealId);
}
```

Do not overwrite `crm_lead_id` from `event.leadid` when a canonical link already exists.

- [ ] **Step 4: Run tests**

Run: `cd backend && npm test -- tests/tony-reconcile.test.js tests/parser-bitrix-links.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/parser.js backend/src/services/tony-reconcile.js backend/tests/tony-reconcile.test.js backend/tests/parser-bitrix-links.test.js
git commit -m "fix: keep bookings and extra Bitrix links during parse"
```

---

### Task 3: Sync all Bitrix links to Twenty smeta

**Files:**
- Modify: `backend/src/services/twenty-opportunity.js`
- Test: `backend/tests/twenty-opportunity.test.js` (create if missing; otherwise extend existing)

**Interfaces:**
- Consumes: `listDealBitrixLinks`, `buildBitrixLinkInput`
- Produces: `buildOpportunityInput` sets `bitrixLink` from links table, not only `deal.crm_lead_id`. `opportunityFieldsEqual` compares primary URL **and** secondary URL set.

- [ ] **Step 1: Failing test**

```js
  it('puts extra Bitrix ids on secondaryLinks', () => {
    const input = buildOpportunityInput(deal, items, {
      bitrixLinks: [
        { bitrixId: '111', isCanonical: true },
        { bitrixId: '222', isCanonical: false },
      ],
    });
    expect(input.bitrixLink.primaryLinkUrl).toContain('/111/');
    expect(input.bitrixLink.secondaryLinks[0].url).toContain('/222/');
  });
```

If `buildOpportunityInput` cannot take extras without a db, load links inside it via `getDb()` only when `deal.id` is set; tests pass an in-memory db mock or a third argument `bitrixLinks`.

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implementation**

```js
  const links = bitrixLinks ?? (deal.id ? listDealBitrixLinks(getDb(), deal.id) : []);
  const bitrixInput = buildBitrixLinkInput(
    links.length ? links : (deal.crm_lead_id ? [{ bitrixId: deal.crm_lead_id.trim(), isCanonical: true }] : []),
  );
  if (bitrixInput) input.bitrixLink = bitrixInput;
```

Update `opportunityFieldsEqual` to join secondary URLs sorted.

- [ ] **Step 4: Run tests PASS**

- [ ] **Step 5: Commit** `feat: sync secondary Bitrix links onto Twenty opportunities`

---

### Task 4: Hard and soft group suggestions (pure)

**Files:**
- Create: `backend/src/services/deal-group-suggest.js`
- Test: `backend/tests/deal-group-suggest.test.js`

**Interfaces:**
- Consumes: deal rows `{ id, title, manager_name, load_date, start_date, tony_order_id, deal_key, twenty_id, groupId? }` plus `bookingNumbers[]` and `bitrixIds[]`
- Produces:
  - `extractSoftTokens(title) → string[]`
  - `datesWithinWindow(a, b, days = 2) → boolean`
  - `suggestDealGroups(deals) → { hard: Candidate[], soft: Candidate[] }`
  - `Candidate = { dealIds: number[], reason: 'shared_booking' | 'multi_booking_title' | 'soft_marker', score?: number }`
  - Deals with `groupId` are excluded. Hard never includes a deal already in another candidate’s exclusive set without flagging `conflictGroupId` (leave overlapping hard clusters as separate candidates tagged `conflict: true` rather than merging).

- [ ] **Step 1: Failing tests**

```js
  it('hard-groups two deals that share a booking number', () => {
    const { hard } = suggestDealGroups([
      { id: 1, bookingNumbers: ['111111'], bitrixIds: ['A'], title: 'оплата 111111', manager_name: 'Титова', load_date: '2026-09-01' },
      { id: 2, bookingNumbers: ['111111'], bitrixIds: ['B'], title: 'бронь 111111', manager_name: 'Титова', load_date: '2026-09-01' },
    ]);
    expect(hard[0].dealIds.sort()).toEqual([1, 2]);
    expect(hard[0].reason).toBe('shared_booking');
  });

  it('hard-groups all bookings from one multi-number title', () => {
    const { hard } = suggestDealGroups([
      { id: 1, bookingNumbers: ['181289', '178134'], bitrixIds: ['X'], title: 'Кейт 181289+178134', manager_name: 'М', load_date: '2026-08-07' },
      { id: 2, bookingNumbers: ['178134'], bitrixIds: ['X'], title: 'Кейт 181289+178134', manager_name: 'М', load_date: '2026-08-07' },
    ]);
    expect(hard[0].dealIds.sort()).toEqual([1, 2]);
    expect(hard[0].reason).toBe('multi_booking_title');
  });

  it('soft-groups A7-like titles without writing a group', () => {
    const deals = [
      { id: 1, bookingNumbers: ['189820'], bitrixIds: ['1'], title: 'ПРО/Для оплаты А7 // Ирина // 189820/Титова', manager_name: 'Титова', load_date: '2026-09-02' },
      { id: 2, bookingNumbers: ['190321'], bitrixIds: ['2'], title: 'ПРО/ДОП.ТОЧКА/БЕРЕЖКОВСКАЯ А7 // Ирина // 190321/Титова', manager_name: 'Титова', load_date: '2026-09-01' },
    ];
    const { hard, soft } = suggestDealGroups(deals);
    expect(hard).toEqual([]);
    expect(soft[0].dealIds.sort()).toEqual([1, 2]);
    expect(soft[0].reason).toBe('soft_marker');
  });

  it('skips already grouped deals', () => {
    const { soft } = suggestDealGroups([
      { id: 1, groupId: 9, bookingNumbers: ['1'], bitrixIds: ['a'], title: 'А7', manager_name: 'Титова', load_date: '2026-09-01' },
      { id: 2, bookingNumbers: ['2'], bitrixIds: ['b'], title: 'А7', manager_name: 'Титова', load_date: '2026-09-01' },
    ]);
    expect(soft).toEqual([]);
  });
```

`extractSoftTokens` must drop `ПРО`, dates, and `\d{5,7}`. Remaining includes `а7` (normalize ё/case).

- [ ] **Step 2: Run — FAIL**

- [ ] **Step 3: Implement `deal-group-suggest.js`** using `extractBookingNumbers` from `booking-numbers.js`. Shared booking → union-find cluster (`shared_booking`). Same `bitrixIds` with ≥2 bookings across members → `multi_booking_title`. Soft: same `manager_name`, `datesWithinWindow`, ≥1 shared soft token, not already in a hard candidate.

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit** `feat: suggest hard and soft deal-group candidates`

---

### Task 5: Groups table, confirm/unlink, money, expense rollup

**Files:**
- Modify: `backend/src/db/schema.sql`, `backend/src/db/migrate.js`
- Create: `backend/src/services/deal-groups.js`
- Test: `backend/tests/deal-groups.test.js`

**Interfaces:**
- Consumes: member deals `{ id, twenty_id, title, payment_amount, amountRub, rashodItogo, bitrixIds[] }`
- Produces:
  - `pickCanonicalDeal(members) → { dealId, bitrixId } | { needsManual: true }`
  - `confirmDealGroup(db, { dealIds, name?, nameLocked?, canonicalDealId?, canonicalBitrixId?, canonicalLocked? }) → group`
  - `unlinkDealFromGroup(db, dealId) → { dissolved: boolean }`
  - `dissolveDealGroup(db, groupId) → void`
  - `computeParentMoney(members, canonicalDealId) → { amount, summaPostupleniy, rashodItogo }`
  - `planExpenseRollup(memberExpenses, canonicalDealId) → { canonicalDealId, amounts }` unique by `bitrixId`
  - `maybeAutoSwitchCanonical(db, groupId) → boolean` (false when `canonical_locked` or two payments)

Schema:

```sql
CREATE TABLE IF NOT EXISTS deal_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  twenty_parent_id TEXT,
  name TEXT NOT NULL,
  name_locked INTEGER NOT NULL DEFAULT 0,
  canonical_deal_id INTEGER NOT NULL REFERENCES deals(id),
  canonical_bitrix_id TEXT NOT NULL,
  canonical_locked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS deal_group_members (
  group_id INTEGER NOT NULL REFERENCES deal_groups(id) ON DELETE CASCADE,
  deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  UNIQUE (deal_id)
);
```

- [ ] **Step 1: Failing tests** (A7 numbers)

```js
  it('picks the payment smeta as canonical', () => {
    expect(pickCanonicalDeal([
      { id: 1, payment_amount: 2189149, amountRub: 936900, bitrixIds: ['2049067'] },
      { id: 2, payment_amount: 0, amountRub: 22950, bitrixIds: ['2050903'] },
    ]).dealId).toBe(1);
  });

  it('refuses to auto-pick when two members have payments', () => {
    expect(pickCanonicalDeal([
      { id: 1, payment_amount: 10, amountRub: 1, bitrixIds: ['a'] },
      { id: 2, payment_amount: 20, amountRub: 2, bitrixIds: ['b'] },
    ]).needsManual).toBe(true);
  });

  it('sums revenue and keeps payments/expenses on canonical', () => {
    const money = computeParentMoney([
      { id: 1, amountRub: 936900, payment_amount: 2189149, rashodItogo: 34870 },
      { id: 2, amountRub: 22950, payment_amount: 0, rashodItogo: 9179 },
      { id: 3, amountRub: 46560, payment_amount: 0, rashodItogo: 2400 },
      { id: 4, amountRub: 22950, payment_amount: 0, rashodItogo: 0 },
    ], 1);
    expect(money.amount).toBe(1029360);
    expect(money.summaPostupleniy).toBe(2189149);
    expect(money.rashodItogo).toBe(34870);
  });

  it('rolls child expenses onto canonical once per bitrix id', () => {
    const plan = planExpenseRollup([
      { dealId: 1, bitrixId: '2049067', amounts: { printing: 34870 } },
      { dealId: 2, bitrixId: '2050903', amounts: { printing: 9179 } },
      { dealId: 2, bitrixId: '2050903', amounts: { printing: 9179 } },
    ], 1);
    expect(plan.amounts.printing).toBe(34870 + 9179);
  });

  it('confirm then unlink dissolves a singleton group', () => {
    const group = confirmDealGroup(db, { dealIds: [1, 2], name: 'А7' });
    unlinkDealFromGroup(db, 2);
    const after = unlinkDealFromGroup(db, 1);
    expect(after.dissolved).toBe(true);
    expect(db.prepare('SELECT COUNT(*) AS n FROM deal_groups').get().n).toBe(0);
  });

  it('does not auto-switch locked canonical when another smeta gets paid', () => {
    confirmDealGroup(db, { dealIds: [1, 2], canonicalDealId: 2, canonicalLocked: true });
    db.prepare('UPDATE deals SET payment_amount = 500 WHERE id = 1').run();
    expect(maybeAutoSwitchCanonical(db, 1)).toBe(false);
  });
```

Default name if omitted: `title` of canonical deal. `nameLocked` true when `name` is passed from the client as an override (POST body `nameLocked: true`).

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Implement `deal-groups.js`.** `confirmDealGroup` rejects a `deal_id` already in another group (`409` error object `{ code: 'ALREADY_GROUPED', dealId }`). `canonical_bitrix_id` must exist on `deal_bitrix_links` of `canonical_deal_id`.

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit** `feat: persist confirmed deal groups and parent money rules`

---

### Task 6: Mirror parent opportunity in Twenty

**Files:**
- Create: `backend/src/services/deal-group-twenty.js`
- Modify: `backend/src/services/twenty-gql.js` usage only
- Test: `backend/tests/deal-group-twenty.test.js` with mocked `gql`

**Interfaces:**
- Consumes: `confirmDealGroup` result, `requireTwentyConfig`, `computeParentMoney`
- Produces:
  - `mirrorDealGroupToTwenty(db, groupId) → { parentTwentyId }`
  - Creates opportunity `{ name, amount, loadDate, companyId, parentOpportunityId: null }` when `twenty_parent_id` is null
  - `updateOpportunity` on each child: `{ parentOpportunityId: parentTwentyId }`
  - Copies canonical `tonyLink`/`bitrixLink` onto parent as labels
  - Writes parent `amount` / `summaPostupleniy` / `rashod*` from `computeParentMoney`
  - `clearDealGroupTwenty(db, groupId)` sets children `parentOpportunityId: null`, then deletes the parent opportunity only if it has no `dealLineItems` (GraphQL `first: 1`; if a node exists, skip delete and log)

- [ ] **Step 1: Failing tests** with `vi.mock('../src/services/twenty-gql.js')` asserting create then two child updates then parent amount update.

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Implement.** GraphQL:

```graphql
mutation CreateParent($data: OpportunityCreateInput!) {
  createOpportunity(data: $data) { id }
}
mutation UpdateOpp($id: ID!, $data: OpportunityUpdateInput!) {
  updateOpportunity(id: $id, data: $data) { id }
}
mutation DeleteOpp($id: ID!) { deleteOpportunity(id: $id) { id } }
```

If create fails, do not leave a half-written `twenty_parent_id`. Store id only after children attach succeeds; on child attach failure, retry next call (group row remains SoT).

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit** `feat: mirror deal groups to Twenty parent opportunities`

---

### Task 7: Parser HTTP API for the board

**Files:**
- Modify: `backend/src/routes/twenty.js`
- Test: `backend/tests/twenty-deal-groups-route.test.js` (supertest or router handler with mocked db, following `backend/tests` twenty route style if present)

**Interfaces:**
- `GET /api/twenty/deal-groups/suggestions` → `{ hard, soft }` from `suggestDealGroups` over synced deals (`twenty_id IS NOT NULL`)
- `GET /api/twenty/deal-groups?twentyOppId=` → group + members for a parent or child
- `POST /api/twenty/deal-groups` body `{ twentyOppIds: string[], name?, nameLocked?, canonicalTwentyOppId?, canonicalBitrixId?, canonicalLocked? }` → confirm + `mirrorDealGroupToTwenty` + `planExpenseRollup` applied to canonical Twenty via existing expense mutation
- `PATCH /api/twenty/deal-groups/:id` `{ name?, nameLocked?, canonicalTwentyOppId?, canonicalBitrixId?, canonicalLocked? }`
- `POST /api/twenty/deal-groups/:id/unlink` `{ twentyOppId }`
- `POST /api/twenty/deal-groups/:id/dissolve`

Map `twentyOppId` → `deals.twenty_id`. Unknown id → 404. `ALREADY_GROUPED` → 409. `needsManual` without canonical in body → 400 `{ error: 'canonical_required' }`.

- [ ] **Step 1: Failing tests** for 400/409 and happy POST calling mocked `confirmDealGroup` + `mirrorDealGroupToTwenty`

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Wire routes after `router.use(twentyAppAuthMiddleware)`**

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit** `feat: expose deal-group confirm API to Twenty app`

---

### Task 8: Print, expenses, payments use canonical

**Files:**
- Modify: `backend/src/services/print-sheet-row-builder.js`
- Modify: `backend/src/services/print-sheet-export-twenty.js` (pass group context)
- Modify: `backend/src/services/expense-sync.js` (`loadTargetDeals`)
- Modify: `backend/src/services/payment-sync.js`
- Test: `backend/tests/print-sheet-row-builder.test.js`
- Test: `backend/tests/expense-sync-groups.test.js`
- Test: `backend/tests/payment-sync.test.js` (extend)

**Interfaces:**
- `resolvePrintSheetDealLabel(db, opportunityId, fallbackOpp) → { name, bitrixUrl }`
- `loadTargetDeals`: if deal is in a group, emit **one** target: canonical `twenty_id` + `canonical_bitrix_id` (skip other members)
- After confirm (Task 7), rollup already wrote sums to canonical; this task only prevents double future writes
- `runPaymentSync`: if event deals belong to a group, `pushPaymentToTwenty` for canonical and parent only, not every member

- [ ] **Step 1: Failing tests**

```js
  it('print row uses parent name and canonical Bitrix', () => {
    const values = buildPrintSheetRowValues(lineItem, {
      groupLabel: {
        name: 'А7',
        bitrixUrl: 'https://prointeractive.bitrix24.ru/crm/deal/details/2049067/?any',
      },
    });
    expect(values[1]).toBe('А7');
    expect(values[2]).toContain('2049067');
  });
```

`loadTargetDeals` with two members sharing a group returns one row with canonical twenty_id.

Payment: two deals same event, grouped → `gql` called twice (canonical + parent), not three.

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Implement `resolvePrintSheetDealLabel`:** lookup `deals.twenty_id = opportunityId` → member → group → parent name from `deal_groups.name`, URL from `canonical_bitrix_id`. If no group, current `opp.name` / `opp.bitrixLink.primaryLinkUrl`.

Wire into `buildPrintSheetRowValues` options. In the export cycle, fetch label once per opportunity id.

`loadTargetDeals` SQL: left join members/groups; `WHERE` grouped deals only if `deal_id = canonical_deal_id`.

- [ ] **Step 4: PASS**

- [ ] **Step 5: Commit** `feat: route print expenses and payments through group canonical`

---

### Task 9: Twenty self-relation + hide children + nested smetas

**Files (BrandingTwentyView):**
- Create: `src/fields/opportunity-parent.field.ts`
- Create: `src/fields/opportunity-child-smetas.field.ts`
- Modify: `src/constants/universal-identifiers.ts`
- Modify: `src/deals-board/utils/search.ts`
- Modify: `src/deals-board/utils/search.test.ts`
- Modify: `src/logic-functions/shared/deals-board-page-opportunity-selection.ts` (`secondaryLinks` on LINKS)
- Modify: `src/deals-board/types.ts` (`parentOpportunityId`, `childSmetas?`)
- Modify: `src/deals-board/DealsTable/DealRow.tsx`
- Modify: `src/deals-board/api/line-items.ts` or page assembler to load child line items
- Test: `src/deals-board/utils/search.test.ts`
- Test: `src/deals-board/DealsTable/DealRow.smetas.test.tsx` if the table is testable; otherwise a pure `groupSmetasForParent(parentId, records, lineItems)` helper + test

**UUIDs (v4, do not change):**
- `OPPORTUNITY_PARENT_FIELD_UNIVERSAL_IDENTIFIER = '6a1c8e24-3f57-4b91-8d2e-c0f4a9b73518'`
- `OPPORTUNITY_CHILD_SMETAS_FIELD_UNIVERSAL_IDENTIFIER = '9d2b7f61-e048-4c3a-a7e5-1b8c6d4f9023'`

**Interfaces:**
- Fields: MANY_TO_ONE `parentOpportunity` / join `parentOpportunityId`; ONE_TO_MANY `childSmetas`
- `buildOpportunityFilter` always `and.push({ parentOpportunityId: { is: 'NULL' } })` unless `filters.includeGroupedChildren === true` (internal fetch only)
- Search: child name matches → include **parent** id in `id.in` (same pattern as line-item search). Implement `mapChildMatchesToParentIds(children) → parentIds`
- Expand parent: render each child smeta header (name + T/B links including secondary) then `LineItemsTable` for that child’s items
- Page fetch: after parent rows load, query opportunities `{ parentOpportunityId: { in: parentIds } }` with `includeGroupedChildren`, fetch those line items, attach `row.childSmetas`

- [ ] **Step 1: Failing tests** in `search.test.ts`: every `buildOpportunityFilter` result includes `parentOpportunityId: { is: 'NULL' }`. Empty filter is `{ and: [{ parentOpportunityId: { is: 'NULL' } }] }` not `undefined`.

Add `mapChildMatchesToParentIds` tests.

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Implement fields** (mirror `telegram-request-opportunity.field.ts` / inverse), filter, DealRow nested block:

```tsx
{isExpanded && row.childSmetas?.length ? (
  row.childSmetas.map((smeta) => (
    <div key={smeta.id} data-smeta-id={smeta.id}>
      <div>{smeta.name}</div>
      <LineItemsTable ... lineItems={smeta.lineItems} />
    </div>
  ))
) : isExpanded ? (
  <LineItemsTable ... lineItems={lineItems} />
) : null}
```

Ungrouped deals keep today’s single `LineItemsTable`.

- [ ] **Step 4:** `yarn test:unit` then `yarn twenty apply`

Expected: unit PASS; apply succeeds.

- [ ] **Step 5: Commit in BrandingTwentyView** `feat: nest grouped smetas under parent deals-board rows`

---

### Task 10: Proxy + link modal workflow

**Files (BrandingTwentyView):**
- Create: `src/logic-functions/deal-groups-suggest.ts` (GET)
- Create: `src/logic-functions/deal-groups-write.ts` (POST confirm)
- Create: `src/logic-functions/deal-groups-patch.ts` (PATCH)
- Create: `src/logic-functions/deal-groups-unlink.ts` (POST unlink/dissolve)
- Modify: `src/constants/universal-identifiers.ts` (new logic-function UUIDs, v4)
- Modify: `src/deals-board/api/crmparser.ts` (`fetchDealGroupSuggestions`, `confirmDealGroup`, `unlinkDealGroupMember`)
- Modify: `src/deals-board/api/crmparser.test.ts`
- Create: `src/deals-board/LinkDealsModal.tsx`
- Modify: `src/deals-board/DealsBoard.tsx` toolbar button «Связать сделки»
- Test: `src/deals-board/LinkDealsModal.test.tsx` (candidates render hard above soft; confirm POST body)

**Interfaces:**
- Logic path examples: `POST /crmparser/deal-groups` → parser `POST /twenty/deal-groups`
- Modal props: `{ seedOpportunityId, suggestions, onClose, onSaved }`
- Default canonical: client may omit; parser `pickCanonicalDeal` runs; if `needsManual`, modal shows required select (copy: «Выберите канон: две сметы с оплатой»)
- Default name = canonical smeta `name`; checkbox/edit sets `nameLocked: true`
- After save: invalidate deals-board page query

Logic function UUIDs (v4, do not change):
- suggest GET: `c41e9a70-2b58-4d6f-9c13-7a8e5d0246b1`
- write POST: `a92f0c18-6e47-4b5d-8c01-3d7a9e5b2416`
- patch PATCH: `d0b4e73c-1a59-4f82-9e26-8c5d1a7b3094`
- unlink POST: `5e8c1d47-9b20-4a63-b7f5-2c4e0d9a1863`

- [ ] **Step 1: Failing crmparser client tests** (URL `/functions/crmparser/deal-groups`) and modal test that hard list is first.

- [ ] **Step 2: FAIL**

- [ ] **Step 3: Implement proxy + modal + toolbar.** Modal sections: selected chips, hard candidates, soft candidates, search field adding extra seed opps, name, canonical smeta select, canonical Bitrix select, buttons Связать / Отмена. Unlink from smeta header «Убрать из группы».

- [ ] **Step 4:** `yarn test:unit` && `yarn twenty apply`

- [ ] **Step 5: Commit** `feat: add deal-link modal on the deals board`

---

## Self-review (spec coverage)

| Spec | Task |
|------|------|
| Layers parent/smeta/parser | 1, 5, 6 |
| One booking × N Bitrix | 1, 2, 3 |
| Many bookings → parent | 4, 5, 9 |
| No drop empty Tony / no cancel multi-booking cal | 2 |
| Suggestions hard+soft, no silent write | 4, 7, 10 |
| Canonical payment / max amount / locked | 5, 7 |
| Money + expense rollup | 5, 8 |
| Print/freza canonical | 8 |
| Board one row + expand smetas | 9 |
| Modal API via parser | 7, 10 |
| Unlink / dissolve | 5, 7, 10 |
| Search finds parent via child | 9 |
| DUBL unused | Global Constraints |

No TBD. Names (`confirmDealGroup`, `parentOpportunityId`, `childSmetas`) are stable across tasks.
