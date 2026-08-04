# Free-entry duplicate identity + one-shot repair — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop same-name Tony free-entry line items from collapsing on sync (and doubling `opportunity.amount`), and one-shot-repair existing broken deals in SQLite + Twenty at parser startup.

**Architecture:** Disambiguate duplicate names after free-entry normalize; match Twenty diffs by `twenty_id` then FIFO name queues; preserve overrides by `name#occurrence`; run a flagged one-shot repair job after `app.listen` that renames template free-entry rows, disambiguates, untangles shared `twenty_id`, and recalculates opportunity amounts.

**Tech Stack:** Node ESM, better-sqlite3, Vitest, Twenty GraphQL via existing `gql` helpers.

**Spec:** `docs/superpowers/specs/2026-08-04-free-entry-duplicate-identity-design.md`

## Global Constraints

- Work in `crmparserv2` on `staging` (or feature branch off it).
- TDD: failing test → implement → pass → commit per task.
- Do not push unless asked.
- Exact trimmed name for disambiguator suffixes: first keeps name; 2nd → `"{name} (#2)"`, 3rd → `"{name} (#3)"`.
- Settings flag key: `free_entry_duplicate_repair_v1` with values `running` | `done` | `failed` (absent = not started).
- Stale `running` older than **6 hours** → treat as failed and retry.
- Repair may rename `name`/`kommentariy` even on protected stages; must not delete protected orphans.
- Do not change BrandingTwentyView in v1.
- Do not add Tony `data-id` matching in v1.
- Soft per-deal repair errors: log + continue; hard Twenty auth/network: abort, set `failed`, do not set `done`.

---

## File map

| File | Responsibility |
|------|----------------|
| `backend/src/services/tony-mapping.js` | `disambiguateDuplicateNames`; wire into `buildTonyItems` |
| `backend/tests/tony-mapping.test.js` | Disambiguator + identical-comment cases |
| `backend/src/services/deal-items-update.js` | Occurrence-keyed override map |
| `backend/tests/deal-items-update.test.js` | Two same-name rows keep distinct `twenty_id` |
| `backend/src/services/twenty-line-items-sync.js` | `computeLineItemDiff` twenty_id-first + FIFO name queues |
| `backend/tests/twenty-line-items-sync.test.js` | Duplicate-name / twenty_id match cases |
| `backend/src/services/free-entry-duplicate-repair.js` | One-shot job + pure helpers |
| `backend/tests/free-entry-duplicate-repair.test.js` | Repair unit tests |
| `backend/src/index.js` | Kick repair after listen (background) |
| Spec status | → Approved |

---

### Task 1: `disambiguateDuplicateNames` in tony-mapping

**Files:**
- Modify: `backend/src/services/tony-mapping.js`
- Modify: `backend/tests/tony-mapping.test.js`
- Modify: `docs/superpowers/specs/2026-08-04-free-entry-duplicate-identity-design.md` (status → Approved)

**Interfaces:**
- Produces: `export function disambiguateDuplicateNames(items): items[]` — returns new array; mutates neither input items in place (map to new objects when renaming)
- Produces: `buildTonyItems` returns `disambiguateDuplicateNames(parsed.items.map(normalizeFreeEntryItem…))`

- [ ] **Step 1: Write failing tests** in `tony-mapping.test.js`

```js
import { disambiguateDuplicateNames, buildTonyItems, normalizeFreeEntryItem } from '../src/services/tony-mapping.js';

describe('disambiguateDuplicateNames', () => {
  it('suffixes 2nd+ exact trimmed duplicate names', () => {
    const out = disambiguateDuplicateNames([
      { name: 'ПВХ', price: 1 },
      { name: 'ПВХ', price: 2 },
      { name: 'Баннер', price: 3 },
      { name: 'ПВХ', price: 4 },
    ]);
    expect(out.map((i) => i.name)).toEqual(['ПВХ', 'ПВХ (#2)', 'Баннер', 'ПВХ (#3)']);
    expect(out[1].price).toBe(2);
  });

  it('is a no-op when names are unique', () => {
    const items = [{ name: 'A' }, { name: 'B' }];
    expect(disambiguateDuplicateNames(items).map((i) => i.name)).toEqual(['A', 'B']);
  });

  it('buildTonyItems disambiguates two free-entry with same comment', () => {
    const items = buildTonyItems({
      items: [
        { name: FREE_ENTRY_NAME, price: 100, quantity: '1', discount: 0, sum: 100, comment: 'Макет' },
        { name: FREE_ENTRY_NAME, price: 200, quantity: '1', discount: 0, sum: 200, comment: 'Макет' },
      ],
      dates: {},
    });
    expect(items.map((i) => i.name)).toEqual(['Макет', 'Макет (#2)']);
    expect(items.every((i) => i.comment === '')).toBe(true);
  });
});
```

