# Direction switcher + «Не наше» — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Parsing-tab direction switcher and two «Не наше» pattern lists (branding / decor-MK) that zero line-item amount on sync, plus matching TwentyView list-menu actions.

**Architecture:** Mirror restoration lists: SQLite tables + CRUD services/routes, OR into `computeLineItemTotal`, enrich list-status flags, Settings sections behind a segmented direction control. BrandingTwentyView extends `LINE_ITEM_LIST_ACTIONS` and crmparser types.

**Tech Stack:** Node ESM, better-sqlite3, Express, Vitest, React Settings (crmparserv2); TypeScript + Vitest (BrandingTwentyView).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-29-ne-nashe-and-direction-switcher-design.md`
- Two lists: `ne_nashe_branding` / `ne_nashe_decor_mk` (tables `ne_nashe_branding_items`, `ne_nashe_decor_mk_items`)
- Match → amount `0` (same as restoration); position stays eligible for Twenty
- tipDetail `NE_NASHI` unchanged / independent
- Settings: segment control shows only selected direction; schedule + approval always below
- TwentyView: branding board → `ne_nashe_branding`; decor_mk board → `ne_nashe_decor_mk`
- Tests: `cd backend && npm test -- <file>` (crmparserv2); `yarn test:unit` or vitest path (BrandingTwentyView)

## File map

### crmparserv2

| File | Responsibility |
|------|----------------|
| `backend/src/db/migrate.js` | Create both `ne_nashe_*_items` tables |
| `backend/src/services/ne-nashe-branding.js` | Match/CRUD branding list |
| `backend/src/services/ne-nashe-decor-mk.js` | Match/CRUD decor-MK list |
| `backend/src/services/twenty-opportunity.js` | Zero amount on either ne-nashe match |
| `backend/src/services/twenty-items.js` | Enrich flags + pass lists into total |
| `backend/src/services/pattern-lists-cache.js` | Cache both lists |
| `backend/src/services/twenty-line-item-api.js` | LIST_CREATORS + list-status flags |
| `backend/src/services/twenty-sync.js` | Pass lists wherever restoration is passed for totals |
| `backend/src/routes/ne-nashe-branding.js` | REST CRUD |
| `backend/src/routes/ne-nashe-decor-mk.js` | REST CRUD |
| `backend/src/index.js` | Mount routes |
| `frontend/src/api.js` | Hooks for both lists |
| `frontend/src/pages/Settings.jsx` | Direction switcher + sections |
| `backend/tests/ne-nashe*.test.js` | Match + CRUD + amount |
| `backend/tests/twenty-routes.test.js` | list-status + add-to-list |

### BrandingTwentyView

| File | Responsibility |
|------|----------------|
| `src/deals-board/api/crmparser.ts` | `ListName` + status flags |
| `src/deals-board/line-item-list-actions.ts` | Actions + board filters |
| `src/deals-board/line-item-list-actions.test.ts` | Updated expectations |
| `src/logic-functions/line-item-list-status.ts` (if needed) | Pass-through only if list names are validated there |

---

### Task 1: crmparserv2 — migration + ne-nashe services (TDD)

**Files:**
- Modify: `backend/src/db/migrate.js`
- Create: `backend/src/services/ne-nashe-branding.js`
- Create: `backend/src/services/ne-nashe-decor-mk.js`
- Create: `backend/tests/ne-nashe-branding.test.js`
- Create: `backend/tests/ne-nashe-decor-mk.test.js`

**Interfaces:**
- Produces (each module, mirror `restoration.js`):
  - `matchesNeNasheBrandingEntry` / `findNeNasheBrandingMatch` / `isNeNasheBrandingItem`
  - `loadNeNasheBrandingList` / `createNeNasheBrandingEntry` / `deleteNeNasheBrandingEntry`
  - Same for decor-mk with `NeNasheDecorMk` naming
  - Tables: `ne_nashe_branding_items`, `ne_nashe_decor_mk_items` (same columns as `restoration_items`)

- [ ] **Step 1: Write failing match/CRUD tests** for branding (copy structure from `backend/tests/restoration.test.js` if present, else from `decor-blacklist` tests). Cover exact match, substring, create 409 duplicate, delete 404.

- [ ] **Step 2: Run** `cd backend && npm test -- ne-nashe-branding` — expect FAIL (module missing).

- [ ] **Step 3: Add migrate DDL** after `mk_blacklist_items` block:

```js
  db.exec(`
    CREATE TABLE IF NOT EXISTS ne_nashe_branding_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern TEXT NOT NULL,
      match_type TEXT NOT NULL CHECK (match_type IN ('exact', 'substring')),
      source_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (pattern, match_type)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS ne_nashe_decor_mk_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern TEXT NOT NULL,
      match_type TEXT NOT NULL CHECK (match_type IN ('exact', 'substring')),
      source_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (pattern, match_type)
    );
  `);
