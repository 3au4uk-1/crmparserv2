# Parser tip_rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Classify synced Twenty line items via a unified `tip_rules` table (`pattern → tip + tipDetail`) with Settings zones, migrating existing Подряд/Баннера lists.

**Architecture:** New `tip-rules` service owns match + CRUD + defaults. Sync (`buildLineItemFields`) always overwrites tip/tipDetail on match and omits both on no match. Settings UI zones filter the same table by tip. Old `podryad`/`banner` APIs become thin adapters writing `tip_rules`.

**Tech Stack:** Node ESM, better-sqlite3, Express, Vitest, React Settings page (crmparserv2).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-27-parser-tip-rules-design.md`
- On match: always write `tip` + resolved `tipDetail`
- On no match: do not set `tip` / `tipDetail` on GraphQL input
- Defaults: empty detail → `PLENKA`→`NASHI`, `BANNERA`→`KTO_EDET`
- First match: `priority ASC`, then `created_at ASC`
- Do not change blacklist / restoration amount behavior
- Do not change TwentyView board `tip-from-name` in this plan
- Mirror tipDetail enums locally — do not import TwentyView package
- Tests: `cd backend && npm test -- <file>`

## File map

| File | Responsibility |
|------|----------------|
| `backend/src/services/tip-taxonomy.js` | Allowed tips, tip→detail matrix, labels, `resolveTipDetail(rule)` |
| `backend/src/services/tip-rules.js` | Match, load, CRUD, seed helpers |
| `backend/src/db/migrate.js` | Create `tip_rules`, migrate podryad/banner, seed |
| `backend/src/services/twenty-line-item.js` | Apply tip rule in `buildLineItemFields` |
| `backend/src/services/twenty-sync.js` | Pass `tipRules` instead of podryad/banner lists |
| `backend/src/services/twenty-line-items-sync.js` | Same |
| `backend/src/services/twenty-items.js` | Enrich with `tipRuleMatch` |
| `backend/src/services/twenty-line-item-api.js` | Load tip rules for manual API creates |
| `backend/src/routes/tip-rules.js` | REST CRUD |
| `backend/src/routes/podryad.js` / `banner.js` | Thin adapters → tip_rules |
| `backend/src/routes/deals.js` | Item→podryad/banner create tip_rules |
| `backend/src/index.js` | Mount `/api/tip-rules` |
| `frontend/src/api.js` | Hooks for tip-rules |
| `frontend/src/pages/Settings.jsx` | Zones UI |
| `backend/tests/tip-taxonomy.test.js` | Defaults / validation |
| `backend/tests/tip-rules.test.js` | Match + CRUD + migration |
| `backend/tests/twenty-line-item.test.js` | Update existing tip assertions |

---

### Task 1: Tip taxonomy module (defaults + validation)

**Files:**
- Create: `backend/src/services/tip-taxonomy.js`
- Test: `backend/tests/tip-taxonomy.test.js`

**Interfaces:**
- Produces:
  - `ALLOWED_TIPS: string[]`
  - `TIP_DETAIL_BY_TIP: Record<string, string[]>`
  - `DEFAULT_TIP_DETAIL_BY_TIP: Record<string, string>`
  - `isTipDetailValidForTip(tip, tipDetail): boolean`
  - `resolveTipDetail(rule: { tip: string, tipDetail?: string|null }): string | null`  
    (`null` means omit from GraphQL input)

- [ ] **Step 1: Write failing tests**

```js
import { describe, expect, it } from 'vitest';
import {
  isTipDetailValidForTip,
  resolveTipDetail,
} from '../src/services/tip-taxonomy.js';

describe('resolveTipDetail', () => {
  it('uses explicit valid tipDetail', () => {
    expect(resolveTipDetail({ tip: 'PODRYAD', tipDetail: 'LIZA_SUKNO' })).toBe('LIZA_SUKNO');
  });

  it('defaults PLENKA → NASHI when empty', () => {
    expect(resolveTipDetail({ tip: 'PLENKA', tipDetail: null })).toBe('NASHI');
  });

  it('defaults BANNERA → KTO_EDET when empty', () => {
    expect(resolveTipDetail({ tip: 'BANNERA', tipDetail: null })).toBe('KTO_EDET');
  });

  it('returns null for PODRYAD without detail (omit)', () => {
    expect(resolveTipDetail({ tip: 'PODRYAD', tipDetail: null })).toBe(null);
  });

  it('ignores invalid explicit detail and falls back to default/omit', () => {
    expect(resolveTipDetail({ tip: 'BANNERA', tipDetail: 'LIZA_SUKNO' })).toBe('KTO_EDET');
    expect(resolveTipDetail({ tip: 'PODRYAD', tipDetail: 'NASHI' })).toBe(null);
  });
});