Keep existing distinct-comment test green (still expects two different names without suffixes).

- [ ] **Step 2: Run — expect FAIL**

```bash
cd backend && npm test -- tests/tony-mapping.test.js
```

Expected: FAIL — `disambiguateDuplicateNames` not exported / identical comments not unique.

- [ ] **Step 3: Implement**

```js
export function disambiguateDuplicateNames(items) {
  const seen = new Map(); // trimmedName -> count seen so far
  return items.map((item) => {
    const base = String(item.name ?? '').trim();
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    if (n === 1) return item;
    return { ...item, name: `${base} (#${n})` };
  });
}

export function buildTonyItems(parsed) {
  const normalized = parsed.items.map((i) =>
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
  return disambiguateDuplicateNames(normalized);
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd backend && npm test -- tests/tony-mapping.test.js
```

- [ ] **Step 5: Mark spec Approved** — set `**Статус:** Approved` in the design spec.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/tony-mapping.js backend/tests/tony-mapping.test.js docs/superpowers/specs/2026-08-04-free-entry-duplicate-identity-design.md
git commit -m "$(cat <<'EOF'
Disambiguate duplicate Tony item names after free-entry normalize.

EOF
)"
```

---

### Task 2: Occurrence-keyed override map

**Files:**
- Modify: `backend/src/services/deal-items-update.js`
- Modify: `backend/tests/deal-items-update.test.js`

**Interfaces:**
- Consumes: classified items in order (already disambiguated when from Tony)
- Produces: `buildOverrideMap` keys `` `${name}#${i}` ``; `replaceDealItemsPreservingOverrides` consumes same occurrence order

Helper (export for tests if useful):

```js
export function occurrenceKey(name, index) {
  return `${name}#${index}`;
}
```

- [ ] **Step 1: Write failing tests**

```js
  it('buildOverrideMap keeps distinct twenty_id for duplicate names', () => {
    const map = buildOverrideMap([
      { name: 'Макет', sync_override: null, twenty_id: 'li-a', amount_locked: 0 },
      { name: 'Макет', sync_override: null, twenty_id: 'li-b', amount_locked: 1, sum: 10000, price: 10000 },
    ]);
    expect(map['Макет#0'].twenty_id).toBe('li-a');
    expect(map['Макет#1'].twenty_id).toBe('li-b');
    expect(map['Макет#1'].amount_locked).toBe(1);
    expect(map['Макет']).toBeUndefined();
  });

  it('replace restores different twenty_id onto same-name successors in order', () => {
    db.prepare(`
      INSERT INTO deal_items (deal_id, name, price, classification, twenty_id, amount_locked, sum)
      VALUES
        (1, 'Макет', 100, 'keyword_match', 'li-a', 0, NULL),
        (1, 'Макет', 200, 'keyword_match', 'li-b', 1, 200)
    `).run();
    const existing = db.prepare('SELECT * FROM deal_items WHERE deal_id = 1 ORDER BY id').all();
    const overrideMap = buildOverrideMap(existing);
    replaceDealItemsPreservingOverrides(db, 1, [
      { name: 'Макет', price: 100, quantity: null, discount: null, classification: 'keyword_match', classification_confidence: 1, sum: 100 },
      { name: 'Макет (#2)', price: 200, quantity: null, discount: null, classification: 'keyword_match', classification_confidence: 1, sum: 200 },
    ], overrideMap);
    // After disambiguate, names differ — occurrence keys must follow name groups.
    // For this test use SAME name twice to prove #0/#1 mapping:
  });
```

Prefer the clearer same-name successor test:

```js
  it('replace restores different twenty_id onto duplicate names in order', () => {
    db.prepare(`
      INSERT INTO deal_items (deal_id, name, price, classification, twenty_id)
      VALUES
        (1, 'Макет', 100, 'keyword_match', 'li-a'),
        (1, 'Макет', 200, 'keyword_match', 'li-b')
    `).run();
    const existing = db.prepare('SELECT * FROM deal_items WHERE deal_id = 1 ORDER BY id').all();
    const overrideMap = buildOverrideMap(existing);
    replaceDealItemsPreservingOverrides(db, 1, [
      { name: 'Макет', price: 111, quantity: null, discount: null, classification: 'keyword_match', classification_confidence: 1 },
      { name: 'Макет', price: 222, quantity: null, discount: null, classification: 'keyword_match', classification_confidence: 1 },
    ], overrideMap);
    const items = db.prepare('SELECT * FROM deal_items WHERE deal_id = 1 ORDER BY id').all();
    expect(items.map((i) => i.twenty_id)).toEqual(['li-a', 'li-b']);
  });
```

Update existing `buildOverrideMap keeps sync_override…` test to expect `Баннер#0` instead of `Баннер`.

- [ ] **Step 2: Run — expect FAIL**

```bash
cd backend && npm test -- tests/deal-items-update.test.js
```

- [ ] **Step 3: Implement**

```js
export function buildOverrideMap(existingItems) {
  const map = {};
  const counts = new Map();
  for (const item of existingItems) {
    if (!(item.sync_override || item.twenty_id || item.amount_locked)) continue;
    const n = counts.get(item.name) || 0;
    counts.set(item.name, n + 1);
    map[`${item.name}#${n}`] = {
      sync_override: item.sync_override ?? null,
      twenty_id: item.twenty_id ?? null,
      amount_locked: item.amount_locked ? 1 : 0,
      sum: item.amount_locked ? item.sum : undefined,
      price: item.amount_locked ? item.price : undefined,
    };
  }
  return map;
}