```

- [ ] **Step 4: Implement both service modules** as copies of `restoration.js` with renamed table/functions/error strings (`Не наше (брендинг) already exists` / `Не наше (декор/МК) already exists` or English parallel to restoration: `Ne-nashe branding entry already exists`).

- [ ] **Step 5: Mirror tests for decor-mk; run both suites — expect PASS.**

- [ ] **Step 6: Commit**

```bash
git add backend/src/db/migrate.js backend/src/services/ne-nashe-*.js backend/tests/ne-nashe-*.test.js
git commit -m "feat: add ne-nashe branding and decor-mk pattern lists"
```

---

### Task 2: crmparserv2 — zero amount + enrich + list API

**Files:**
- Modify: `backend/src/services/twenty-opportunity.js`
- Modify: `backend/src/services/twenty-items.js`
- Modify: `backend/src/services/pattern-lists-cache.js`
- Modify: `backend/src/services/twenty-line-item-api.js`
- Modify: `backend/src/services/twenty-sync.js` (and any caller that only passes `restorationList` into totals — keep signature backward compatible by adding optional lists or a combined helper)
- Modify: `backend/tests/twenty-opportunity.test.js` (or equivalent)
- Modify: `backend/tests/twenty-routes.test.js`
- Modify: `backend/tests/twenty-items.test.js` if enrich flags are asserted

**Interfaces:**
- Prefer a small helper in opportunity module:

```js
export function shouldZeroLineItemAmount(itemName, {
  restorationList = [],
  neNasheBrandingList = [],
  neNasheDecorMkList = [],
} = {}) {
  return (
    isRestorationItem(itemName, restorationList) ||
    isNeNasheBrandingItem(itemName, neNasheBrandingList) ||
    isNeNasheDecorMkItem(itemName, neNasheDecorMkList)
  );
}
```

- Update `computeLineItemTotal(item, deal, restorationList = [], options = {})` **or** replace the third arg with an options object **only if** all call sites are updated in this task. Safer: add optional 4th/options bag without breaking existing 3-arg calls:

```js
export function computeLineItemTotal(item, deal, restorationList = [], neNasheLists = {}) {
  const branding = neNasheLists.neNasheBrandingList ?? [];
  const decorMk = neNasheLists.neNasheDecorMkList ?? [];
  if (shouldZeroLineItemAmount(item.name, {
    restorationList,
    neNasheBrandingList: branding,
    neNasheDecorMkList: decorMk,
  })) return 0;
  // ... existing tony/calendar logic
}
```

- `enrichDealItems`: add `neNasheBrandingMatch`, `neNasheDecorMkMatch` booleans (+ optional entry objects if restoration has them).
- `getCachedPatternLists`: load both lists.
- `LIST_CREATORS`: `ne_nashe_branding`, `ne_nashe_decor_mk`.
- `NEUTRAL_LINE_ITEM_LIST_STATUS` + `statusFromEnriched`: add `neNasheBrandingMatch: false`, `neNasheDecorMkMatch: false`.

- [ ] **Step 1: Failing tests** — amount 0 when branding ne-nashe matches; amount unchanged when only other direction matches wrong name; list-status returns new flags; POST add-to-list accepts new list names.

- [ ] **Step 2: Implement wiring; run** `npm test -- twenty-opportunity twenty-items twenty-routes` — PASS.

- [ ] **Step 3: Commit**

```bash
git commit -am "feat: zero Twenty amount for ne-nashe list matches"
```

---

### Task 3: crmparserv2 — REST routes + frontend hooks

**Files:**
- Create: `backend/src/routes/ne-nashe-branding.js`
- Create: `backend/src/routes/ne-nashe-decor-mk.js`
- Modify: `backend/src/index.js`
- Modify: `frontend/src/api.js`

**Interfaces:**
- Routes identical to `routes/restoration.js` with renamed imports + `scheduleListChangeResync()` on POST/DELETE.
- Mount: `/api/ne-nashe-branding`, `/api/ne-nashe-decor-mk`.
- Hooks: `useNeNasheBrandingList`, `useAddNeNasheBrandingItem`, `useRemoveNeNasheBrandingItem` (+ decor-mk variants), query keys `['ne-nashe-branding']` / `['ne-nashe-decor-mk']`.

- [ ] **Step 1: Add routes + mount.**

- [ ] **Step 2: Add hooks mirroring restoration hooks in `api.js`.**

- [ ] **Step 3: Smoke with** existing route tests or a thin supertest file if needed.

- [ ] **Step 4: Commit**

```bash
git commit -am "feat: expose ne-nashe list REST API and Settings hooks"
```

---

### Task 4: crmparserv2 — Settings UI (switcher + sections)

**Files:**
- Modify: `frontend/src/pages/Settings.jsx`

**Interfaces:**
- State: `const [parsingDirection, setParsingDirection] = useState('branding');` // `'branding' | 'decor_mk'`
- Segmented control at top of parsing tab.
- Conditional render of existing `DirectionGroup`s.
- New Section «Не наше (брендинг)» / «Не наше (декор/МК)» with pattern UI copied from restoration (wire new hooks).

Order (spec):
- Branding: keywords → blacklist → **ne-nashe branding** → restoration → tip-zones
- Decor/MK: decor KW → mk KW → decor BL → mk BL → **ne-nashe decor-mk**
- Always below: schedule + approval

- [ ] **Step 1: Add switcher UI** (two buttons, selected = `border-ink` / filled style consistent with tab nav).

- [ ] **Step 2: Insert ne-nashe sections + wire add/remove.**

- [ ] **Step 3: Manual check** (or storybook N/A): only one direction visible.

- [ ] **Step 4: Commit**

```bash
git commit -am "feat(settings): direction switcher and ne-nashe list editors"
```

---

### Task 5: BrandingTwentyView — list menu actions

**Files:**
- Modify: `src/deals-board/api/crmparser.ts`
- Modify: `src/deals-board/line-item-list-actions.ts`
- Modify: `src/deals-board/line-item-list-actions.test.ts`
- Grep/update any switch validating `ListName` in logic-functions

**Interfaces:**

```ts
export type ListName =
  | 'blacklist'
  | 'restoration'
  | 'podryad'
  | 'banner'
  | 'decor_blacklist'
  | 'mk_blacklist'
  | 'ne_nashe_branding'
  | 'ne_nashe_decor_mk';

