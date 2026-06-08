# Item Blacklist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a global item blacklist (exact + substring) that excludes matching positions from automatic Twenty sync, with Settings management and one-click add from deal review.

**Architecture:** New `blacklist_items` SQLite table and `blacklist.js` service handle normalization and matching. `twenty-items.js` checks blacklist after `sync_override` rules; manual `include` still wins. Blacklist is loaded once per request and passed into `enrichDealItems` / `getItemsForTwenty`. Frontend mirrors the keywords Settings pattern and extends `DealItems.jsx`.

**Tech Stack:** Node.js 20, Express, better-sqlite3, Vitest; React 18, TanStack Query, Tailwind CSS.

**Spec:** `docs/superpowers/specs/2026-06-08-blacklist-design.md`

---

## File Structure

| File | Responsibility |
|------|----------------|
| `backend/src/db/schema.sql` | DDL for `blacklist_items` |
| `backend/src/db/migrate.js` | Ensure table exists on startup |
| `backend/src/services/blacklist.js` | Normalize, match, load, create, delete |
| `backend/src/services/twenty-items.js` | Blacklist-aware eligibility + enrich |
| `backend/src/services/twenty-sync.js` | Pass blacklist into sync/preview |
| `backend/src/routes/blacklist.js` | CRUD API |
| `backend/src/routes/deals.js` | Blacklist-aware counts + shortcut endpoint |
| `backend/src/index.js` | Mount `/api/blacklist` |
| `backend/tests/blacklist.test.js` | Matching + DB helpers unit tests |
| `backend/tests/twenty-items.test.js` | Eligibility with blacklist |
| `frontend/src/api.js` | React Query hooks |
| `frontend/src/pages/Settings.jsx` | Blacklist management UI |
| `frontend/src/components/DealItems.jsx` | Badge, button, checkbox labels |

---

### Task 1: Database — `blacklist_items` table

**Files:**
- Modify: `backend/src/db/schema.sql`
- Modify: `backend/src/db/migrate.js`

- [ ] **Step 1: Add table to schema**

Append to `backend/src/db/schema.sql` (before `INSERT OR IGNORE` lines):

```sql
CREATE TABLE IF NOT EXISTS blacklist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern TEXT NOT NULL,
  match_type TEXT NOT NULL CHECK (match_type IN ('exact', 'substring')),
  source_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (pattern, match_type)
);
```

- [ ] **Step 2: Add migrate guard**

In `backend/src/db/migrate.js`, after `db.exec(schema)` add:

```js
  db.exec(`
    CREATE TABLE IF NOT EXISTS blacklist_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern TEXT NOT NULL,
      match_type TEXT NOT NULL CHECK (match_type IN ('exact', 'substring')),
      source_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (pattern, match_type)
    );
  `);
```

- [ ] **Step 3: Verify migration**

Run: `cd backend && node -e "import('./src/db/connection.js').then(m => { m.initDb(); import('./src/db/migrate.js').then(x => x.migrate()); const db = m.getDb(); console.log(db.prepare(\"SELECT name FROM sqlite_master WHERE name='blacklist_items'\").get()); })"`

Expected: `{ name: 'blacklist_items' }`

- [ ] **Step 4: Commit**

```bash
git add backend/src/db/schema.sql backend/src/db/migrate.js
git commit -m "feat: add blacklist_items table"
```

---

### Task 2: Blacklist service (TDD)

**Files:**
- Create: `backend/src/services/blacklist.js`
- Create: `backend/tests/blacklist.test.js`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/blacklist.test.js`:

```js
import { describe, it, expect } from 'vitest';
import {
  normalizePattern,
  matchesBlacklistEntry,
  findBlacklistMatch,
  isBlacklisted,
} from '../src/services/blacklist.js';

