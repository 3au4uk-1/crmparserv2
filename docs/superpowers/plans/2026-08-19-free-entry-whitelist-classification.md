# Free-entry whitelist classification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After Tony free-entry name normalization, keep those rows as whitelist (`keyword_match`) instead of reclassifying them by the comment text.

**Architecture:** `normalizeFreeEntryItem` sets in-memory `isFreeEntry: true`. `classifyByKeywords` short-circuits that flag to `keyword_match` / confidence `1.0`, so `classifyItems` never sends those rows to the LLM. No SQLite column; INSERT already lists columns explicitly.

**Tech Stack:** Node ESM, Vitest (`backend/`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-19-free-entry-whitelist-classification-design.md`
- Detect free-entry by case-insensitive substring `свободная запись` in the **original** `name` (existing `/свободная запись/i`)
- Free-entry always `classification: 'keyword_match'` and `classification_confidence: 1.0`
- Free-entry does not go to LLM classification
- Do not persist `isFreeEntry` in SQLite
- Do not change `parseTonyOrder`, `tonyContentHash`, disambiguate suffixes, tip-rules, or product-stream keyword lists
- Do not add a one-shot repair for already-saved `unclassified` rows
- Ordinary items (no free-entry match) keep current keyword / unclassified behavior
- Tests run from `backend/`: `npm test -- tests/tony-mapping.test.js tests/classifier.test.js`

## File map

| File | Responsibility |
|------|----------------|
| `backend/src/services/tony-mapping.js` | Set `isFreeEntry: true` inside `normalizeFreeEntryItem` |
| `backend/src/services/classifier.js` | Honor `isFreeEntry` in `classifyByKeywords` |
| `backend/tests/tony-mapping.test.js` | Flag assertions on normalize / `buildTonyItems` |
| `backend/tests/classifier.test.js` | Force `keyword_match`; pipeline with `buildTonyItems` |

---

### Task 1: Flag `isFreeEntry` on free-entry normalize

**Files:**
- Modify: `backend/tests/tony-mapping.test.js`
- Modify: `backend/src/services/tony-mapping.js`
- Test: `backend/tests/tony-mapping.test.js`

**Interfaces:**
- Consumes: existing `normalizeFreeEntryItem(item)`, `buildTonyItems(parsed)`, `FREE_ENTRY_RE = /свободная запись/i`
- Produces: free-entry items include `isFreeEntry: true`; ordinary items do not get the flag. Name/comment rules unchanged.

- [ ] **Step 1: Write the failing tests**

In `backend/tests/tony-mapping.test.js`, update the existing exact `toEqual` for a commented free-entry so it requires the flag (this currently fails because the flag is missing):

```js
      ).toEqual({
        name: 'Наклейка на зеркало',
        comment: '',
        price: 5950,
        isFreeEntry: true,
      });
```

In the empty-comment case, add `isFreeEntry: true` to the `toMatchObject` expectation.

Add these two tests inside the same `describe('normalizeFreeEntryItem / free-entry in buildTonyItems')` block:

```js
    it('sets isFreeEntry on free-entry even when comment is empty', () => {
      expect(
        normalizeFreeEntryItem({
          name: FREE_ENTRY_NAME,
          comment: '',
        }).isFreeEntry,
      ).toBe(true);
    });

    it('does not set isFreeEntry on ordinary items', () => {
      expect(
        normalizeFreeEntryItem({
          name: 'Навигационные наклейки',
          comment: '+ монтаж',
          price: 2640,
        }).isFreeEntry,
      ).toBeUndefined();
    });
```

In `it('buildTonyItems yields distinct names for two free-entry rows')`, after the existing name/comment asserts, add:

```js
      expect(items.every((i) => i.isFreeEntry === true)).toBe(true);
