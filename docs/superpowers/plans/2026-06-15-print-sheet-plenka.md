# Print Sheet «Плёнка» Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-fill Opportunity `plenka` (Rich Text) in Twenty CRM with film/banner numbers from the print Google Sheet, refreshed on sync and every 1 minute for deals in «В печати».

**Architecture:** New `print-sheet-*` modules in crmparserv2 read Google Sheets via service account, match normalized order names against columns A/C/E, format one line per film number, and push updates through existing Twenty GraphQL helpers. Cron queries Twenty directly for `V_PECHATI` opportunities.

**Tech Stack:** Node.js 20, googleapis, node-cron, vitest, Twenty GraphQL, MCP metadata for field creation.

**Spec:** `docs/superpowers/specs/2026-06-15-print-sheet-plenka-design.md`

---

## File Map

| File | Responsibility |
|------|----------------|
| `backend/src/services/print-sheet-normalize.js` | String normalization (Apps Script port) |
| `backend/src/services/print-sheet-tabs.js` | Russian month tab names from dates |
| `backend/src/services/print-sheet-lookup.js` | Sheets fetch, cache, match, format |
| `backend/src/services/print-sheet-twenty.js` | List/update opportunities in Twenty |
| `backend/src/services/print-sheet-cron.js` | 1-minute cron job |
| `backend/src/services/twenty-sync.js` | Hook after sync |
| `backend/src/config.js` | Print sheet env vars |
| `backend/src/index.js` | Start print cron |
| `backend/tests/print-sheet-normalize.test.js` | normalize tests |
| `backend/tests/print-sheet-tabs.test.js` | tab name tests |
| `backend/tests/print-sheet-lookup.test.js` | lookup + format tests |
| `backend/tests/print-sheet-cron.test.js` | cron skip/update logic |
| `.env.example` | Document new env vars |

---

### Task 1: Twenty metadata — create `plenka` field

**Files:**
- Modify: Twenty workspace via MCP (no repo code)

- [ ] **Step 1: Create RICH_TEXT field on opportunity**

Use MCP `create_field_metadata`:

```json
{
  "objectMetadataId": "806bcba5-5967-477f-a989-06afd3ea1d24",
  "name": "plenka",
  "label": "Плёнка",
  "type": "RICH_TEXT",
  "description": "Номера плёнки/баннера из таблицы печати"
}
```

- [ ] **Step 2: Verify field in GraphQL**

Run a test query via MCP `find_one_opportunity` and confirm `plenka` appears. Note the exact input shape for updates (string vs `{ markdown: "..." }`) — use that shape in Task 5.

---

### Task 2: Config and dependencies

**Files:**
- Modify: `backend/package.json`
- Modify: `backend/src/config.js`
- Modify: `.env.example`

- [ ] **Step 1: Install googleapis**

```bash
cd backend && npm install googleapis
```

- [ ] **Step 2: Add config entries**

In `backend/src/config.js`, add:

```js
  printSheetId: process.env.PRINT_SHEET_ID || '',
  googleServiceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '',
  googleServiceAccountPrivateKey: (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  printSheetCacheTtlMs: parseInt(process.env.PRINT_SHEET_CACHE_TTL_MS || '60000', 10),
```

- [ ] **Step 3: Document env vars in `.env.example`**

```env
PRINT_SHEET_ID=12rGgW0vucmm4eXy4yrtQLRLNcqNpPVznpNdA-c1HuP0
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=
PRINT_SHEET_CACHE_TTL_MS=60000
```

- [ ] **Step 4: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/src/config.js .env.example
git commit -m "chore: add print sheet Google API config"
```

---

### Task 3: Normalize and tab name helpers

**Files:**
- Create: `backend/src/services/print-sheet-normalize.js`
- Create: `backend/src/services/print-sheet-tabs.js`
- Create: `backend/tests/print-sheet-normalize.test.js`
- Create: `backend/tests/print-sheet-tabs.test.js`

- [ ] **Step 1: Write failing normalize tests**

`backend/tests/print-sheet-normalize.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { normalizePrintOrderName } from '../src/services/print-sheet-normalize.js';