describe('blacklist matching', () => {
  const entries = [
    { id: 1, pattern: 'стойка указатель напольная а4', matchType: 'exact' },
    { id: 2, pattern: 'указатель', matchType: 'substring' },
  ];

  it('normalizes case and ё', () => {
    expect(normalizePattern('  СтЁйка  ')).toBe('стейка');
  });

  it('exact match is case-insensitive', () => {
    expect(
      matchesBlacklistEntry('Стойка указатель напольная А4', entries[0])
    ).toBe(true);
    expect(
      matchesBlacklistEntry('Стойка указатель напольная А40', entries[0])
    ).toBe(false);
  });

  it('substring match finds fragment', () => {
    expect(matchesBlacklistEntry('Стойка-указатель А3', entries[1])).toBe(true);
    expect(matchesBlacklistEntry('Стойка напольная', entries[1])).toBe(false);
  });

  it('findBlacklistMatch returns first entry by list order', () => {
    const match = findBlacklistMatch('Стойка указатель напольная А4', entries);
    expect(match?.id).toBe(1);
  });

  it('isBlacklisted returns boolean', () => {
    expect(isBlacklisted('любая стойка', entries)).toBe(false);
    expect(isBlacklisted('Стойка указатель напольная А4', entries)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- tests/blacklist.test.js`

Expected: FAIL — module `../src/services/blacklist.js` not found

- [ ] **Step 3: Implement blacklist service**

Create `backend/src/services/blacklist.js`:

```js
const VALID_MATCH_TYPES = new Set(['exact', 'substring']);

export function normalizePattern(text) {
  return String(text ?? '').toLowerCase().replace(/ё/g, 'е').trim();
}

export function matchesBlacklistEntry(itemName, entry) {
  const name = normalizePattern(itemName);
  const pattern = normalizePattern(entry.pattern);
  if (!name || !pattern) return false;
  if (entry.matchType === 'exact') return name === pattern;
  if (entry.matchType === 'substring') return name.includes(pattern);
  return false;
}

export function findBlacklistMatch(itemName, entries = []) {
  for (const entry of entries) {
    if (matchesBlacklistEntry(itemName, entry)) return entry;
  }
  return null;
}

export function isBlacklisted(itemName, entries = []) {
  return findBlacklistMatch(itemName, entries) !== null;
}

function mapRow(row) {
  return {
    id: row.id,
    pattern: row.pattern,
    matchType: row.match_type,
    sourceName: row.source_name,
    createdAt: row.created_at,
  };
}

export function loadBlacklist(db) {
  return db
    .prepare('SELECT * FROM blacklist_items ORDER BY created_at ASC')
    .all()
    .map(mapRow);
}

export function findBlacklistByPattern(db, pattern, matchType) {
  const normalized = normalizePattern(pattern);
  return db
    .prepare('SELECT * FROM blacklist_items WHERE pattern = ? AND match_type = ?')
    .get(normalized, matchType);
}

export function createBlacklistEntry(db, { pattern, matchType, sourceName = null }) {
  const normalized = normalizePattern(pattern);
  if (!normalized) {
    const err = new Error('pattern is required');
    err.status = 400;
    throw err;
  }
  if (!VALID_MATCH_TYPES.has(matchType)) {
    const err = new Error('matchType must be exact or substring');
    err.status = 400;
    throw err;
  }
  if (findBlacklistByPattern(db, normalized, matchType)) {
    const err = new Error('Blacklist entry already exists');
    err.status = 409;
    throw err;
  }

  const result = db
    .prepare(
      'INSERT INTO blacklist_items (pattern, match_type, source_name) VALUES (?, ?, ?)'
    )
    .run(normalized, matchType, sourceName);

  return mapRow(
    db.prepare('SELECT * FROM blacklist_items WHERE id = ?').get(result.lastInsertRowid)
  );
}

export function deleteBlacklistEntry(db, id) {
  const existing = db.prepare('SELECT id FROM blacklist_items WHERE id = ?').get(id);
  if (!existing) {
    const err = new Error('Blacklist entry not found');
    err.status = 404;
    throw err;
  }
  db.prepare('DELETE FROM blacklist_items WHERE id = ?').run(id);
}
```

- [ ] **Step 4: Run tests**

Run: `cd backend && npm test -- tests/blacklist.test.js`

Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/blacklist.js backend/tests/blacklist.test.js
git commit -m "feat: add blacklist matching service"
```

---

### Task 3: Blacklist-aware Twenty eligibility (TDD)

**Files:**
- Modify: `backend/src/services/twenty-items.js`
- Modify: `backend/tests/twenty-items.test.js`

- [ ] **Step 1: Add failing tests**

Append to `backend/tests/twenty-items.test.js`:

```js
import { isBlacklisted } from '../src/services/blacklist.js';

const blacklist = [
  { id: 1, pattern: 'стойка указатель напольная а4', matchType: 'exact' },
];

describe('blacklist eligibility', () => {
  it('keyword_match + blacklisted → not eligible', () => {
    const item = {
      name: 'Стойка указатель напольная А4',
      classification: 'keyword_match',
      sync_override: null,
    };
    expect(isItemEligibleForTwenty(item, blacklist)).toBe(false);
  });

  it('manual include overrides blacklist', () => {
    const item = {
      name: 'Стойка указатель напольная А4',
      classification: 'keyword_match',
      sync_override: 'include',
    };
    expect(isItemEligibleForTwenty(item, blacklist)).toBe(true);
  });

  it('manual exclude still blocks before blacklist check', () => {
    const item = {
      name: 'Баннер 3x6',
      classification: 'keyword_match',
      sync_override: 'exclude',
    };
    expect(isItemEligibleForTwenty(item, blacklist)).toBe(false);
  });
});
```

Update existing tests: `isItemEligibleForTwenty(item)` calls still work — second arg defaults to `[]`.

- [ ] **Step 2: Run tests to verify new tests fail**

Run: `cd backend && npm test -- tests/twenty-items.test.js`

Expected: 3 new tests FAIL (blacklisted item still eligible)

- [ ] **Step 3: Update twenty-items.js**

Replace contents of `backend/src/services/twenty-items.js`:

```js
import { findBlacklistMatch, isBlacklisted } from './blacklist.js';

const AUTO_ELIGIBLE = new Set(['keyword_match', 'llm_confirmed']);

export function isItemEligibleForTwenty(item, blacklist = []) {
  if (item.sync_override === 'include') return true;
  if (item.sync_override === 'exclude') return false;
  if (isBlacklisted(item.name, blacklist)) return false;
  return AUTO_ELIGIBLE.has(item.classification);
}

export function getItemEligibleReason(item, blacklist = []) {
  if (!isItemEligibleForTwenty(item, blacklist)) return null;
  if (item.sync_override === 'include') return 'manual_include';
  if (item.classification === 'keyword_match') return 'keyword_match';
  if (item.classification === 'llm_confirmed') return 'llm_confirmed';
  return 'auto';
}

export function getItemsForTwenty(items, blacklist = []) {
  return items.filter((item) => isItemEligibleForTwenty(item, blacklist));
}

export function enrichDealItems(items, blacklist = []) {
  return items.map((item) => {
    const match = findBlacklistMatch(item.name, blacklist);
    return {
      ...item,
      blacklisted: Boolean(match),
      blacklistMatch: match
        ? { id: match.id, pattern: match.pattern, matchType: match.matchType }
        : null,
      eligibleForTwenty: isItemEligibleForTwenty(item, blacklist),
      syncMode: item.sync_override ? 'manual' : 'auto',
      eligibleReason: getItemEligibleReason(item, blacklist),
    };
  });
}

/** @deprecated Use enrichDealItems counts in JS — SQL cannot express substring blacklist */
export const TWENTY_ELIGIBLE_COUNT_SQL = `
  (SELECT COUNT(*) FROM deal_items di
    WHERE di.deal_id = d.id
      AND (
        di.sync_override = 'include'
        OR (
          (di.sync_override IS NULL OR di.sync_override = '')
          AND di.classification IN ('keyword_match', 'llm_confirmed')
        )
      )
  )
`;
```

- [ ] **Step 4: Fix existing tests that call getItemsForTwenty without name**

Update `backend/tests/twenty-items.test.js` existing items to include `name: 'test item'` where needed (unblacklisted default).

- [ ] **Step 5: Run all twenty-items tests**

Run: `cd backend && npm test -- tests/twenty-items.test.js`

Expected: PASS (9 tests)

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/twenty-items.js backend/tests/twenty-items.test.js
git commit -m "feat: apply blacklist in Twenty eligibility"
```

---

### Task 4: Blacklist API routes

**Files:**
- Create: `backend/src/routes/blacklist.js`
- Modify: `backend/src/index.js`

- [ ] **Step 1: Create blacklist router**

Create `backend/src/routes/blacklist.js`:

```js
import { Router } from 'express';
import { getDb } from '../db/connection.js';
import {
  loadBlacklist,
  createBlacklistEntry,
  deleteBlacklistEntry,
} from '../services/blacklist.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDb();
  res.json({ items: loadBlacklist(db) });
});

router.post('/', (req, res) => {
  const { pattern, matchType, sourceName } = req.body ?? {};
  try {
    const db = getDb();
    const item = createBlacklistEntry(db, { pattern, matchType, sourceName });
    res.status(201).json({ item });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const db = getDb();
    deleteBlacklistEntry(db, Number(req.params.id));
    res.json({ success: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

export default router;
```

- [ ] **Step 2: Mount router**

In `backend/src/index.js`:

```js
import blacklistRouter from './routes/blacklist.js';
```

After `app.use('/api/settings', settingsRouter);` add:

```js
app.use('/api/blacklist', blacklistRouter);
```

- [ ] **Step 3: Smoke test manually**

Run backend: `cd backend && npm run dev`

```bash
curl -s http://localhost:3000/api/blacklist
curl -s -X POST http://localhost:3000/api/blacklist -H "Content-Type: application/json" -d "{\"pattern\":\"тест\",\"matchType\":\"exact\"}"
```

Expected: `{ items: [] }` then `{ item: { id, pattern: "тест", matchType: "exact", ... } }`

- [ ] **Step 4: Commit**

```bash
git add backend/src/routes/blacklist.js backend/src/index.js
git commit -m "feat: add blacklist CRUD API"
```

---

### Task 5: Deals routes — blacklist counts + shortcut

**Files:**
- Modify: `backend/src/routes/deals.js`
- Modify: `backend/src/services/twenty-sync.js`

- [ ] **Step 1: Add helper to compute deal counts**

At top of `backend/src/routes/deals.js`, replace imports:

```js
import { syncDealToTwenty, buildSyncPreview } from '../services/twenty-sync.js';
import { enrichDealItems } from '../services/twenty-items.js';
import { loadBlacklist, createBlacklistEntry } from '../services/blacklist.js';
```

Remove `TWENTY_ELIGIBLE_COUNT_SQL` import.

Add helper after imports:

```js
function attachDealItemCounts(deals, db) {
  if (!deals.length) return deals;
  const blacklist = loadBlacklist(db);
  const ids = deals.map((d) => d.id);
  const placeholders = ids.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT * FROM deal_items WHERE deal_id IN (${placeholders})`)
    .all(...ids);

  const byDeal = new Map();
  for (const row of rows) {
    if (!byDeal.has(row.deal_id)) byDeal.set(row.deal_id, []);
    byDeal.get(row.deal_id).push(row);
  }

  return deals.map((deal) => {
    const enriched = enrichDealItems(byDeal.get(deal.id) || [], blacklist);
    return {
      ...deal,
      branding_count: enriched.filter((i) => i.eligibleForTwenty).length,
      total_items: enriched.length,
    };
  });
}
```

- [ ] **Step 2: Update GET /deals**

Replace SQL that uses `TWENTY_ELIGIBLE_COUNT_SQL`:

```js
  const rawDeals = db.prepare(`
    SELECT d.*
    FROM deals d WHERE ${where}
    ORDER BY d.start_date DESC LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const deals = attachDealItemCounts(rawDeals, db);
```

- [ ] **Step 3: Update GET /deals/:id**

```js
  const blacklist = loadBlacklist(db);
  const items = db.prepare('SELECT * FROM deal_items WHERE deal_id = ?').all(req.params.id);
  const enrichedItems = enrichDealItems(items, blacklist);
```

- [ ] **Step 4: Add shortcut endpoint**

Before `router.patch('/:dealId/items/:itemId', ...)` add:

```js
router.post('/:dealId/items/:itemId/blacklist', (req, res) => {
  const db = getDb();
  const item = db
    .prepare('SELECT id, name FROM deal_items WHERE id = ? AND deal_id = ?')
    .get(req.params.itemId, req.params.dealId);
  if (!item) return res.status(404).json({ error: 'Item not found' });

  try {
    const entry = createBlacklistEntry(db, {
      pattern: item.name,
      matchType: 'exact',
      sourceName: item.name,
    });
    res.status(201).json({ item: entry });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});
```

- [ ] **Step 5: Update twenty-sync.js**

At top add:

```js
import { loadBlacklist } from './blacklist.js';
```

In `buildSyncPreview`:

```js
  const blacklist = loadBlacklist(db);
  const eligibleItems = getItemsForTwenty(allItems, blacklist);
```

And update `getItemEligibleReason(item)` → `getItemEligibleReason(item, blacklist)` in the map.

In `syncDealToTwenty`:

```js
  const blacklist = loadBlacklist(db);
  const items = getItemsForTwenty(allItems, blacklist);
```

Remove `export { enrichDealItems }` re-export if unused externally (deals.js imports from twenty-items directly).

- [ ] **Step 6: Run full backend tests**

Run: `cd backend && npm test`

Expected: all tests PASS

- [ ] **Step 7: Commit**

```bash
git add backend/src/routes/deals.js backend/src/services/twenty-sync.js
git commit -m "feat: wire blacklist into deals and Twenty sync"
```

---

### Task 6: Frontend API hooks

**Files:**
- Modify: `frontend/src/api.js`

- [ ] **Step 1: Add hooks after `useUpdateKeywords`**

```js
export function useBlacklist() {
  return useQuery({
    queryKey: ['blacklist'],
    queryFn: () => api.get('/blacklist').then((r) => r.data.items),
  });
}

export function useAddBlacklistItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ pattern, matchType, sourceName }) =>
      api.post('/blacklist', { pattern, matchType, sourceName }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['blacklist'] });
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['deal'] });
    },
  });
}

export function useRemoveBlacklistItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.delete(`/blacklist/${id}`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['blacklist'] });
      qc.invalidateQueries({ queryKey: ['deals'] });
      qc.invalidateQueries({ queryKey: ['deal'] });
    },
  });
}