describe('isTipDetailValidForTip', () => {
  it('allows empty', () => {
    expect(isTipDetailValidForTip('PODRYAD', null)).toBe(true);
  });
  it('rejects wrong pair', () => {
    expect(isTipDetailValidForTip('PLENKA', 'ROLL_UP')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL (module missing)**

```bash
cd backend && npm test -- tip-taxonomy.test.js
```

- [ ] **Step 3: Implement `tip-taxonomy.js`**

Mirror TwentyView `TIP_DETAIL_BY_TIP` / defaults:

```js
export const ALLOWED_TIPS = ['PODRYAD', 'BANNERA', 'PROIZVODSTVO', 'PLENKA', 'RESTAVRACIYA'];

export const TIP_DETAIL_BY_TIP = {
  PLENKA: ['NASHI', 'NE_NASHI'],
  RESTAVRACIYA: ['NASHI', 'NE_NASHI'],
  BANNERA: ['KTO_EDET', 'YURA', 'MAGA', 'TOPILSKIY'],
  PODRYAD: ['GLAV_PRINT', 'PASHA_VINDER', 'ZARYA', 'LIZA_SUKNO', 'KUVALDIN_KLISHE', 'SVOE'],
  PROIZVODSTVO: ['ROLL_UP', 'POP_UP', 'PROMO_STOYKA', 'PROIZVODSTVO_DRUGOE'],
};

export const DEFAULT_TIP_DETAIL_BY_TIP = {
  BANNERA: 'KTO_EDET',
  PLENKA: 'NASHI',
};

export const TIP_DETAIL_LABELS = {
  KTO_EDET: 'кто едет?',
  NASHI: 'Наши',
  NE_NASHI: 'Не наши',
  YURA: 'Юра',
  MAGA: 'Мага',
  TOPILSKIY: 'Топильский',
  GLAV_PRINT: 'Глав принт',
  PASHA_VINDER: 'Паша виндер',
  ZARYA: 'Заря',
  LIZA_SUKNO: 'Лиза сукно',
  KUVALDIN_KLISHE: 'Кувалдин клише',
  SVOE: 'Своё',
  ROLL_UP: 'Ролл-ап',
  POP_UP: 'Поп-ап',
  PROMO_STOYKA: 'Промо-стойка',
  PROIZVODSTVO_DRUGOE: 'Другое',
};

export function isTipDetailValidForTip(tip, tipDetail) {
  if (!tipDetail) return true;
  if (!tip) return false;
  const allowed = TIP_DETAIL_BY_TIP[tip];
  return Boolean(allowed?.includes(tipDetail));
}

export function resolveTipDetail(rule) {
  const tip = rule.tip;
  const raw = rule.tipDetail ?? rule.tip_detail ?? null;
  if (raw && isTipDetailValidForTip(tip, raw)) return raw;
  return DEFAULT_TIP_DETAIL_BY_TIP[tip] ?? null;
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd backend && npm test -- tip-taxonomy.test.js
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/tip-taxonomy.js backend/tests/tip-taxonomy.test.js
git commit -m "feat(tip-rules): add tip taxonomy defaults and validation"
```

---

### Task 2: Pure matcher (no DB)

**Files:**
- Create: `backend/src/services/tip-rules.js` (matcher + exports; CRUD added in Task 3)
- Test: `backend/tests/tip-rules-match.test.js`

**Interfaces:**
- Consumes: `normalizePattern` from `./blacklist.js`
- Produces:
  - `matchesTipRule(itemName, entry): boolean`
  - `findTipRuleMatch(itemName, rules): entry | null`  
    entry shape: `{ id?, pattern, matchType, tip, tipDetail, priority, createdAt? }`

- [ ] **Step 1: Write failing matcher tests**

```js
import { describe, expect, it } from 'vitest';
import { findTipRuleMatch } from '../src/services/tip-rules.js';

const rules = [
  { id: 1, pattern: 'оклейк', matchType: 'substring', tip: 'PLENKA', tipDetail: 'NASHI', priority: 50, createdAt: '2026-01-02' },
  { id: 2, pattern: 'клише', matchType: 'substring', tip: 'PODRYAD', tipDetail: 'KUVALDIN_KLISHE', priority: 50, createdAt: '2026-01-01' },
  { id: 3, pattern: 'флаги', matchType: 'substring', tip: 'PODRYAD', tipDetail: null, priority: 100, createdAt: '2026-01-01' },
];

describe('findTipRuleMatch', () => {
  it('returns null when nothing matches', () => {
    expect(findTipRuleMatch('Скотч', rules)).toBe(null);
  });

  it('prefers lower priority number', () => {
    const mixed = [
      { ...rules[2], priority: 100 },
      { pattern: 'флаги односторонние', matchType: 'substring', tip: 'PODRYAD', tipDetail: 'SVOE', priority: 40, createdAt: '2026-01-03' },
    ];
    expect(findTipRuleMatch('Флаги односторонние на виндеры', mixed).tipDetail).toBe('SVOE');
  });

  it('matches substring case-insensitively via normalizePattern', () => {
    expect(findTipRuleMatch('Печать клише лого', rules).tip).toBe('PODRYAD');
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd backend && npm test -- tip-rules-match.test.js
```

- [ ] **Step 3: Implement matcher in `tip-rules.js`**

```js
import { normalizePattern } from './blacklist.js';

export function matchesTipRule(itemName, entry) {
  const name = normalizePattern(itemName);
  const pattern = normalizePattern(entry.pattern);
  if (!name || !pattern) return false;
  if (entry.matchType === 'exact') return name === pattern;
  if (entry.matchType === 'substring') return name.includes(pattern);
  return false;
}

export function findTipRuleMatch(itemName, rules = []) {
  const sorted = [...rules].sort((a, b) => {
    const pa = a.priority ?? 100;
    const pb = b.priority ?? 100;
    if (pa !== pb) return pa - pb;
    return String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''));
  });
  for (const entry of sorted) {
    if (matchesTipRule(itemName, entry)) return entry;
  }
  return null;
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd backend && npm test -- tip-rules-match.test.js
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/tip-rules.js backend/tests/tip-rules-match.test.js
git commit -m "feat(tip-rules): add priority-aware name matcher"
```

---

### Task 3: DB CRUD, migration, seeds

**Files:**
- Modify: `backend/src/services/tip-rules.js`
- Modify: `backend/src/db/migrate.js` (end of `migrate()`, before expense defaults / log)
- Test: `backend/tests/tip-rules-db.test.js`

**Interfaces:**
- Produces:
  - `loadTipRules(db, tip?)`
  - `createTipRule(db, { pattern, matchType, tip, tipDetail?, priority?, sourceName? })`
  - `deleteTipRule(db, id)`
  - `migratePodryadBannerToTipRules(db)`
  - `seedDefaultTipRules(db)`
- Call both migrate helpers from `migrate()` after creating table.

- [ ] **Step 1: Write failing DB tests** (use temp sqlite like other migrate tests)

```js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = path.join(__dirname, '../data/test-tip-rules.db');

describe('tip_rules db', () => {
  let db;
  let migrate;
  let createTipRule;
  let loadTipRules;
  let findTipRuleMatch;
  let seedDefaultTipRules;

  beforeEach(async () => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    process.env.DB_PATH = TEST_DB;
    vi.resetModules();
    ({ migrate } = await import('../src/db/migrate.js'));
    ({ createTipRule, loadTipRules, findTipRuleMatch, seedDefaultTipRules } = await import(
      '../src/services/tip-rules.js'
    ));
    const { initDb, getDb } = await import('../src/db/connection.js');
    initDb();
    migrate();
    db = getDb();
  });

  afterEach(() => {
    db?.close?.();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it('migrates podryad and banner rows into tip_rules', () => {
    // insert into legacy tables then re-run migrate helpers OR assert migrate() already copied
    // Prefer: create legacy rows before migrateTip helpers if migrate is idempotent.
    const tips = loadTipRules(db);
    // After empty migrate, seeds exist:
    expect(tips.some((r) => r.pattern.includes('оклейк') && r.tip === 'PLENKA')).toBe(true);
    expect(tips.some((r) => r.pattern === 'клише' && r.tipDetail === 'KUVALDIN_KLISHE')).toBe(true);
  });

  it('rejects invalid tipDetail for tip', () => {
    expect(() =>
      createTipRule(db, { pattern: 'x', matchType: 'exact', tip: 'PLENKA', tipDetail: 'ROLL_UP' })
    ).toThrow(/tipDetail/);
  });

  it('seed is idempotent', () => {
    const before = loadTipRules(db).length;
    seedDefaultTipRules(db);
    expect(loadTipRules(db).length).toBe(before);
  });
});
```

Adjust `beforeEach` to match this repo’s `connection.js` / `DB_PATH` pattern (see `expense-migrate.test.js`).

- [ ] **Step 2: Run — expect FAIL**

```bash
cd backend && npm test -- tip-rules-db.test.js
```

- [ ] **Step 3: Extend `tip-rules.js` with mapRow/load/create/delete/seed**

```js
import { ALLOWED_TIPS, isTipDetailValidForTip } from './tip-taxonomy.js';

function mapRow(row) {
  return {
    id: row.id,
    pattern: row.pattern,
    matchType: row.match_type,
    tip: row.tip,
    tipDetail: row.tip_detail,
    priority: row.priority,
    sourceName: row.source_name,
    createdAt: row.created_at,
  };
}

export function loadTipRules(db, tip) {
  if (tip) {
    return db
      .prepare('SELECT * FROM tip_rules WHERE tip = ? ORDER BY priority ASC, created_at ASC')
      .all(tip)
      .map(mapRow);
  }
  return db
    .prepare('SELECT * FROM tip_rules ORDER BY priority ASC, created_at ASC')
    .all()
    .map(mapRow);
}

export function createTipRule(db, { pattern, matchType, tip, tipDetail = null, priority = 100, sourceName = null }) {
  const normalized = normalizePattern(pattern);
  if (!normalized) {
    const err = new Error('pattern is required');
    err.status = 400;
    throw err;
  }
  if (!['exact', 'substring'].includes(matchType)) {
    const err = new Error('matchType must be exact or substring');
    err.status = 400;
    throw err;
  }
  if (!ALLOWED_TIPS.includes(tip)) {
    const err = new Error('invalid tip');
    err.status = 400;
    throw err;
  }
  if (tipDetail && !isTipDetailValidForTip(tip, tipDetail)) {
    const err = new Error('tipDetail is not valid for tip');
    err.status = 400;
    throw err;
  }
  const existing = db
    .prepare(
      `SELECT id FROM tip_rules
       WHERE pattern = ? AND match_type = ? AND tip = ?
         AND (tip_detail IS ? OR (tip_detail IS NULL AND ? IS NULL))`
    )
    .get(normalized, matchType, tip, tipDetail, tipDetail);
  if (existing) {
    const err = new Error('Tip rule already exists');
    err.status = 409;
    throw err;
  }
  const result = db
    .prepare(
      `INSERT INTO tip_rules (pattern, match_type, tip, tip_detail, priority, source_name)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(normalized, matchType, tip, tipDetail, priority, sourceName);
  return mapRow(db.prepare('SELECT * FROM tip_rules WHERE id = ?').get(result.lastInsertRowid));
}

export function deleteTipRule(db, id) {
  const existing = db.prepare('SELECT id FROM tip_rules WHERE id = ?').get(id);
  if (!existing) {
    const err = new Error('Tip rule not found');
    err.status = 404;
    throw err;
  }
  db.prepare('DELETE FROM tip_rules WHERE id = ?').run(id);
}

const SEED_RULES = [
  { pattern: 'клише', matchType: 'substring', tip: 'PODRYAD', tipDetail: 'KUVALDIN_KLISHE', priority: 50 },
  { pattern: 'монета', matchType: 'substring', tip: 'PODRYAD', tipDetail: 'KUVALDIN_KLISHE', priority: 50 },
  { pattern: 'сукно', matchType: 'substring', tip: 'PODRYAD', tipDetail: 'LIZA_SUKNO', priority: 50 },
  { pattern: 'ролл-ап', matchType: 'substring', tip: 'PROIZVODSTVO', tipDetail: 'ROLL_UP', priority: 50 },
  { pattern: 'роллап', matchType: 'substring', tip: 'PROIZVODSTVO', tipDetail: 'ROLL_UP', priority: 50 },
  { pattern: 'поп-ап', matchType: 'substring', tip: 'PROIZVODSTVO', tipDetail: 'POP_UP', priority: 50 },
  { pattern: 'попап', matchType: 'substring', tip: 'PROIZVODSTVO', tipDetail: 'POP_UP', priority: 50 },
  { pattern: 'промо-стойк', matchType: 'substring', tip: 'PROIZVODSTVO', tipDetail: 'PROMO_STOYKA', priority: 50 },
  { pattern: 'оклейк', matchType: 'substring', tip: 'PLENKA', tipDetail: 'NASHI', priority: 50 },
];

export function seedDefaultTipRules(db) {
  for (const seed of SEED_RULES) {
    const exists = db
      .prepare('SELECT id FROM tip_rules WHERE pattern = ? AND match_type = ? AND tip = ?')
      .get(normalizePattern(seed.pattern), seed.matchType, seed.tip);
    if (exists) continue;
    createTipRule(db, seed);
  }
}

export function migratePodryadBannerToTipRules(db) {
  const podryad = db.prepare('SELECT * FROM podryad_items').all();
  for (const row of podryad) {
    const exists = db
      .prepare('SELECT id FROM tip_rules WHERE pattern = ? AND match_type = ? AND tip = ?')
      .get(row.pattern, row.match_type, 'PODRYAD');
    if (exists) continue;
    db.prepare(
      `INSERT INTO tip_rules (pattern, match_type, tip, tip_detail, priority, source_name, created_at)
       VALUES (?, ?, 'PODRYAD', NULL, 100, ?, ?)`
    ).run(row.pattern, row.match_type, row.source_name, row.created_at);
  }
  const banners = db.prepare('SELECT * FROM banner_items').all();
  for (const row of banners) {
    const exists = db
      .prepare('SELECT id FROM tip_rules WHERE pattern = ? AND match_type = ? AND tip = ?')
      .get(row.pattern, row.match_type, 'BANNERA');
    if (exists) continue;
    db.prepare(
      `INSERT INTO tip_rules (pattern, match_type, tip, tip_detail, priority, source_name, created_at)
       VALUES (?, ?, 'BANNERA', NULL, 100, ?, ?)`
    ).run(row.pattern, row.match_type, row.source_name, row.created_at);
  }
}
```

- [ ] **Step 4: Add table + calls in `migrate.js`**

After `banner_items` create block:

```js
  db.exec(`
    CREATE TABLE IF NOT EXISTS tip_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern TEXT NOT NULL,
      match_type TEXT NOT NULL CHECK (match_type IN ('exact', 'substring')),
      tip TEXT NOT NULL,
      tip_detail TEXT,
      priority INTEGER NOT NULL DEFAULT 100,
      source_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS tip_rules_unique_pattern_tip_detail
    ON tip_rules (
      pattern,
      match_type,
      tip,
      IFNULL(tip_detail, '')
    );
  `);

  // dynamic import avoided — call helpers at bottom of migrate after tables exist:
```

At end of `migrate()` (before `console.log`), import statically at top of file:

```js
import { migratePodryadBannerToTipRules, seedDefaultTipRules } from '../services/tip-rules.js';
// ...
migratePodryadBannerToTipRules(db);
seedDefaultTipRules(db);
```

Watch circular imports: `tip-rules.js` must not import `migrate.js`. If migrate import cycles, inline SQL migrate in `migrate.js` and keep seed/create in tip-rules only.

- [ ] **Step 5: Run tests — PASS**

```bash
cd backend && npm test -- tip-rules-db.test.js tip-rules-match.test.js tip-taxonomy.test.js
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/tip-rules.js backend/src/db/migrate.js backend/tests/tip-rules-db.test.js
git commit -m "feat(tip-rules): sqlite table, migration from podryad/banner, seeds"
```

---

### Task 4: Apply rules in `buildLineItemFields`

**Files:**
- Modify: `backend/src/services/twenty-line-item.js`
- Modify: `backend/tests/twenty-line-item.test.js`

**Interfaces:**
- Consumes: `findTipRuleMatch`, `resolveTipDetail`
- `buildLineItemFields(item, options)` options gain `tipRules = []` (keep unused podryad/banner args temporarily or remove after Task 5)

- [ ] **Step 1: Update / add tests**

Replace PODRYAD/BANNERA list-based cases with tipRules:

```js
it('sets tip+tipDetail from tipRules match', () => {
  const input = buildLineItemCreateInput(
    { name: 'Клише герб', quantity_num: 1, quantity: '1' },
    'wh',
    'opp',
    'first',
    {
      tipRules: [
        { pattern: 'клише', matchType: 'substring', tip: 'PODRYAD', tipDetail: 'KUVALDIN_KLISHE', priority: 50 },
      ],
    }
  );
  expect(input.tip).toBe('PODRYAD');
  expect(input.tipDetail).toBe('KUVALDIN_KLISHE');
});

it('defaults BANNERA tipDetail to KTO_EDET', () => {
  const input = buildLineItemCreateInput(
    { name: 'Баннер 3x6', quantity_num: 1, quantity: '1' },
    'wh',
    'opp',
    'first',
    {
      tipRules: [{ pattern: 'баннер', matchType: 'substring', tip: 'BANNERA', tipDetail: null, priority: 100 }],
    }
  );
  expect(input.tip).toBe('BANNERA');
  expect(input.tipDetail).toBe('KTO_EDET');
});

it('omits tip fields when no rule matches', () => {
  const input = buildLineItemCreateInput(
    { name: 'Скотч', quantity_num: 1, quantity: '1' },
    'wh',
    'opp',
    'first',
    { tipRules: [] }
  );
  expect(input.tip).toBeUndefined();
  expect(input.tipDetail).toBeUndefined();
});
```

- [ ] **Step 2: Run — FAIL on old expectations / missing tipDetail**

```bash
cd backend && npm test -- twenty-line-item.test.js
```

- [ ] **Step 3: Implement in `twenty-line-item.js`**

```js
import { findTipRuleMatch } from './tip-rules.js';
import { resolveTipDetail } from './tip-taxonomy.js';

function buildLineItemFields(item, options = {}) {
  const { deal = null, restorationList = [], tipRules = [] } = options;
  // ... existing qty/amount/comment ...

  const match = findTipRuleMatch(item.name, tipRules);
  if (match) {
    fields.tip = match.tip;
    const detail = resolveTipDetail(match);
    if (detail) fields.tipDetail = detail;
  }

  return fields;
}
```

Remove `isPodryadItem` / `isBannerItem` usage from this file.

- [ ] **Step 4: Run — PASS**

```bash
cd backend && npm test -- twenty-line-item.test.js
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/twenty-line-item.js backend/tests/twenty-line-item.test.js
git commit -m "feat(tip-rules): write tip and tipDetail on Twenty line-item sync"
```

---

### Task 5: Wire sync + enrich callers

**Files:**
- Modify: `backend/src/services/twenty-sync.js`
- Modify: `backend/src/services/twenty-line-items-sync.js`
- Modify: `backend/src/services/twenty-items.js`
- Modify: `backend/src/services/twenty-line-item-api.js`
- Modify: `backend/src/routes/deals.js` (enrichDealItems call sites)

**Interfaces:**
- Replace `loadPodryadList`/`loadBannerList` with `loadTipRules(db)`
- Pass `{ tipRules }` into sync helpers
- `enrichDealItems(..., tipRules)` sets:
  - `tipRuleMatch: Boolean`
  - `tipRuleMatchEntry: { id, pattern, matchType, tip, tipDetail } | null`
  - Keep `podryadMatch` / `bannerMatch` as derived booleans for UI compat:  
    `podryadMatch = tip === 'PODRYAD'`, `bannerMatch = tip === 'BANNERA'`

- [ ] **Step 1: Update `enrichDealItems`**

```js
import { findTipRuleMatch } from './tip-rules.js';

export function enrichDealItems(items, blacklist = [], restorationList = [], deal = null, tipRules = []) {
  // ...
  const tipHit = findTipRuleMatch(item.name, tipRules);
  return {
    ...item,
    // blacklist/restoration unchanged
    tipRuleMatch: Boolean(tipHit),
    tipRuleMatchEntry: tipHit
      ? { id: tipHit.id, pattern: tipHit.pattern, matchType: tipHit.matchType, tip: tipHit.tip, tipDetail: tipHit.tipDetail }
      : null,
    podryadMatch: tipHit?.tip === 'PODRYAD',
    bannerMatch: tipHit?.tip === 'BANNERA',
    // drop podryadMatchEntry/bannerMatchEntry or map from tipHit
  };
}
```

- [ ] **Step 2: Update sync loaders**

In `twenty-sync.js` (both places that load lists):

```js
import { loadTipRules, findTipRuleMatch } from './tip-rules.js';
const tipRules = loadTipRules(db);
// pass tipRules into createDealInTwenty / syncLineItems
// for logging flags:
tipRuleMatch: Boolean(findTipRuleMatch(item.name, tipRules)),
```

In `twenty-line-items-sync.js`: replace podryad/banner filters with:

```js
const tipMatched = (tip) => eligibleItems.filter((i) => findTipRuleMatch(i.name, tipRules)?.tip === tip);
```

- [ ] **Step 3: Fix `deals.js` enrich call**

```js
const tipRules = loadTipRules(db);
const enrichedItems = enrichDealItems(items, blacklist, restorationList, deal, tipRules);
```

- [ ] **Step 4: Run backend tests touching sync/routes**

```bash
cd backend && npm test -- twenty-line-item.test.js tip-rules-db.test.js twenty-routes.test.js
```

Fix breakages from signature changes.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/twenty-sync.js backend/src/services/twenty-line-items-sync.js backend/src/services/twenty-items.js backend/src/services/twenty-line-item-api.js backend/src/routes/deals.js
git commit -m "feat(tip-rules): wire tipRules through Twenty sync and deal enrich"
```

---

### Task 6: HTTP API + legacy adapters

**Files:**
- Create: `backend/src/routes/tip-rules.js`
- Modify: `backend/src/index.js`
- Modify: `backend/src/routes/podryad.js`
- Modify: `backend/src/routes/banner.js`
- Modify: `backend/src/routes/deals.js` (`/:itemId/podryad`, `/:itemId/banner`)
- Test: `backend/tests/tip-rules-routes.test.js` (supertest pattern from `twenty-routes.test.js`)

**Interfaces:**
- `GET /api/tip-rules?tip=`
- `POST /api/tip-rules` body `{ pattern, matchType, tip, tipDetail?, priority?, sourceName? }`
- `DELETE /api/tip-rules/:id`
- Legacy: `GET/POST/DELETE /api/podryad` ↔ tip=`PODRYAD`; `/api/banner` ↔ tip=`BANNERA`

- [ ] **Step 1: Implement `tip-rules.js` router** (clone podryad router; call scheduleListChangeResync)

- [ ] **Step 2: Mount in `index.js`**

```js
import tipRulesRouter from './routes/tip-rules.js';
app.use('/api/tip-rules', tipRulesRouter);
```

- [ ] **Step 3: Rewrite podryad/banner routers as adapters**

```js
// podryad.js
import { loadTipRules, createTipRule, deleteTipRule } from '../services/tip-rules.js';

router.get('/', (req, res) => {
  res.json({ items: loadTipRules(getDb(), 'PODRYAD') });
});
router.post('/', (req, res) => {
  const item = createTipRule(getDb(), { ...req.body, tip: 'PODRYAD' });
  scheduleListChangeResync();
  res.status(201).json({ item });
});
// delete unchanged but deleteTipRule
```

Same for banner with `tip: 'BANNERA'`.

- [ ] **Step 4: Deal item shortcuts**

```js
createTipRule(db, {
  pattern: item.name,
  matchType: 'exact',
  tip: 'PODRYAD', // or BANNERA
  sourceName: item.name,
});
```

- [ ] **Step 5: Route test — POST creates rule, GET filters, DELETE 404**

```bash
cd backend && npm test -- tip-rules-routes.test.js
```

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/tip-rules.js backend/src/routes/podryad.js backend/src/routes/banner.js backend/src/routes/deals.js backend/src/index.js backend/tests/tip-rules-routes.test.js
git commit -m "feat(tip-rules): add REST API and adapt podryad/banner endpoints"
```

---

### Task 7: Settings UI zones

**Files:**
- Modify: `frontend/src/api.js`
- Modify: `frontend/src/pages/Settings.jsx`
- Optionally create: `frontend/src/components/TipRulesSection.jsx` if Settings grows too large

**Interfaces:**
- `useTipRules(tip?)`, `useAddTipRule()`, `useRemoveTipRule()`
- Zones: Подряд, Баннера, Производство, Плёнка, Рест. плёнка

- [ ] **Step 1: Add API hooks**

```js
export function useTipRules(tip) {
  return useQuery({
    queryKey: ['tip-rules', tip ?? 'all'],
    queryFn: () =>
      api.get('/tip-rules', { params: tip ? { tip } : {} }).then((r) => r.data.items),
  });
}

export function useAddTipRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) => api.post('/tip-rules', body).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tip-rules'] });
      qc.invalidateQueries({ queryKey: ['podryad'] });
      qc.invalidateQueries({ queryKey: ['banner'] });
      qc.invalidateQueries({ queryKey: ['deals'] });
    },
  });
}