// In replaceDealItemsPreservingOverrides loop:
  const nameCounts = new Map();
  for (const item of classifiedItems) {
    const n = nameCounts.get(item.name) || 0;
    nameCounts.set(item.name, n + 1);
    const result = insert.run(/* unchanged */);
    const preserved = overrideMap[`${item.name}#${n}`];
    // restore / restoreLocked unchanged
  }
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd backend && npm test -- tests/deal-items-update.test.js
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/deal-items-update.js backend/tests/deal-items-update.test.js
git commit -m "$(cat <<'EOF'
Preserve distinct twenty_id for duplicate deal item names.

EOF
)"
```

---

### Task 3: `computeLineItemDiff` — twenty_id first + FIFO name queues

**Files:**
- Modify: `backend/src/services/twenty-line-items-sync.js` (`computeLineItemDiff`)
- Modify: `backend/tests/twenty-line-items-sync.test.js`

**Interfaces:**
- Consumes: `eligibleItems` may include `twenty_id`; `existingLineItems` have `id`, `name`, `stage`
- Produces: same `{ toUpdate, toCreate, toDelete, preserved }` shape; parsed path uses twenty_id then FIFO

- [ ] **Step 1: Write failing tests**

```js
  it('updates by twenty_id even when names differ', () => {
    const existing = [
      { id: 'li-a', name: 'Старое', stage: 'NOVYY' },
      { id: 'li-b', name: 'Другое', stage: 'NOVYY' },
    ];
    const eligible = [
      { id: 1, name: 'НовоеА', twenty_id: 'li-a', price: 1 },
      { id: 2, name: 'НовоеБ', twenty_id: 'li-b', price: 2 },
    ];
    const diff = computeLineItemDiff(existing, eligible);
    expect(diff.toUpdate).toEqual([
      { twentyId: 'li-a', item: eligible[0] },
      { twentyId: 'li-b', item: eligible[1] },
    ]);
    expect(diff.toCreate).toEqual([]);
    expect(diff.toDelete).toEqual([]);
  });

  it('FIFO-matches duplicate names without twenty_id', () => {
    const existing = [
      { id: 'li-1', name: 'Макет', stage: 'NOVYY' },
      { id: 'li-2', name: 'Макет', stage: 'NOVYY' },
    ];
    const eligible = [
      { id: 1, name: 'Макет', price: 10 },
      { id: 2, name: 'Макет', price: 20 },
    ];
    const diff = computeLineItemDiff(existing, eligible);
    expect(diff.toUpdate).toEqual([
      { twentyId: 'li-1', item: eligible[0] },
      { twentyId: 'li-2', item: eligible[1] },
    ]);
    expect(diff.toCreate).toEqual([]);
  });

  it('does not send two updates to the same existing id for duplicate names', () => {
    const existing = [{ id: 'li-only', name: 'Макет', stage: 'NOVYY' }];
    const eligible = [
      { id: 1, name: 'Макет', price: 10 },
      { id: 2, name: 'Макет', price: 20 },
    ];
    const diff = computeLineItemDiff(existing, eligible);
    expect(diff.toUpdate).toEqual([{ twentyId: 'li-only', item: eligible[0] }]);
    expect(diff.toCreate).toEqual([eligible[1]]);
  });