export function useAddItemToBlacklist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ dealId, itemId }) =>
      api.post(`/deals/${dealId}/items/${itemId}/blacklist`).then((r) => r.data),
    onSuccess: (_, { dealId }) => {
      qc.invalidateQueries({ queryKey: ['blacklist'] });
      qc.invalidateQueries({ queryKey: ['deal', dealId] });
      qc.invalidateQueries({ queryKey: ['deals'] });
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/api.js
git commit -m "feat: add blacklist React Query hooks"
```

---

### Task 7: Settings UI — blacklist section

**Files:**
- Modify: `frontend/src/pages/Settings.jsx`

- [ ] **Step 1: Add imports**

```js
import {
  useSettings,
  useUpdateSetting,
  useKeywords,
  useUpdateKeywords,
  useCompanies,
  useClearParsingData,
  useBlacklist,
  useAddBlacklistItem,
  useRemoveBlacklistItem,
} from '../api';
```

- [ ] **Step 2: Add state and hooks inside component**

```js
  const { data: blacklist } = useBlacklist();
  const addBlacklistItem = useAddBlacklistItem();
  const removeBlacklistItem = useRemoveBlacklistItem();
  const [newBlacklistPattern, setNewBlacklistPattern] = useState('');
  const [newBlacklistMatchType, setNewBlacklistMatchType] = useState('exact');
  const [blacklistError, setBlacklistError] = useState('');
```

- [ ] **Step 3: Add section after keywords**

```jsx
      <Section title="Блеклист позиций">
        <p className="text-xs text-gray-500 mb-3">
          Позиции в блеклисте не попадают в Twenty автоматически. Ручная галочка в сделке перебивает блеклист.
        </p>
        <div className="flex flex-wrap gap-2 mb-3">
          {(blacklist || []).map((entry) => (
            <span
              key={entry.id}
              className="inline-flex items-center gap-1 bg-red-50 text-red-700 px-2 py-1 rounded-md text-sm"
            >
              {entry.sourceName || entry.pattern}
              <span className="text-xs text-red-400">
                ({entry.matchType === 'exact' ? 'точное' : 'фрагмент'})
              </span>
              <button
                onClick={() => removeBlacklistItem.mutate(entry.id)}
                className="text-red-400 hover:text-red-600"
              >
                &times;
              </button>
            </span>
          ))}
        </div>
        {blacklistError && (
          <p className="text-xs text-red-600 mb-2">{blacklistError}</p>
        )}
        <div className="flex flex-wrap gap-2 items-end">
          <input
            type="text"
            value={newBlacklistPattern}
            onChange={(e) => setNewBlacklistPattern(e.target.value)}
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm flex-1 min-w-[12rem] max-w-lg"
            placeholder="Стойка указатель напольная А4"
          />
          <select
            value={newBlacklistMatchType}
            onChange={(e) => setNewBlacklistMatchType(e.target.value)}
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm"
          >
            <option value="exact">Точное</option>
            <option value="substring">Фрагмент</option>
          </select>
          <button
            onClick={() => {
              setBlacklistError('');
              addBlacklistItem.mutate(
                { pattern: newBlacklistPattern, matchType: newBlacklistMatchType },
                {
                  onSuccess: () => setNewBlacklistPattern(''),
                  onError: (err) => {
                    const msg = err.response?.status === 409
                      ? 'Уже в блеклисте'
                      : err.response?.data?.error || 'Ошибка добавления';
                    setBlacklistError(msg);
                  },
                }
              );
            }}
            disabled={!newBlacklistPattern.trim() || addBlacklistItem.isPending}
            className="px-3 py-1.5 bg-red-600 text-white text-sm rounded-md hover:bg-red-700 disabled:opacity-50"
          >
            Добавить
          </button>
        </div>
      </Section>
```

- [ ] **Step 4: Build frontend**

Run: `cd frontend && npm run build`

Expected: build succeeds

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Settings.jsx
git commit -m "feat: add blacklist management in Settings"
```

---

### Task 8: DealItems UI — add to blacklist

**Files:**
- Modify: `frontend/src/components/DealItems.jsx`

- [ ] **Step 1: Update imports and hooks**

```js
import { useUpdateItemSyncOverride, useResetSyncOverrides, useAddItemToBlacklist } from '../api';
```

Inside component:

```js
  const addToBlacklist = useAddItemToBlacklist();

  function syncLabel(item) {
    if (item.syncMode === 'manual') return 'вручную';
    if (item.blacklisted) return 'блеклист';
    return 'авто';
  }
```

- [ ] **Step 2: Add column to table header**

After `<th className="p-2">Классификация</th>` add:

```jsx
            {!readOnly && <th className="p-2 w-28">Действия</th>}
```

- [ ] **Step 3: Update checkbox label**

Replace:

```jsx
                  <span className="text-xs text-gray-500">
                    {item.syncMode === 'manual' ? 'вручную' : 'авто'}
                  </span>
```

With:

```jsx
                  <span className="text-xs text-gray-500">{syncLabel(item)}</span>
```

- [ ] **Step 4: Add actions cell per row**

After classification `<td>`:

```jsx
              {!readOnly && (
                <td className="p-2" onClick={(e) => e.stopPropagation()}>
                  {item.blacklisted ? (
                    <span className="text-xs text-red-600">блеклист</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => addToBlacklist.mutate({ dealId, itemId: item.id })}
                      disabled={addToBlacklist.isPending}
                      className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50"
                    >
                      В блеклист
                    </button>
                  )}
                </td>
              )}
```

- [ ] **Step 5: Rebuild and sync public**

Run: `cd backend && npm run build:public`

Expected: frontend copied to `backend/public`

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/DealItems.jsx
git commit -m "feat: add blacklist button in deal items review"
```

---

### Task 9: Final verification

- [ ] **Step 1: Run all backend tests**

Run: `cd backend && npm test`

Expected: all PASS

- [ ] **Step 2: Manual smoke test**

1. Open Settings → add substring «указатель» and exact «Стойка указатель напольная А4»
2. Open Deals → expand deal with стойки
3. Blacklisted row: ☐ checkbox, label «блеклист»
4. Other стойки: ☑ if keyword_match
5. Check blacklisted row manually → ☑, label «вручную», counter increases
6. Click «В блеклист» on another item → appears in Settings, row shows badge
7. Delete from Settings → item auto-eligible again

- [ ] **Step 3: Update spec status**

In `docs/superpowers/specs/2026-06-08-blacklist-design.md` change `Status: Draft` → `Status: Approved`

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-06-08-blacklist-design.md
git commit -m "docs: mark blacklist spec as approved"
```

---

## Spec Coverage Checklist

| Spec requirement | Task |
|------------------|------|
| `blacklist_items` table | Task 1 |
| exact + substring matching | Task 2 |
| manual include overrides blacklist | Task 3 |
| enrichDealItems fields | Task 3 |
| branding_count without SQL substring | Task 5 |
| CRUD `/api/blacklist` | Task 4 |
| shortcut from deal item | Task 5 |
| Settings UI | Task 7 |
| DealItems button + labels | Task 8 |
| sync/preview uses blacklist | Task 5 |
| Tests | Tasks 2, 3, 9 |