export function useRemoveTipRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id) => api.delete(`/tip-rules/${id}`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tip-rules'] });
      qc.invalidateQueries({ queryKey: ['podryad'] });
      qc.invalidateQueries({ queryKey: ['banner'] });
      qc.invalidateQueries({ queryKey: ['deals'] });
    },
  });
}
```

- [ ] **Step 2: Replace Подряд/Баннера sections with shared zone renderer**

For each zone config `{ tip, title, description, detailOptions }`:
- chips show `pattern` + matchType + tipDetail label
- add form: textarea patterns, matchType select, tipDetail select (empty = «по умолчанию»), add button using existing `handleAddPatterns` adapted to pass `tip` + `tipDetail`

Hardcode detail options (same values as taxonomy):

```js
const TIP_ZONES = [
  { tip: 'PODRYAD', title: 'Подряд', details: [/* … */] },
  { tip: 'BANNERA', title: 'Баннера', details: [/* … */] },
  { tip: 'PROIZVODSTVO', title: 'Производство', details: [/* … */] },
  { tip: 'PLENKA', title: 'Плёнка', details: [/* … */] },
  { tip: 'RESTAVRACIYA', title: 'Рест. плёнка', details: [/* … */] },
];
```

Keep branding / blacklist / restoration sections unchanged.

- [ ] **Step 3: Build frontend into public**

```bash
cd backend && npm run build:public
```

- [ ] **Step 4: Manual smoke**
  1. Open Settings → Парсинг
  2. Add `тестоклейка` substring under Плёнка
  3. Confirm chip appears; restart backend if needed so migrate ran
  4. Resync a deal containing that name → Twenty shows tip PLENKA + NASHI

- [ ] **Step 5: Commit**

```bash
git add frontend/src/api.js frontend/src/pages/Settings.jsx backend/public
git commit -m "feat(tip-rules): Settings zones for tip and tipDetail rules"
```

---

### Task 8: Full test suite + cleanup notes

- [ ] **Step 1: Run full backend tests**

```bash
cd backend && npm test
```

Fix any remaining podryadList/bannerList signature breakages.

- [ ] **Step 2: Leave legacy tables in place** (do not DROP in this plan). Optional follow-up: remove unused `podryad.js`/`banner.js` matchers once no imports remain.

- [ ] **Step 3: Commit any fixes**

```bash
git commit -m "test(tip-rules): fix remaining sync callers after tipRules rollout"
```

---

## Spec coverage checklist

| Spec item | Task |
|-----------|------|
| `tip_rules` table + unique | 3 |
| Migrate podryad/banner | 3 |
| Seeds (клише, сукно, ролл-ап, оклейк, …) | 3 |
| Priority matcher | 2 |
| Always overwrite on match | 4 |
| No-touch on no match | 4 |
| Defaults PLENKA/BANNERA | 1, 4 |
| Validate tipDetail | 1, 3 |
| Settings zones | 7 |
| REST API | 6 |
| Legacy adapters | 6 |
| Wire sync | 5 |
| Blacklist/restoration untouched | — (not modified) |
| TwentyView tip-from-name untouched | — |

## Placeholder / consistency review

- Entry field names: API/UI use camelCase `matchType`/`tipDetail`; DB `match_type`/`tip_detail`; `mapRow` bridges them.
- `resolveTipDetail` returns `null` = omit field (not SQL NULL clear).
- Unique index uses `IFNULL(tip_detail,'')` so SQLite treats empty detail as one slot per pattern+tip.