```

Existing single-name tests must still pass.

- [ ] **Step 2: Run — expect FAIL**

```bash
cd backend && npm test -- tests/twenty-line-items-sync.test.js
```

- [ ] **Step 3: Implement `computeLineItemDiff` parsed branch**

Replace name-Map logic with:

```js
  const claimedIds = new Set();

  // manual items first (unchanged) — also add their twentyIds to claimedIds when updated/created targeting existing

  const byNameQueues = new Map();
  for (const li of existingLineItems) {
    const key = normalizePattern(li.name);
    if (!byNameQueues.has(key)) byNameQueues.set(key, []);
    byNameQueues.get(key).push(li);
  }

  for (const item of parsedItems) {
    if (item.twenty_id && existingById.has(item.twenty_id) && !claimedIds.has(item.twenty_id)) {
      const existing = existingById.get(item.twenty_id);
      if (isProtected(existing.stage)) {
        claimedIds.add(existing.id);
        continue;
      }
      claimedIds.add(existing.id);
      toUpdate.push({ twentyId: existing.id, item });
      continue;
    }

    const key = normalizePattern(item.name);
    const queue = byNameQueues.get(key) || [];
    let matched = null;
    while (queue.length) {
      const candidate = queue.shift();
      if (claimedIds.has(candidate.id)) continue;
      matched = candidate;
      break;
    }
    if (matched) {
      if (isProtected(matched.stage)) {
        claimedIds.add(matched.id);
        continue;
      }
      claimedIds.add(matched.id);
      toUpdate.push({ twentyId: matched.id, item });
    } else {
      toCreate.push(item);
    }
  }

  for (const li of existingLineItems) {
    if (manualTwentyIds.has(li.id)) continue;
    if (claimedIds.has(li.id)) continue;
    if (isProtected(li.stage)) {
      preserved.push({ id: li.id, name: li.name, stage: li.stage });
      continue;
    }
    if (isUnsyncedManualTwenty(li, manualParserTwentyIds)) continue;
    toDelete.push(li.id);
  }
```

Ensure manual path also adds to `claimedIds`. Remove old `parsedEligibleNames` name-set delete logic (replaced by claimedIds).

- [ ] **Step 4: Run — expect PASS**

```bash
cd backend && npm test -- tests/twenty-line-items-sync.test.js
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/twenty-line-items-sync.js backend/tests/twenty-line-items-sync.test.js
git commit -m "$(cat <<'EOF'
Match Twenty line items by twenty_id then FIFO duplicate names.

