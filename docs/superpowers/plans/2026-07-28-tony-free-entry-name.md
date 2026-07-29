# Tony free-entry name from comment — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Normalize Tony «свободная запись» rows in `buildTonyItems` so Twenty line items use the comment as `name` and no longer collapse duplicates.

**Architecture:** Keep `parseTonyOrder` faithful to HTML. Add a pure `normalizeFreeEntryItem` helper and apply it inside `buildTonyItems` so every pipeline (parser, import, attach, historical export) gets unique display names before classify / tip / Twenty sync.

**Tech Stack:** Node ESM, Vitest (crmparserv2 `backend/`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-28-tony-free-entry-name-design.md`
- Detect free-entry by case-insensitive substring `свободная запись` in `name`
- Non-empty comment → `name = comment.trim()`, `comment = ''`
- Empty comment → keep catalog template `name`, `comment = ''`
- Non–free-entry items unchanged (including their comments)
- Do not change `parseTonyOrder` or `tonyContentHash` inputs (hash stays on raw parse)
- Do not add Tony `data-id` matching in v1
- Tests: `cd backend && npm test -- tony-mapping`

## File map

| File | Responsibility |
|------|----------------|
| `backend/src/services/tony-mapping.js` | `normalizeFreeEntryItem` + call from `buildTonyItems` |
| `backend/tests/tony-mapping.test.js` | Unit tests for free-entry normalization |
| `docs/superpowers/specs/2026-07-28-tony-free-entry-name-design.md` | Spec (already committed; do not rewrite unless behavior changes) |

---

### Task 1: Failing tests for free-entry normalization

**Files:**
- Modify: `backend/tests/tony-mapping.test.js`
- Test: `backend/tests/tony-mapping.test.js`

**Interfaces:**
- Consumes: `buildTonyItems`, `normalizeFreeEntryItem` from `../src/services/tony-mapping.js` (helper may not exist yet — import will fail until Task 2)
- Produces: failing tests that lock the approved behavior

- [ ] **Step 1: Append failing tests to `tony-mapping.test.js`**

Add imports (keep existing ones; extend the import list):

```js
import {
  buildTonyDealFields,
  buildTonyItems,
  normalizeFreeEntryItem,
  tonyContentHash,
} from '../src/services/tony-mapping.js';
```

Append these cases inside `describe('tony-mapping', …)` (after existing tests):

```js
  const FREE_ENTRY_NAME =
    'БРЕНДИНГ свободная запись ( КОМЕНТАРИЙ ОБЯЗАТЕЛЕН )';

  describe('normalizeFreeEntryItem / free-entry in buildTonyItems', () => {
    it('uses comment as name and clears comment when free-entry has comment', () => {
      expect(
        normalizeFreeEntryItem({
          name: FREE_ENTRY_NAME,
          comment: 'Наклейка на зеркало',
          price: 5950,
        }),
      ).toEqual({
        name: 'Наклейка на зеркало',
        comment: '',
        price: 5950,
      });
    });

    it('keeps template name when free-entry comment is empty or whitespace', () => {
      expect(
        normalizeFreeEntryItem({
          name: FREE_ENTRY_NAME,
          comment: '   ',
          price: 0,
        }),
      ).toMatchObject({ name: FREE_ENTRY_NAME, comment: '' });
    });

    it('leaves ordinary items unchanged', () => {
      const item = {
        name: 'Навигационные наклейки',
        comment: '+ монтаж',
        price: 2640,
      };
      expect(normalizeFreeEntryItem(item)).toEqual(item);
    });

    it('buildTonyItems yields distinct names for two free-entry rows', () => {
      const items = buildTonyItems({
        items: [
          {
            name: FREE_ENTRY_NAME,
            price: 5950,
            quantity: '1',
            discount: 0,
            sum: 5950,
            category: 'products',
            comment: 'ПВХ',
          },
          {
            name: FREE_ENTRY_NAME,
            price: 5950,
            quantity: '1',
            discount: 0,
            sum: 5950,
            category: 'products',
            comment: 'Наклейка на зеркало',
          },
        ],
        dates: parsed.dates,
        address: '',
        budget: 11900,
      });

      expect(items.map((i) => i.name)).toEqual(['ПВХ', 'Наклейка на зеркало']);
      expect(items.every((i) => i.comment === '')).toBe(true);
    });

    it('detects free-entry case-insensitively', () => {
      expect(
        normalizeFreeEntryItem({
          name: 'Брендинг СВОБОДНАЯ ЗАПИСЬ (тест)',
          comment: 'Ролл-ап',
        }),
      ).toMatchObject({ name: 'Ролл-ап', comment: '' });
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd backend && npm test -- tony-mapping
```

Expected: FAIL — `normalizeFreeEntryItem` is not exported / not defined, or `buildTonyItems` still returns duplicate template names.

- [ ] **Step 3: Commit tests only**

```bash
git add backend/tests/tony-mapping.test.js
git commit -m "test: failing cases for Tony free-entry name normalization"
```

---

### Task 2: Implement `normalizeFreeEntryItem` and wire into `buildTonyItems`

**Files:**
- Modify: `backend/src/services/tony-mapping.js`
- Test: `backend/tests/tony-mapping.test.js`

**Interfaces:**
- Consumes: item shape from `parseTonyOrder` / `buildTonyItems` (`name`, `comment`, …)
- Produces:
  - `export function normalizeFreeEntryItem(item): item` — pure; returns new object when changed
  - `buildTonyItems` applies it to every mapped row

- [ ] **Step 1: Add helper and use it in `buildTonyItems`**

In `backend/src/services/tony-mapping.js`, add (above `buildTonyItems`):

```js
const FREE_ENTRY_RE = /свободная запись/i;

/**
 * Catalog «свободная запись» rows store the real title in Tony's comment.
 * Promote comment → name so Twenty sync can tell duplicates apart.
 */
export function normalizeFreeEntryItem(item) {
  const name = item?.name == null ? '' : String(item.name);
  if (!FREE_ENTRY_RE.test(name)) return item;

  const comment = (item.comment ?? '').trim();
  if (!comment) {
    return { ...item, comment: '' };
  }

  return { ...item, name: comment, comment: '' };
}
```

Replace `buildTonyItems` with:

```js
export function buildTonyItems(parsed) {
  return parsed.items.map((i) =>
    normalizeFreeEntryItem({
      name: i.name,
      price: i.price,
      quantity: i.quantity,
      discount: i.discount ?? 0,
      sum: i.sum,
      comment: i.comment ?? '',
      quantity_num: parseQuantityNum(i.quantity),
    }),
  );
}
```

Do **not** change `tonyContentHash` — it must keep hashing raw `parsed.items` (including original catalog name + comment).

- [ ] **Step 2: Run tests to verify they pass**

Run:

```bash
cd backend && npm test -- tony-mapping
```

Expected: PASS (all existing + new free-entry cases).

- [ ] **Step 3: Run a quick sanity check on parser free-entry fixture behavior**

Run:

```bash
cd backend && npm test -- tony-parser
```

Expected: PASS — parser still returns template `name` + `comment` for the catalog free-entry HTML fixture; mapping (not parser) owns the rewrite.

- [ ] **Step 4: Commit implementation**

```bash
git add backend/src/services/tony-mapping.js backend/tests/tony-mapping.test.js
git commit -m "feat: promote Tony free-entry comment to line item name"
```

---

### Task 3: Manual verification notes (no code)

**Files:** none

**Interfaces:** none

- [ ] **Step 1: Document smoke check for the implementer / reviewer**

After deploy to staging parser, on a Tony order with ≥2 «свободная запись» rows with different comments:

1. Trigger parse / resync for that deal.
2. In Twenty: two line items with `name` = each comment text; `Комментарий` empty.
3. Confirm they are not identical duplicates of a single comment.

If an older sync already wrote two template-named rows, a fresh resync may delete/recreate depending on stage protection — that is expected for v1 (see spec).

- [ ] **Step 2: Commit this plan checkboxes as completed only if executing; otherwise leave unchecked until done**

No commit required for this task when writing the plan. When executing the plan, tick checkboxes in this file and commit:

```bash
git add docs/superpowers/plans/2026-07-28-tony-free-entry-name.md
git commit -m "docs: mark free-entry name plan tasks complete"
```

---

## Spec coverage (self-review)

| Spec requirement | Task |
|---|---|
| Normalize in `buildTonyItems`, not parser | Task 2 |
| Free-entry + non-empty comment → name=comment, comment='' | Task 1+2 |
| Empty comment → keep template | Task 1+2 |
| Classify by new name only (no special BRANDING) | Implicit: no classify changes; Task 2 only rewrites name before classify |
| Two distinct free-entry comments → two names | Task 1 (`buildTonyItems` case) |
| `tonyContentHash` on raw parse | Task 2 (explicit non-change) |
| No `data-id` matching v1 | No task (YAGNI) |
| Parser tests unchanged | Task 2 Step 3 |

No placeholders remaining after self-review.