// LineItemListStatus adds:
neNasheBrandingMatch?: boolean;
neNasheDecorMkMatch?: boolean;
```

Actions:
```ts
{
  list: 'ne_nashe_branding',
  label: 'В не наше',
  shortLabel: 'НН',
  isActive: (s) => Boolean(s?.neNasheBrandingMatch),
},
{
  list: 'ne_nashe_decor_mk',
  label: 'В не наше',
  shortLabel: 'НН',
  isActive: (s) => Boolean(s?.neNasheDecorMkMatch),
},
```

Board sets:
- Branding: add `ne_nashe_branding`
- Decor_MK: add `ne_nashe_decor_mk`

- [ ] **Step 1: Failing tests** updating expected action arrays.

- [ ] **Step 2: Implement types + actions; run** `yarn vitest run src/deals-board/line-item-list-actions.test.ts` (or project equivalent) — PASS.

- [ ] **Step 3: Commit**

```bash
git commit -am "feat(deals-board): add ne-nashe list actions per board stream"
```

---

### Task 6: Integration smoke notes

**Files:** none (checklist)

- [ ] Staging parser: add pattern to branding «Не наше», resync deal with matching item → Twenty amount 0.
- [ ] Decor/MK board: «В не наше» writes to decor-mk list; branding board writes to branding list.
- [ ] tipDetail `NE_NASHI` still editable independently.
- [ ] Push both repos’ staging branches when smoke OK.

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| Direction segment switcher | Task 4 |
| Two ne-nashe tables/lists | Task 1 |
| Amount 0 on match | Task 2 |
| Settings sections per direction | Task 4 |
| REST + hooks | Task 3 |
| TwentyView menu actions | Task 5 |
| tipDetail NE_NASHI untouched | Tasks 2/5 (no tip changes) |
| list-status flags | Task 2 + 5 |

No placeholders remaining after self-review.