EOF
)"
```

---

### Task 4: Repair pure helpers (TDD, no I/O)

**Files:**
- Create: `backend/src/services/free-entry-duplicate-repair.js`
- Create: `backend/tests/free-entry-duplicate-repair.test.js`

**Interfaces:**
- Produces:
  - `export function isFreeEntryTemplateName(name): boolean` — reuse `/свободная запись/i`
  - `export function planTwentyFreeEntryRename(li): { id, name, kommentariy } | null`
  - `export function planTwentyNameDisambiguation(lineItems): Array<{ id, name }>` — skip names already matching `/ \((#\d+)\)$/`; order by `createdAt` asc then id
  - `export function planLocalTwentyIdUntangle(localItems, twentyItems): Array<{ localId, twenty_id }>` — assignments after untangle (include clears as `twenty_id: null`)
  - `export function dealNeedsFreeEntryRepair({ localItems, twentyItems }): boolean`

- [ ] **Step 1: Write failing tests** covering rename, disambiguate idempotency, shared twenty_id untangle (prefer amount_locked row keeps id; other gets orphan or null), `dealNeedsFreeEntryRepair` true/false.

Example untangle expectation:

```js
  it('untangles shared twenty_id preferring amount_locked', () => {
    const local = [
      { id: 1, name: 'Макет', twenty_id: 'li-shared', amount_locked: 0 },
      { id: 2, name: 'Макет (#2)', twenty_id: 'li-shared', amount_locked: 1 },
    ];
    const twenty = [
      { id: 'li-shared', name: 'Макет' },
      { id: 'li-orphan', name: 'Макет (#2)' },
    ];
    const plan = planLocalTwentyIdUntangle(local, twenty);
    expect(plan).toEqual(
      expect.arrayContaining([
        { localId: 2, twenty_id: 'li-shared' },
        { localId: 1, twenty_id: 'li-orphan' },
      ]),
    );
  });
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd backend && npm test -- tests/free-entry-duplicate-repair.test.js
```

- [ ] **Step 3: Implement pure helpers** in `free-entry-duplicate-repair.js` (no DB/Twenty yet).

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/free-entry-duplicate-repair.js backend/tests/free-entry-duplicate-repair.test.js
git commit -m "$(cat <<'EOF'
Add pure planners for free-entry duplicate repair.

EOF
)"
```

---

### Task 5: Repair job runner + startup wire

**Files:**
- Modify: `backend/src/services/free-entry-duplicate-repair.js` (add async runner)
- Modify: `backend/src/index.js` (background kick after listen)
- Modify: `backend/tests/free-entry-duplicate-repair.test.js` (flag/state machine with mocked gql/db)
- Optionally extend list query in repair to fetch `kommentariy`, `createdAt`, `amount` via dedicated GraphQL (do not break `listLineItemsForOpportunity` callers — add `listLineItemsForRepair` in the same file or twenty-line-items-sync)

**Interfaces:**
- Produces: `export async function runFreeEntryDuplicateRepairIfNeeded({ getDb, requireTwentyConfig, gql, … }): Promise<{ status: 'skipped'|'done'|'failed', … }>`
- Settings key `free_entry_duplicate_repair_v1`
- Also store `free_entry_duplicate_repair_v1_started_at` ISO timestamp when setting `running` (for 6h stale detection)

- [ ] **Step 1: Failing tests for flag machine**

```js
  it('skips when settings flag is done', async () => { /* … */ });
  it('marks failed on hard gql error and does not set done', async () => { /* … */ });
  it('sets done after processing deals even with soft per-deal errors', async () => { /* … */ });
  it('retries when running started_at is older than 6 hours', async () => { /* … */ });
```

Use in-memory sqlite + mocked `gql`.

- [ ] **Step 2: Implement runner**

Per deal with `twenty_id`:
1. List Twenty LIs (id, name, stage, kommentariy, createdAt).
2. Load local items.
3. If `!dealNeedsFreeEntryRepair(…)` continue.
4. Apply rename mutations from `planTwentyFreeEntryRename`.
5. Re-list or apply local planned names then `planTwentyNameDisambiguation` → mutations.
6. `planLocalTwentyIdUntangle` → UPDATE local `twenty_id`.
7. Recompute opportunity amount via existing `getItemsForTwenty` + `computeDealItemsTotal` + `updateOpportunity` amount only.
8. Soft catch per deal.

Flag transitions as in spec.

- [ ] **Step 3: Wire `index.js`**

```js
  app.listen(config.port, () => {
    console.log(`CRM Parser running on port ${config.port}`);
    setImmediate(() => {
      runFreeEntryDuplicateRepairIfNeeded(/* deps */).catch((err) => {
        console.error('[free-entry-repair] failed:', err.message);
      });
    });
  });
```

- [ ] **Step 4: Run focused tests PASS**

```bash
cd backend && npm test -- tests/free-entry-duplicate-repair.test.js tests/tony-mapping.test.js tests/deal-items-update.test.js tests/twenty-line-items-sync.test.js
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/free-entry-duplicate-repair.js backend/tests/free-entry-duplicate-repair.test.js backend/src/index.js backend/src/services/twenty-line-items-sync.js
git commit -m "$(cat <<'EOF'
Run one-shot free-entry duplicate repair after parser startup.

EOF
)"
```

---

### Task 6: Final verification

**Files:** none (verification)

- [ ] **Step 1: Run feature-related suites**

```bash
cd backend && npm test -- tests/tony-mapping.test.js tests/deal-items-update.test.js tests/twenty-line-items-sync.test.js tests/free-entry-duplicate-repair.test.js
```

Expected: all PASS.

- [ ] **Step 2: Spec coverage checklist**

| Spec requirement | Task |
|------------------|------|
| disambiguate `(#2)` | 1 |
| override map occurrence keys | 2 |
| twenty_id-first + FIFO | 3 |
| one-shot rename/disambiguate/untangle/amount | 4–5 |
| startup flag + stale running | 5 |
| no BrandingTwentyView changes | — |

- [ ] **Step 3: Commit plan if untracked**

```bash
git add docs/superpowers/plans/2026-08-04-free-entry-duplicate-identity.md
git commit -m "$(cat <<'EOF'
Add implementation plan for free-entry duplicate identity repair.

EOF
)"
```

---

## Spec coverage self-review

All goals from the design have tasks. No TBD placeholders. Suffix format and settings key are consistent across tasks. Stage-protection exception for repair rename is isolated to Task 5 runner (not Task 3 sync path).