```

In `it('buildTonyItems disambiguates two free-entry with same comment')` (the later describe), after existing asserts, add the same `isFreeEntry` check so the flag survives ` (#2)` renaming.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npm test -- tests/tony-mapping.test.js`

Expected: FAIL — `toEqual` missing `isFreeEntry: true`, and/or `isFreeEntry` is `undefined` on free-entry rows.

- [ ] **Step 3: Set the flag in `normalizeFreeEntryItem`**

In `backend/src/services/tony-mapping.js`, both free-entry return paths must include `isFreeEntry: true`. Non-matching items still `return item` unchanged.

```js
export function normalizeFreeEntryItem(item) {
  if (!FREE_ENTRY_RE.test(item.name ?? '')) {
    return item;
  }
  const trimmedComment = (item.comment ?? '').trim();
  if (trimmedComment) {
    return { ...item, name: trimmedComment, comment: '', isFreeEntry: true };
  }
  return { ...item, comment: '', isFreeEntry: true };
}
```

Do not add an SQLite column. Do not strip the flag in `buildTonyItems`. `disambiguateDuplicateNames` already spreads items, so `isFreeEntry` is preserved (including on `Name (#2)`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npm test -- tests/tony-mapping.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/tony-mapping.js backend/tests/tony-mapping.test.js
git commit -m "feat(tony): flag free-entry items after name normalize"
```

---

### Task 2: Classify free-entry as whitelist `keyword_match`

**Files:**
- Modify: `backend/tests/classifier.test.js`
- Modify: `backend/src/services/classifier.js`
- Test: `backend/tests/classifier.test.js`

**Interfaces:**
- Consumes: `item.isFreeEntry` from Task 1; `classifyByKeywords(items, keywords)`; `buildTonyItems` from `../src/services/tony-mapping.js`
- Produces: `isFreeEntry === true` → `classification: 'keyword_match'`, `classification_confidence: 1.0`, regardless of whether the (already normalized) `name` matches any keyword. Items without the flag keep current behavior.

- [ ] **Step 1: Write the failing tests**

Add this import at the top of `backend/tests/classifier.test.js` (keep the existing classifier import):

```js
import { buildTonyItems } from '../src/services/tony-mapping.js';
```

Append these cases after the existing `describe('classifyByKeywords')` block (new describe is fine):

```js
describe('classifyByKeywords free-entry whitelist', () => {
  const keywords = ['брендинг', 'баннер', 'печать', 'наклейка', 'логотип'];
  const FREE_ENTRY_NAME =
    'БРЕНДИНГ свободная запись ( КОМЕНТАРИЙ ОБЯЗАТЕЛЕН )';

  it('forces keyword_match when isFreeEntry is set even if name has no keyword', () => {
    const result = classifyByKeywords(
      [{ name: 'на тележку по смете', isFreeEntry: true, price: 16000 }],
      keywords,
    );
    expect(result[0].classification).toBe('keyword_match');
    expect(result[0].classification_confidence).toBe(1.0);
    expect(result[0].name).toBe('на тележку по смете');
  });

  it('still marks the same name unclassified without the flag', () => {
    const result = classifyByKeywords(
      [{ name: 'на тележку по смете', price: 16000 }],
      keywords,
    );
    expect(result[0].classification).toBe('unclassified');
  });

  it('buildTonyItems free-entry rows classify as keyword_match', () => {
    const items = buildTonyItems({
      items: [
        {
          name: FREE_ENTRY_NAME,
          price: 16000,
          quantity: '1',
          discount: 0,
          sum: 16000,
          comment: 'на тележку по смете',
        },
        {
          name: FREE_ENTRY_NAME,
          price: 100,
          quantity: '1',
          discount: 0,
          sum: 100,
          comment: 'Макет',
        },
        {
          name: FREE_ENTRY_NAME,
          price: 200,
          quantity: '1',
          discount: 0,
          sum: 200,
          comment: 'Макет',
        },
      ],
      dates: {},
    });
    const result = classifyByKeywords(items, keywords);
    expect(result.map((i) => i.name)).toEqual([
      'на тележку по смете',
      'Макет',
      'Макет (#2)',
    ]);
    expect(result.every((i) => i.classification === 'keyword_match')).toBe(true);
    expect(result.every((i) => i.classification_confidence === 1.0)).toBe(true);
  });
});
```

Do not mock LLM. `classifyItems` only sends `unclassified` rows to LLM; `keyword_match` is sufficient to keep free-entry out of that set.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npm test -- tests/classifier.test.js`

Expected: FAIL — free-entry-shaped name without a keyword stays `unclassified`.

- [ ] **Step 3: Short-circuit `classifyByKeywords`**

In `backend/src/services/classifier.js`, check the flag **before** keyword matching:

```js
export function classifyByKeywords(items, keywords) {
  return items.map(item => {
    if (item.isFreeEntry) {
      return {
        ...item,
        classification: 'keyword_match',
        classification_confidence: 1.0,
      };
    }
    const matched = keywords.some((kw) => keywordMatchesItemName(item.name, kw));
    return {
      ...item,
      classification: matched ? 'keyword_match' : 'unclassified',
      classification_confidence: matched ? 1.0 : null,
    };
  });
}
```

Do not add a DB column. Do not change `classifyByLlm`. Do not change product-stream keyword lists.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npm test -- tests/classifier.test.js tests/tony-mapping.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/classifier.js backend/tests/classifier.test.js
git commit -m "feat(classifier): treat Tony free-entry as keyword whitelist"
```