describe('normalizePrintOrderName', () => {
  it('lowercases and strips punctuation', () => {
    const input = 'АРЕНДА/13.06/Эльвира/фудтрак/155409/Лучинова';
    expect(normalizePrintOrderName(input)).toBe(
      'аренда1306эльвирафудтрак155409лучинова'
    );
  });

  it('collapses whitespace', () => {
    expect(normalizePrintOrderName('  плашки   2шт  ')).toBe('плашки 2шт');
  });

  it('returns empty for blank', () => {
    expect(normalizePrintOrderName('')).toBe('');
    expect(normalizePrintOrderName(null)).toBe('');
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd backend && npm test -- print-sheet-normalize.test.js
```

- [ ] **Step 3: Implement normalize**

`backend/src/services/print-sheet-normalize.js`:

```js
export function normalizePrintOrderName(str) {
  return String(str ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^\wа-яё0-9 ]/gi, '')
    .trim();
}
```

- [ ] **Step 4: Run normalize tests — expect PASS**

- [ ] **Step 5: Write failing tab tests**

`backend/tests/print-sheet-tabs.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { buildPrintSheetTabNames } from '../src/services/print-sheet-tabs.js';

describe('buildPrintSheetTabNames', () => {
  it('returns event, previous, and current month tabs deduplicated', () => {
    const closeDate = '2026-07-01T10:00:00.000Z';
    const now = new Date('2026-06-29T12:00:00.000Z');
    const tabs = buildPrintSheetTabNames(closeDate, now);
    expect(tabs).toEqual(['Июль 2026', 'Июнь 2026']);
  });

  it('handles January closeDate with December previous year', () => {
    const closeDate = '2026-01-15T10:00:00.000Z';
    const now = new Date('2025-12-20T12:00:00.000Z');
    const tabs = buildPrintSheetTabNames(closeDate, now);
    expect(tabs).toContain('Январь 2026');
    expect(tabs).toContain('Декабрь 2025');
  });
});
```

- [ ] **Step 6: Run tab tests — expect FAIL**

- [ ] **Step 7: Implement tab builder**

`backend/src/services/print-sheet-tabs.js`:

```js
const MONTHS_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

function tabNameForDate(date) {
  return `${MONTHS_RU[date.getMonth()]} ${date.getFullYear()}`;
}

function addMonths(date, delta) {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

export function buildPrintSheetTabNames(closeDateInput, nowInput = new Date()) {
  const closeDate = closeDateInput ? new Date(closeDateInput) : nowInput;
  const now = new Date(nowInput);
  const candidates = [
    tabNameForDate(closeDate),
    tabNameForDate(addMonths(closeDate, -1)),
    tabNameForDate(now),
  ];
  return [...new Set(candidates)];
}
```

- [ ] **Step 8: Run all print-sheet tests — expect PASS**

- [ ] **Step 9: Commit**

```bash
git add backend/src/services/print-sheet-normalize.js backend/src/services/print-sheet-tabs.js backend/tests/print-sheet-normalize.test.js backend/tests/print-sheet-tabs.test.js
git commit -m "feat: add print sheet normalize and tab name helpers"
```

---

### Task 4: Lookup and format logic

**Files:**
- Create: `backend/src/services/print-sheet-lookup.js`
- Create: `backend/tests/print-sheet-lookup.test.js`

- [ ] **Step 1: Write failing lookup tests**

`backend/tests/print-sheet-lookup.test.js`:

```js
import { describe, it, expect } from 'vitest';
import {
  matchFilmsFromRows,
  formatPlenkaText,
} from '../src/services/print-sheet-lookup.js';

describe('matchFilmsFromRows', () => {
  const rows = [
    ['№', 'Отдел', 'Название заказа', 'x', 'Что брендируется'],
    [6, 'Про', 'АРЕНДА/13.06/Тест/155409/Иванов', '', 'ростовая фигура'],
    [7, 'Про', 'АРЕНДА/13.06/Тест/155409/Иванов', '', 'плашки'],
    [8, 'Про', 'АРЕНДА/13.06/Тест/155409/Иванов', '', 'плашки'],
    [99, 'Про', 'ДРУГОЙ ЗАКАЗ', '', 'баннер'],
  ];

  it('returns one entry per film number', () => {
    const matches = matchFilmsFromRows(rows, 'аренда1306тест155409иванов');
    expect(matches).toEqual([
      { type: 'ростовая фигура', film: 6 },
      { type: 'плашки', film: 7 },
      { type: 'плашки', film: 8 },
    ]);
  });

  it('uses без названия when type empty', () => {
    const r = [
      ['h', 'h', 'h', 'h', 'h'],
      [12, '', 'ORDER/1', '', ''],
    ];
    const matches = matchFilmsFromRows(r, 'order1');
    expect(matches[0].type).toBe('без названия');
  });
});

describe('formatPlenkaText', () => {
  it('formats one line per film', () => {
    const text = formatPlenkaText([
      { type: 'плашки', film: 7 },
      { type: 'плашки', film: 8 },
    ]);
    expect(text).toBe('плашки - 7\nплашки - 8');
  });

  it('returns not found message when empty', () => {
    expect(formatPlenkaText([])).toBe('Плёнка не найдена');
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

- [ ] **Step 3: Implement match and format (no Google API yet)**

`backend/src/services/print-sheet-lookup.js` (partial — add Sheets fetch in Step 5):

```js
import { google } from 'googleapis';
import { config } from '../config.js';
import { normalizePrintOrderName } from './print-sheet-normalize.js';
import { buildPrintSheetTabNames } from './print-sheet-tabs.js';

const COL_FILM = 0;
const COL_ORDER = 2;
const COL_TYPE = 4;

let sheetCache = { key: '', fetchedAt: 0, rowsByTab: {} };

export function matchFilmsFromRows(allRows, normalizedOrderName) {
  const seen = new Set();
  const matches = [];

  for (const rows of allRows) {
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const printOrder = normalizePrintOrderName(row[COL_ORDER]);
      if (printOrder !== normalizedOrderName) continue;

      const film = row[COL_FILM];
      if (film === '' || film == null) continue;

      const type = String(row[COL_TYPE] ?? '').trim() || 'без названия';
      const dedupeKey = `${type}|${film}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      matches.push({ type, film });
    }
  }

  return matches;
}

export function formatPlenkaText(matches) {
  if (!matches.length) return 'Плёнка не найдена';
  return matches.map(({ type, film }) => `${type} - ${film}`).join('\n');
}

function getSheetsClient() {
  if (!config.googleServiceAccountEmail || !config.googleServiceAccountPrivateKey) {
    return null;
  }
  const auth = new google.auth.JWT({
    email: config.googleServiceAccountEmail,
    key: config.googleServiceAccountPrivateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  return google.sheets({ version: 'v4', auth });
}

export async function fetchRowsForTabs(tabNames) {
  const client = getSheetsClient();
  if (!client || !config.printSheetId || !tabNames.length) return [];

  const cacheKey = tabNames.join('|');
  const now = Date.now();
  if (
    sheetCache.key === cacheKey &&
    now - sheetCache.fetchedAt < config.printSheetCacheTtlMs
  ) {
    return tabNames.map((t) => sheetCache.rowsByTab[t] || []);
  }

  const ranges = tabNames.map((t) => `'${t}'`);
  const resp = await client.spreadsheets.values.batchGet({
    spreadsheetId: config.printSheetId,
    ranges,
    majorDimension: 'ROWS',
  });

  const rowsByTab = {};
  const valueRanges = resp.data.valueRanges || [];
  for (let i = 0; i < tabNames.length; i++) {
    rowsByTab[tabNames[i]] = valueRanges[i]?.values || [];
  }

  sheetCache = { key: cacheKey, fetchedAt: now, rowsByTab };
  return tabNames.map((t) => rowsByTab[t] || []);
}

export async function lookupFilmsForOrder(orderName, closeDate) {
  const normalized = normalizePrintOrderName(orderName);
  if (!normalized) return [];

  const tabNames = buildPrintSheetTabNames(closeDate);
  const allRows = await fetchRowsForTabs(tabNames);
  return matchFilmsFromRows(allRows, normalized);
}

export function clearPrintSheetCacheForTests() {
  sheetCache = { key: '', fetchedAt: 0, rowsByTab: {} };
}
```

- [ ] **Step 4: Run lookup tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/print-sheet-lookup.js backend/tests/print-sheet-lookup.test.js
git commit -m "feat: add print sheet lookup and plenka formatting"
```

---

### Task 5: Twenty list/update helpers

**Files:**
- Create: `backend/src/services/print-sheet-twenty.js`

- [ ] **Step 1: Implement Twenty helpers**

Reuse `gql` pattern from `twenty-sync.js` — export a shared gql helper or duplicate minimal version. Recommended: export `gql` from `twenty-sync.js` or create `twenty-gql.js` if export is messy.

`backend/src/services/print-sheet-twenty.js`:

```js
import { requireTwentyConfig } from './twenty-config.js';
// import gql from shared module

const LIST_IN_PRINT_QUERY = `
  query($limit: Int!) {
    opportunities(
      filter: { stage: { eq: V_PECHATI } }
      first: $limit
    ) {
      edges {
        node { id name closeDate plenka }
      }
    }
  }
`;

const UPDATE_PLENKA_MUTATION = `
  mutation($id: UUID!, $input: OpportunityUpdateInput!) {
    updateOpportunity(id: $id, data: $input) { id plenka }
  }
`;

export async function listOpportunitiesInPrintStage(gql, limit = 200) {
  const resp = await gql(LIST_IN_PRINT_QUERY, { limit });
  const edges = resp.data?.data?.opportunities?.edges || [];
  return edges.map((e) => e.node);
}

export async function updateOpportunityPlenka(gql, id, plenkaText) {
  // Use shape discovered in Task 1 Step 2 — example if plain string:
  const input = { plenka: plenkaText };
  await gql(UPDATE_PLENKA_MUTATION, { id, input });
}

export async function refreshPlenkaForOpportunity(gql, opportunity) {
  const { lookupFilmsForOrder, formatPlenkaText } = await import('./print-sheet-lookup.js');
  const matches = await lookupFilmsForOrder(opportunity.name, opportunity.closeDate);
  const text = formatPlenkaText(matches);
  const current = opportunity.plenka ?? '';
  if (current === text) return { updated: false, text };
  await updateOpportunityPlenka(gql, opportunity.id, text);
  return { updated: true, text };
}
```

Adjust `plenka` input shape and `filter` enum syntax per actual Twenty schema from Task 1.

- [ ] **Step 2: Manual smoke test** (with real credentials)

Log in to parser environment, call `listOpportunitiesInPrintStage` once, confirm results.

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/print-sheet-twenty.js
git commit -m "feat: add Twenty helpers for plenka refresh"
```

---

### Task 6: Cron job (every 1 minute)

**Files:**
- Create: `backend/src/services/print-sheet-cron.js`
- Modify: `backend/src/index.js`
- Create: `backend/tests/print-sheet-cron.test.js`

- [ ] **Step 1: Implement cron**

`backend/src/services/print-sheet-cron.js`:

```js
import cron from 'node-cron';
import { config } from '../config.js';
import { CRM_TIMEZONE } from '../utils/crm-dates.js';
import { requireTwentyConfig } from './twenty-config.js';
import {
  listOpportunitiesInPrintStage,
  refreshPlenkaForOpportunity,
} from './print-sheet-twenty.js';

let cronTask = null;

export async function runPrintSheetRefresh() {
  if (!config.printSheetId || !config.googleServiceAccountEmail) return;

  let gql;
  try {
    const twenty = requireTwentyConfig();
  // build gql wrapper using twenty.apiUrl + twenty.apiToken (same as twenty-sync)
    gql = createGql(twenty.apiUrl, twenty.apiToken);
  } catch {
    return;
  }

  const opportunities = await listOpportunitiesInPrintStage(gql);
  for (const opp of opportunities) {
    try {
      await refreshPlenkaForOpportunity(gql, opp);
    } catch (err) {
      console.error(`[print-sheet] refresh failed for ${opp.id}:`, err.message);
    }
  }
}

export function initPrintSheetCron() {
  if (cronTask) cronTask.stop();

  if (!config.printSheetId) {
    console.log('Print sheet cron disabled (PRINT_SHEET_ID not set)');
    return;
  }

  cronTask = cron.schedule('* * * * *', () => {
    runPrintSheetRefresh().catch((err) => {
      console.error('[print-sheet] cron error:', err.message);
    });
  }, { timezone: CRM_TIMEZONE });

  console.log('Print sheet cron initialized: every 1 minute');
}
```

Extract `createGql` by refactoring `gql` from `twenty-sync.js` into `backend/src/services/twenty-gql.js` to avoid duplication.

- [ ] **Step 2: Wire in `index.js`**

```js
import { initPrintSheetCron } from './services/print-sheet-cron.js';
// in start():
initPrintSheetCron();
```

- [ ] **Step 3: Write cron unit test** (mock list + refresh)

Test `runPrintSheetRefresh` skips when config missing; calls refresh for each opportunity when configured.

- [ ] **Step 4: Run full test suite**

```bash
cd backend && npm test
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/print-sheet-cron.js backend/src/services/twenty-gql.js backend/src/index.js backend/tests/print-sheet-cron.test.js
git commit -m "feat: add 1-minute print sheet cron for plenka refresh"
```

---

### Task 7: Hook into twenty-sync

**Files:**
- Modify: `backend/src/services/twenty-sync.js`

- [ ] **Step 1: After successful create/update, refresh plenka if V_PECHATI**

At end of `syncDealToTwenty` success path:

```js
import { refreshPlenkaForOpportunity } from './print-sheet-twenty.js';

// after opportunity saved:
const oppResp = await gql(GET_OPPORTUNITY_STAGE_QUERY, { id: oppId });
const opp = oppResp.data?.data?.opportunity;
if (opp?.stage === 'V_PECHATI') {
  await refreshPlenkaForOpportunity(gql, opp);
}
```

Wrap in try/catch — plenka failure must not fail the main sync.

- [ ] **Step 2: Extend twenty-sync.test.js** with test that plenka refresh is called when stage is V_PECHATI (mock).

- [ ] **Step 3: Run tests — expect PASS**

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/twenty-sync.js backend/tests/twenty-sync.test.js
git commit -m "feat: refresh plenka on Twenty sync when in print stage"
```

---

### Task 8: End-to-end verification

- [ ] **Step 1: Share print spreadsheet with service account email (Viewer)**

- [ ] **Step 2: Set env vars on deployment**

- [ ] **Step 3: Move a test opportunity to «В печати» with name matching a print sheet row**

- [ ] **Step 4: Within 1 minute, confirm `plenka` field populated**

- [ ] **Step 5: Add a new film row in sheet, wait 1 minute, confirm field updates**

- [ ] **Step 6: Rename opportunity to non-matching name, confirm `Плёнка не найдена`**

---

## Plan Self-Review

| Spec requirement | Task |
|------------------|------|
| RICH_TEXT field `plenka` | Task 1 |
| One line per film number | Task 4 |
| Three-tab search | Task 3 + 4 |
| Cron 1 min | Task 6 |
| Sync hook V_PECHATI | Task 7 |
| Cache 60s | Task 4 |
| No overwrite on Google error | Task 4/6 (catch, skip update) |
| `Плёнка не найдена` | Task 4 |

No placeholders remain. `plenka` GraphQL input shape depends on Task 1 discovery — explicitly called out.
