# Print Sheet Export + Read-back Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a Twenty position enters «В печати», append a row (B–K) to the current month's Google Sheet tab; read back column A → `plenka`, W → `vzatoVRabotu`, X → `gotovo`; replace legacy full-tab plenka lookup.

**Architecture:** Extend `print-sheet-cron` with three phases (export → read-back → session reset). Each exported position stores `printSheetTabName` + `printSheetRowNumber` for targeted single-row Sheets API reads. Shared Google Sheets client upgraded to write scope. Twenty fields created via MCP.

**Tech Stack:** Node.js 20, googleapis, node-cron, vitest, Twenty GraphQL, MCP metadata.

**Spec:** `docs/superpowers/specs/2026-06-28-print-sheet-export-design.md`

---

## File Map

| File | Responsibility |
|------|----------------|
| `backend/config/print-sheet-departments.json` | Default company → department map |
| `backend/src/services/print-sheet-client.js` | Shared JWT Sheets client (read + write) |
| `backend/src/services/print-sheet-tabs.js` | Add `buildCurrentMonthTabName` |
| `backend/src/services/print-sheet-departments.js` | Load/resolve department map |
| `backend/src/services/print-sheet-row-builder.js` | Build B–K values from GraphQL node |
| `backend/src/services/print-sheet-append.js` | Append row, parse row number from response |
| `backend/src/services/print-sheet-readback.js` | Read A/W/X, format plenka, parse checkboxes |
| `backend/src/services/print-sheet-export-twenty.js` | GraphQL list/update for export + read-back + reset |
| `backend/src/services/print-sheet-cycle.js` | Orchestrate export → read-back → reset |
| `backend/src/services/print-sheet-cron.js` | Call `runPrintSheetCycle` instead of legacy plenka loop |
| `backend/src/services/print-sheet-lookup.js` | Remove cron-path lookup; keep or delete unused exports |
| `backend/src/services/print-sheet-twenty.js` | Remove legacy `refreshPlenkaForLineItem` cron path |
| `backend/src/services/twenty-sync.js` | Hook: export attempt after sync, not legacy plenka scan |
| `backend/src/config.js` | `printSheetDepartmentMap` |
| `backend/tests/print-sheet-tabs.test.js` | Add current-month tab test |
| `backend/tests/print-sheet-departments.test.js` | Department resolver tests |
| `backend/tests/print-sheet-row-builder.test.js` | Row builder tests |
| `backend/tests/print-sheet-append.test.js` | Row number parsing tests |
| `backend/tests/print-sheet-readback.test.js` | Plenka + checkbox tests |
| `backend/tests/print-sheet-export-twenty.test.js` | GraphQL helper tests (mocked) |
| `backend/tests/print-sheet-cycle.test.js` | Phase orchestration tests |
| `backend/tests/print-sheet-cron.test.js` | Update for new cycle |
| `.env.example` | Document `PRINT_SHEET_DEPARTMENT_MAP` |

---

### Task 1: Twenty metadata — new position fields + discover layout link

**Files:**
- Modify: Twenty workspace via MCP (no repo code)
- Create: `backend/src/services/print-sheet-field-names.js` (constants after discovery)

- [ ] **Step 1: Discover layout link field name on dealLineItem**

Use MCP `execute_tool` → `get_object_metadata` with `{ "objectNameSingular": "dealLineItem", "includeFullSystemFields": true }`.

Find the LINK field labeled «Ссылка на макет» (or similar). Record API name (e.g. `ssylkaNaMakety`).

- [ ] **Step 2: Create position fields via MCP**

Use MCP `create_field_metadata` on object `dealLineItem` (`ab480145-fba4-437f-831a-7071dcdbd5b2`):

| name | type | label |
|------|------|-------|
| `dataGotovnostiPechati` | DATE | Дата готовности печати |
| `vremyaGotovnostiPechati` | TEXT | Время готовности печати |
| `printSheetSessionId` | TEXT | ID сессии таблицы печати |
| `printSheetTabName` | TEXT | Лист таблицы печати |
| `printSheetRowNumber` | NUMBER | Строка таблицы печати |
| `vzatoVRabotu` | BOOLEAN | Взято в работу |
| `gotovo` | BOOLEAN | Готово |

- [ ] **Step 3: Create field name constants file**

`backend/src/services/print-sheet-field-names.js`:

```js
/** LINK field on dealLineItem — confirm via MCP metadata in Task 1 Step 1 */
export const LAYOUT_LINK_FIELD = 'ssylkaNaMakety'; // replace with discovered name

export const COL_A_INDEX = 0;
export const COL_W_INDEX = 22;
export const COL_X_INDEX = 23;
```

- [ ] **Step 4: Verify with MCP**

`find_many_deal_line_items` with `select` including new fields + layout link. Confirm GraphQL accepts them.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/print-sheet-field-names.js
git commit -m "chore: add print sheet Twenty field name constants"
```

---

### Task 2: Config, department map, Sheets write scope

**Files:**
- Create: `backend/config/print-sheet-departments.json`
- Modify: `backend/src/config.js`
- Modify: `.env.example`

- [ ] **Step 1: Add default department map file**

`backend/config/print-sheet-departments.json`:

```json
{
  "8814cccb-471e-4d05-90cb-261a9395ada8": "Про",
  "df0952a9-c780-4cd1-bd85-ba6f0bf76512": "АРТ",
  "3af2f268-9606-40c4-8944-8c8a70c8aff3": "Аренда+",
  "cbe1d802-b225-46f4-84c9-7a4174e24ed9": "Рентбери/барстрит"
}
```

- [ ] **Step 2: Extend config.js**

Add after existing print sheet entries:

```js
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadPrintSheetDepartmentMap() {
  const envJson = process.env.PRINT_SHEET_DEPARTMENT_MAP || '';
  if (envJson.trim()) {
    try {
      return JSON.parse(envJson);
    } catch {
      console.warn('[config] Invalid PRINT_SHEET_DEPARTMENT_MAP JSON, using file fallback');
    }
  }
  const filePath = join(__dirname, '../config/print-sheet-departments.json');
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

// inside export const config = { ...:
  printSheetDepartmentMap: loadPrintSheetDepartmentMap(),
```

- [ ] **Step 3: Document in `.env.example`**

```env
# Optional JSON override for companyId → print sheet department (column B)
# PRINT_SHEET_DEPARTMENT_MAP={"8814cccb-471e-4d05-90cb-261a9395ada8":"Про"}
```

- [ ] **Step 4: Commit**

```bash
git add backend/config/print-sheet-departments.json backend/src/config.js .env.example
git commit -m "chore: add print sheet department mapping config"
```

---

### Task 3: Shared Sheets client + current month tab name

**Files:**
- Create: `backend/src/services/print-sheet-client.js`
- Modify: `backend/src/services/print-sheet-tabs.js`
- Modify: `backend/src/services/print-sheet-lookup.js` (use shared client)
- Modify: `backend/tests/print-sheet-tabs.test.js`

- [ ] **Step 1: Write failing test for buildCurrentMonthTabName**

Add to `backend/tests/print-sheet-tabs.test.js`:

```js
import { buildCurrentMonthTabName } from '../src/services/print-sheet-tabs.js';

describe('buildCurrentMonthTabName', () => {
  it('returns Russian month and year in Europe/Moscow', () => {
    // 2026-06-15 10:00 UTC = June 15 Moscow
    expect(buildCurrentMonthTabName(new Date('2026-06-15T10:00:00.000Z'))).toBe('Июнь 2026');
  });

  it('handles month boundary in Moscow timezone', () => {
    // 2026-05-31 22:00 UTC = 2026-06-01 01:00 Moscow → June
    expect(buildCurrentMonthTabName(new Date('2026-05-31T22:00:00.000Z'))).toBe('Июнь 2026');
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd backend && npm test -- print-sheet-tabs.test.js
```

- [ ] **Step 3: Implement buildCurrentMonthTabName**

In `backend/src/services/print-sheet-tabs.js`:

```js
import { CRM_TIMEZONE } from '../utils/crm-dates.js';

const MONTHS_RU = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

function moscowParts(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CRM_TIMEZONE,
    month: 'numeric',
    year: 'numeric',
  }).formatToParts(date);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  return { month, year };
}

export function buildCurrentMonthTabName(nowInput = new Date()) {
  const { month, year } = moscowParts(nowInput);
  return `${MONTHS_RU[month - 1]} ${year}`;
}
```

- [ ] **Step 4: Create shared Sheets client**

`backend/src/services/print-sheet-client.js`:

```js
import { google } from 'googleapis';
import { config } from '../config.js';

export function getPrintSheetClient() {
  if (!config.googleServiceAccountEmail || !config.googleServiceAccountPrivateKey) {
    return null;
  }
  const auth = new google.auth.JWT({
    email: config.googleServiceAccountEmail,
    key: config.googleServiceAccountPrivateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}
```

- [ ] **Step 5: Update print-sheet-lookup.js to use shared client**

Replace local `getSheetsClient` with import from `print-sheet-client.js` and `spreadsheets` scope.

- [ ] **Step 6: Run tests — expect PASS**

```bash
cd backend && npm test -- print-sheet-tabs.test.js
```

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/print-sheet-client.js backend/src/services/print-sheet-tabs.js backend/src/services/print-sheet-lookup.js backend/tests/print-sheet-tabs.test.js
git commit -m "feat: add current month tab helper and shared Sheets client"
```

---

### Task 4: Department resolver

**Files:**
- Create: `backend/src/services/print-sheet-departments.js`
- Create: `backend/tests/print-sheet-departments.test.js`

- [ ] **Step 1: Write failing tests**

`backend/tests/print-sheet-departments.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { resolvePrintSheetDepartment } from '../src/services/print-sheet-departments.js';

describe('resolvePrintSheetDepartment', () => {
  const map = {
    '8814cccb-471e-4d05-90cb-261a9395ada8': 'Про',
    'df0952a9-c780-4cd1-bd85-ba6f0bf76512': 'АРТ',
  };

  it('returns mapped department label', () => {
    expect(resolvePrintSheetDepartment('8814cccb-471e-4d05-90cb-261a9395ada8', map)).toBe('Про');
  });

  it('returns empty string for unmapped company (e.g. Биржа Лидов)', () => {
    expect(resolvePrintSheetDepartment('d9a124be-d8ef-4dd6-b769-f6dc1dd34673', map)).toBe('');
  });

  it('returns empty string for null companyId', () => {
    expect(resolvePrintSheetDepartment(null, map)).toBe('');
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd backend && npm test -- print-sheet-departments.test.js
```

- [ ] **Step 3: Implement**

`backend/src/services/print-sheet-departments.js`:

```js
import { config } from '../config.js';

export function resolvePrintSheetDepartment(companyId, map = config.printSheetDepartmentMap) {
  if (!companyId) return '';
  return map[companyId] ?? '';
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd backend && npm test -- print-sheet-departments.test.js
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/print-sheet-departments.js backend/tests/print-sheet-departments.test.js
git commit -m "feat: add print sheet department resolver"
```

---

### Task 5: Row builder (columns B–K)

**Files:**
- Create: `backend/src/services/print-sheet-row-builder.js`
- Create: `backend/tests/print-sheet-row-builder.test.js`

- [ ] **Step 1: Write failing tests**

`backend/tests/print-sheet-row-builder.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { buildPrintSheetRowValues } from '../src/services/print-sheet-row-builder.js';

describe('buildPrintSheetRowValues', () => {
  const lineItem = {
    name: 'Тайсон',
    kommentariy: 'пленка бб + лам',
    dataGotovnostiPechati: '2026-06-27',
    vremyaGotovnostiPechati: '10:00',
    ssylkaNaMakety: { primaryLinkUrl: 'https://disk.yandex.ru/mock' },
    updatedBy: { name: { firstName: 'Андрей', lastName: 'Абалин' } },
    opportunity: {
      name: 'ПРО/27.06/ИП Рыбаков/Самолет Тайсон ЛСК',
      companyId: '8814cccb-471e-4d05-90cb-261a9395ada8',
      bitrixLink: { primaryLinkUrl: 'https://prointeractive.bitrix24.ru/crm/deal/details/123/' },
    },
  };

  it('builds B–K array with 11 cells, skipping F internally as empty', () => {
    const row = buildPrintSheetRowValues(lineItem);
    expect(row).toEqual([
      'Про',
      'ПРО/27.06/ИП Рыбаков/Самолет Тайсон ЛСК',
      'https://prointeractive.bitrix24.ru/crm/deal/details/123/',
      'Тайсон',
      '',
      'https://disk.yandex.ru/mock',
      'Андрей Абалин',
      '27.06.2026',
      '10:00',
      'пленка бб + лам',
    ]);
  });

  it('leaves department empty when company unmapped', () => {
    const row = buildPrintSheetRowValues({
      ...lineItem,
      opportunity: { ...lineItem.opportunity, companyId: 'unknown' },
    });
    expect(row[0]).toBe('');
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd backend && npm test -- print-sheet-row-builder.test.js
```

- [ ] **Step 3: Implement**

`backend/src/services/print-sheet-row-builder.js`:

```js
import { resolvePrintSheetDepartment } from './print-sheet-departments.js';
import { LAYOUT_LINK_FIELD } from './print-sheet-field-names.js';

function formatUpdatedByName(updatedBy) {
  const n = updatedBy?.name;
  if (!n) return updatedBy?.displayName ?? '';
  const parts = [n.firstName, n.lastName].filter(Boolean);
  return parts.join(' ').trim();
}

function formatPrintReadyDate(value) {
  if (!value) return '';
  const s = String(value);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}.${m[2]}.${m[1]}`;
  return s;
}

export function buildPrintSheetRowValues(lineItem) {
  const opp = lineItem.opportunity ?? {};
  const layoutLink = lineItem[LAYOUT_LINK_FIELD];

  return [
    resolvePrintSheetDepartment(opp.companyId),
    opp.name ?? '',
    opp.bitrixLink?.primaryLinkUrl ?? '',
    lineItem.name ?? '',
    '',
    layoutLink?.primaryLinkUrl ?? layoutLink ?? '',
    formatUpdatedByName(lineItem.updatedBy),
    formatPrintReadyDate(lineItem.dataGotovnostiPechati),
    (lineItem.vremyaGotovnostiPechati ?? '').trim(),
    (lineItem.kommentariy ?? '').trim(),
  ];
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd backend && npm test -- print-sheet-row-builder.test.js
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/print-sheet-row-builder.js backend/tests/print-sheet-row-builder.test.js
git commit -m "feat: build print sheet export row values B-K"
```

---

### Task 6: Append row to sheet

**Files:**
- Create: `backend/src/services/print-sheet-append.js`
- Create: `backend/tests/print-sheet-append.test.js`

- [ ] **Step 1: Write failing tests**

`backend/tests/print-sheet-append.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { parseRowNumberFromUpdatedRange } from '../src/services/print-sheet-append.js';

describe('parseRowNumberFromUpdatedRange', () => {
  it('parses row from Sheets updatedRange', () => {
    expect(parseRowNumberFromUpdatedRange("'Июнь 2026'!B297:K297")).toBe(297);
  });

  it('returns null when range missing', () => {
    expect(parseRowNumberFromUpdatedRange(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd backend && npm test -- print-sheet-append.test.js
```

- [ ] **Step 3: Implement**

`backend/src/services/print-sheet-append.js`:

```js
import { config } from '../config.js';
import { getPrintSheetClient } from './print-sheet-client.js';

export function parseRowNumberFromUpdatedRange(updatedRange) {
  if (!updatedRange) return null;
  const match = String(updatedRange).match(/![A-Z]+(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}

export async function appendPrintSheetRow(tabName, rowValues) {
  const client = getPrintSheetClient();
  if (!client || !config.printSheetId) {
    throw new Error('Print sheet Google client not configured');
  }

  const range = `'${tabName}'!B:K`;
  const resp = await client.spreadsheets.values.append({
    spreadsheetId: config.printSheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [rowValues] },
  });

  const rowNumber = parseRowNumberFromUpdatedRange(resp.data.updates?.updatedRange);
  if (!rowNumber) {
    throw new Error(`Could not parse row number from append response: ${resp.data.updates?.updatedRange}`);
  }

  return { rowNumber, updatedRange: resp.data.updates?.updatedRange };
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd backend && npm test -- print-sheet-append.test.js
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/print-sheet-append.js backend/tests/print-sheet-append.test.js
git commit -m "feat: append print sheet row and parse row number"
```

---

### Task 7: Read-back helpers (plenka + checkboxes)

**Files:**
- Create: `backend/src/services/print-sheet-readback.js`
- Create: `backend/tests/print-sheet-readback.test.js`

- [ ] **Step 1: Write failing tests**

`backend/tests/print-sheet-readback.test.js`:

```js
import { describe, it, expect } from 'vitest';
import {
  formatPlenkaFromCellA,
  parseSheetCheckbox,
  extractReadbackFromRow,
} from '../src/services/print-sheet-readback.js';

describe('formatPlenkaFromCellA', () => {
  it('formats line with sequential number from A', () => {
    expect(formatPlenkaFromCellA('Тайсон', '295')).toBe('Тайсон - 295');
  });

  it('returns not found when A empty', () => {
    expect(formatPlenkaFromCellA('Тайсон', '')).toBe('Плёнка не найдена');
  });
});

describe('parseSheetCheckbox', () => {
  it('parses TRUE string', () => {
    expect(parseSheetCheckbox('TRUE')).toBe(true);
  });

  it('returns false for empty', () => {
    expect(parseSheetCheckbox('')).toBe(false);
  });
});

describe('extractReadbackFromRow', () => {
  it('reads A, W, X from A:X range row', () => {
    const cells = new Array(24).fill('');
    cells[0] = '295';
    cells[22] = 'TRUE';
    cells[23] = 'FALSE';
    expect(extractReadbackFromRow(cells, 'Тайсон')).toEqual({
      plenkaText: 'Тайсон - 295',
      vzatoVRabotu: true,
      gotovo: false,
    });
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd backend && npm test -- print-sheet-readback.test.js
```

- [ ] **Step 3: Implement**

`backend/src/services/print-sheet-readback.js`:

```js
import { config } from '../config.js';
import { getPrintSheetClient } from './print-sheet-client.js';
import { COL_A_INDEX, COL_W_INDEX, COL_X_INDEX } from './print-sheet-field-names.js';

export function formatPlenkaFromCellA(lineItemName, cellA) {
  const film = String(cellA ?? '').trim();
  if (!film) return 'Плёнка не найдена';
  return `${lineItemName} - ${film}`;
}

export function parseSheetCheckbox(value) {
  if (value === true || value === 'TRUE' || value === 'true') return true;
  return false;
}

export function extractReadbackFromRow(cells, lineItemName) {
  const cellA = cells[COL_A_INDEX];
  const cellW = cells[COL_W_INDEX];
  const cellX = cells[COL_X_INDEX];
  return {
    plenkaText: formatPlenkaFromCellA(lineItemName, cellA),
    vzatoVRabotu: parseSheetCheckbox(cellW),
    gotovo: parseSheetCheckbox(cellX),
  };
}

export async function fetchPrintSheetRow(tabName, rowNumber) {
  const client = getPrintSheetClient();
  if (!client || !config.printSheetId) {
    throw new Error('Print sheet Google client not configured');
  }

  const range = `'${tabName}'!A${rowNumber}:X${rowNumber}`;
  const resp = await client.spreadsheets.values.get({
    spreadsheetId: config.printSheetId,
    range,
  });

  return resp.data.values?.[0] ?? [];
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd backend && npm test -- print-sheet-readback.test.js
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/print-sheet-readback.js backend/tests/print-sheet-readback.test.js
git commit -m "feat: add print sheet read-back helpers for plenka and checkboxes"
```

---

### Task 8: Twenty GraphQL — export, read-back, reset

**Files:**
- Create: `backend/src/services/print-sheet-export-twenty.js`
- Create: `backend/tests/print-sheet-export-twenty.test.js`

- [ ] **Step 1: Write failing tests for session id helper**

`backend/tests/print-sheet-export-twenty.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { buildSessionPatchAfterExport, buildSessionClearPatch } from '../src/services/print-sheet-export-twenty.js';

describe('session patches', () => {
  it('builds export session patch', () => {
    const patch = buildSessionPatchAfterExport('sess-1', 'Июнь 2026', 297);
    expect(patch).toEqual({
      printSheetSessionId: 'sess-1',
      printSheetTabName: 'Июнь 2026',
      printSheetRowNumber: 297,
    });
  });

  it('builds clear patch', () => {
    expect(buildSessionClearPatch()).toEqual({
      printSheetSessionId: null,
      printSheetTabName: null,
      printSheetRowNumber: null,
    });
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd backend && npm test -- print-sheet-export-twenty.test.js
```

- [ ] **Step 3: Implement GraphQL module**

`backend/src/services/print-sheet-export-twenty.js`:

```js
import { randomUUID } from 'node:crypto';
import { LAYOUT_LINK_FIELD } from './print-sheet-field-names.js';
import { V_PECHATI_LINE_ITEM_STAGE } from './print-sheet-twenty.js';

const LINE_ITEM_EXPORT_FIELDS = `
  id
  name
  stage
  kommentariy
  dataGotovnostiPechati
  vremyaGotovnostiPechati
  printSheetSessionId
  printSheetTabName
  printSheetRowNumber
  vzatoVRabotu
  gotovo
  plenka { markdown }
  ${LAYOUT_LINK_FIELD} { primaryLinkUrl }
  updatedBy { name { firstName lastName } }
  opportunity {
    id
    name
    companyId
    bitrixLink { primaryLinkUrl }
  }
`;

const LIST_PENDING_EXPORT = `
  query ListPendingPrintSheetExport($limit: Int!) {
    dealLineItems(
      filter: {
        and: [
          { stage: { eq: ${V_PECHATI_LINE_ITEM_STAGE} } }
          { printSheetSessionId: { is: NULL } }
          { dataGotovnostiPechati: { is: NOT_NULL } }
          { vremyaGotovnostiPechati: { is: NOT_NULL } }
        ]
      }
      first: $limit
    ) {
      edges { node { ${LINE_ITEM_EXPORT_FIELDS} } }
    }
  }
`;

const LIST_ACTIVE_SESSIONS = `
  query ListActivePrintSheetSessions($limit: Int!) {
    dealLineItems(
      filter: { printSheetSessionId: { is: NOT_NULL } }
      first: $limit
    ) {
      edges { node { ${LINE_ITEM_EXPORT_FIELDS} } }
    }
  }
`;

const UPDATE_LINE_ITEM = `
  mutation UpdateDealLineItemPrintSheet($id: ID!, $input: DealLineItemUpdateInput!) {
    updateDealLineItem(id: $id, data: $input) { id }
  }
`;

export function buildSessionPatchAfterExport(sessionId, tabName, rowNumber) {
  return {
    printSheetSessionId: sessionId,
    printSheetTabName: tabName,
    printSheetRowNumber: rowNumber,
  };
}

export function buildSessionClearPatch() {
  return {
    printSheetSessionId: null,
    printSheetTabName: null,
    printSheetRowNumber: null,
  };
}

export function newPrintSheetSessionId() {
  return randomUUID();
}

export async function listPendingPrintSheetExport(gql, limit = 100) {
  const resp = await gql(LIST_PENDING_EXPORT, { limit });
  return resp.data?.data?.dealLineItems?.edges?.map((e) => e.node) ?? [];
}

export async function listActivePrintSheetSessions(gql, limit = 200) {
  const resp = await gql(LIST_ACTIVE_SESSIONS, { limit });
  return resp.data?.data?.dealLineItems?.edges?.map((e) => e.node) ?? [];
}

export async function updateDealLineItemPrintSheet(gql, id, input) {
  await gql(UPDATE_LINE_ITEM, { id, input });
}

export function buildReadbackUpdateInput(lineItem, readback) {
  const input = {};
  const currentPlenka = lineItem.plenka?.markdown ?? '';
  if (currentPlenka !== readback.plenkaText) {
    input.plenka = { markdown: readback.plenkaText };
  }
  if (lineItem.vzatoVRabotu !== readback.vzatoVRabotu) {
    input.vzatoVRabotu = readback.vzatoVRabotu;
  }
  if (lineItem.gotovo !== readback.gotovo) {
    input.gotovo = readback.gotovo;
  }
  return input;
}

export { V_PECHATI_LINE_ITEM_STAGE };
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd backend && npm test -- print-sheet-export-twenty.test.js
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/print-sheet-export-twenty.js backend/tests/print-sheet-export-twenty.test.js
git commit -m "feat: add Twenty GraphQL helpers for print sheet export"
```

---

### Task 9: Print sheet cycle orchestration

**Files:**
- Create: `backend/src/services/print-sheet-cycle.js`
- Create: `backend/tests/print-sheet-cycle.test.js`

- [ ] **Step 1: Write failing orchestration test (mocked deps)**

`backend/tests/print-sheet-cycle.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const listPendingMock = vi.fn();
const listActiveMock = vi.fn();
const appendMock = vi.fn();
const fetchRowMock = vi.fn();
const updateMock = vi.fn();

vi.mock('../src/services/print-sheet-export-twenty.js', () => ({
  listPendingPrintSheetExport: (...args) => listPendingMock(...args),
  listActivePrintSheetSessions: (...args) => listActiveMock(...args),
  updateDealLineItemPrintSheet: (...args) => updateMock(...args),
  buildSessionPatchAfterExport: (sid, tab, row) => ({
    printSheetSessionId: sid,
    printSheetTabName: tab,
    printSheetRowNumber: row,
  }),
  buildSessionClearPatch: () => ({
    printSheetSessionId: null,
    printSheetTabName: null,
    printSheetRowNumber: null,
  }),
  buildReadbackUpdateInput: (li, rb) => (rb.plenkaText !== li.plenka?.markdown ? { plenka: { markdown: rb.plenkaText } } : {}),
  newPrintSheetSessionId: () => 'sess-test',
}));

vi.mock('../src/services/print-sheet-append.js', () => ({
  appendPrintSheetRow: (...args) => appendMock(...args),
}));

vi.mock('../src/services/print-sheet-readback.js', () => ({
  fetchPrintSheetRow: (...args) => fetchRowMock(...args),
  extractReadbackFromRow: () => ({
    plenkaText: 'Item - 1',
    vzatoVRabotu: true,
    gotovo: false,
  }),
}));

vi.mock('../src/services/print-sheet-row-builder.js', () => ({
  buildPrintSheetRowValues: () => ['Про', 'Order', '', 'Item', '', '', 'User', '27.06.2026', '10:00', ''],
}));

vi.mock('../src/services/print-sheet-tabs.js', () => ({
  buildCurrentMonthTabName: () => 'Июнь 2026',
}));

vi.mock('../src/services/print-sheet-twenty.js', () => ({
  V_PECHATI_LINE_ITEM_STAGE: 'V_PECHATI',
}));

import { runPrintSheetCycle } from '../src/services/print-sheet-cycle.js';

describe('runPrintSheetCycle', () => {
  const gql = vi.fn();

  beforeEach(() => {
    listPendingMock.mockReset();
    listActiveMock.mockReset();
    appendMock.mockReset();
    fetchRowMock.mockReset();
    updateMock.mockReset();
  });

  it('exports pending item then readbacks active session', async () => {
    listPendingMock.mockResolvedValue([{ id: 'li-1', name: 'Item', plenka: { markdown: '' } }]);
    listActiveMock.mockResolvedValue([
      {
        id: 'li-2',
        name: 'Item2',
        stage: 'V_PECHATI',
        printSheetTabName: 'Июнь 2026',
        printSheetRowNumber: 5,
        plenka: { markdown: '' },
      },
    ]);
    appendMock.mockResolvedValue({ rowNumber: 10 });
    fetchRowMock.mockResolvedValue(['1', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'TRUE', 'FALSE']);

    const result = await runPrintSheetCycle(gql);

    expect(appendMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalled();
    expect(result.exported).toBe(1);
  });

  it('clears session when stage is not V_PECHATI', async () => {
    listPendingMock.mockResolvedValue([]);
    listActiveMock.mockResolvedValue([
      {
        id: 'li-3',
        stage: 'NOVYY',
        printSheetSessionId: 'old',
        printSheetTabName: 'Июнь 2026',
        printSheetRowNumber: 3,
        plenka: { markdown: '' },
      },
    ]);

    await runPrintSheetCycle(gql);

    expect(updateMock).toHaveBeenCalledWith(gql, 'li-3', {
      printSheetSessionId: null,
      printSheetTabName: null,
      printSheetRowNumber: null,
    });
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd backend && npm test -- print-sheet-cycle.test.js
```

- [ ] **Step 3: Implement cycle**

`backend/src/services/print-sheet-cycle.js`:

```js
import { buildPrintSheetRowValues } from './print-sheet-row-builder.js';
import { appendPrintSheetRow } from './print-sheet-append.js';
import { fetchPrintSheetRow, extractReadbackFromRow } from './print-sheet-readback.js';
import { buildCurrentMonthTabName } from './print-sheet-tabs.js';
import { V_PECHATI_LINE_ITEM_STAGE } from './print-sheet-twenty.js';
import {
  listPendingPrintSheetExport,
  listActivePrintSheetSessions,
  updateDealLineItemPrintSheet,
  buildSessionPatchAfterExport,
  buildSessionClearPatch,
  buildReadbackUpdateInput,
  newPrintSheetSessionId,
} from './print-sheet-export-twenty.js';

export async function runPrintSheetCycle(gql) {
  let exported = 0;
  let readbackUpdated = 0;
  let sessionsCleared = 0;

  const pending = await listPendingPrintSheetExport(gql);
  const tabName = buildCurrentMonthTabName();

  for (const lineItem of pending) {
    try {
      const rowValues = buildPrintSheetRowValues(lineItem);
      const { rowNumber } = await appendPrintSheetRow(tabName, rowValues);
      const sessionId = newPrintSheetSessionId();
      await updateDealLineItemPrintSheet(
        gql,
        lineItem.id,
        buildSessionPatchAfterExport(sessionId, tabName, rowNumber)
      );
      exported += 1;
    } catch (err) {
      console.error(`[print-sheet] export failed for ${lineItem.id}:`, err.message);
    }
  }

  const active = await listActivePrintSheetSessions(gql);

  for (const lineItem of active) {
    if (lineItem.stage !== V_PECHATI_LINE_ITEM_STAGE) {
      try {
        await updateDealLineItemPrintSheet(gql, lineItem.id, buildSessionClearPatch());
        sessionsCleared += 1;
      } catch (err) {
        console.error(`[print-sheet] session clear failed for ${lineItem.id}:`, err.message);
      }
      continue;
    }

    const tab = lineItem.printSheetTabName;
    const row = lineItem.printSheetRowNumber;
    if (!tab || !row) continue;

    try {
      const cells = await fetchPrintSheetRow(tab, row);
      const readback = extractReadbackFromRow(cells, lineItem.name);
      const input = buildReadbackUpdateInput(lineItem, readback);
      if (Object.keys(input).length === 0) continue;
      await updateDealLineItemPrintSheet(gql, lineItem.id, input);
      readbackUpdated += 1;
    } catch (err) {
      console.error(`[print-sheet] read-back failed for ${lineItem.id}:`, err.message);
    }
  }

  return { exported, readbackUpdated, sessionsCleared };
}
```

- [ ] **Step 4: Run test — expect PASS**

```bash
cd backend && npm test -- print-sheet-cycle.test.js
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/print-sheet-cycle.js backend/tests/print-sheet-cycle.test.js
git commit -m "feat: orchestrate print sheet export read-back and session reset"
```

---

### Task 10: Wire cron + remove legacy plenka scan

**Files:**
- Modify: `backend/src/services/print-sheet-cron.js`
- Modify: `backend/tests/print-sheet-cron.test.js`
- Modify: `backend/src/services/print-sheet-twenty.js` (remove unused list/refresh if nothing else imports)
- Modify: `backend/src/services/twenty-sync.js`

- [ ] **Step 1: Update print-sheet-cron.js**

Replace body of `runPrintSheetRefresh`:

```js
import { runPrintSheetCycle } from './print-sheet-cycle.js';

export async function runPrintSheetRefresh() {
  if (
    !config.printSheetId ||
    !config.googleServiceAccountEmail ||
    !config.googleServiceAccountPrivateKey
  ) {
    return;
  }

  let gql;
  try {
    const twenty = requireTwentyConfig();
    gql = createTwentyGqlClient(twenty.apiUrl, twenty.apiToken);
  } catch {
    return;
  }

  await runPrintSheetCycle(gql);
}
```

Remove imports of `listLineItemsInPrintStage`, `refreshPlenkaForLineItem`.

- [ ] **Step 2: Update print-sheet-cron.test.js**

Mock `runPrintSheetCycle` instead of legacy plenka functions. Verify it is called when configured.

- [ ] **Step 3: Update twenty-sync.js**

Replace `refreshPlenkaForOpportunityLineItems` import with:

```js
import { runPrintSheetCycle } from './print-sheet-cycle.js';
```

In `refreshPlenkaAfterSync`, rename to `refreshPrintSheetAfterSync` and call `runPrintSheetCycle(gqlClient)` (export will pick up pending items for any opportunity).

- [ ] **Step 4: Remove dead code from print-sheet-twenty.js**

Delete `refreshPlenkaForLineItem`, `refreshPlenkaForOpportunityLineItems`, `listLineItemsInPrintStage`, `listLineItemsInPrintStageForOpportunity`, `updateLineItemPlenka` if no longer referenced. Keep `V_PECHATI_LINE_ITEM_STAGE` export.

Remove from `print-sheet-lookup.js`: `lookupFilmsForLineItem`, `lookupFilmsForOrder` if tests no longer need them — update `print-sheet-lookup.test.js` accordingly or delete file if empty.

- [ ] **Step 5: Run full test suite**

```bash
cd backend && npm test
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/print-sheet-cron.js backend/tests/print-sheet-cron.test.js backend/src/services/print-sheet-twenty.js backend/src/services/twenty-sync.js backend/src/services/print-sheet-lookup.js backend/tests/print-sheet-lookup.test.js
git commit -m "feat: replace legacy plenka cron scan with print sheet cycle"
```

---

### Task 11: Manual rollout checklist

**Files:** none (ops)

- [ ] **Step 1: Grant service account Editor** on spreadsheet `12rGgW0vucmm4eXy4yrtQLRLNcqNpPVznpNdA-c1HuP0`

- [ ] **Step 2: Deploy with env vars** (`PRINT_SHEET_ID`, Google credentials, optional `PRINT_SHEET_DEPARTMENT_MAP`)

- [ ] **Step 3: Manual smoke test**

1. Open a position in Twenty, set date/time готовности печати
2. Move to «В печати»
3. Within 1 minute verify new row on current month tab (B–K filled, A untouched)
4. Enter number in A, check W, check X
5. Within 1 minute verify `plenka`, `vzatoVRabotu`, `gotovo` in Twenty
6. Move stage away from «В печати», verify session fields cleared
7. Re-enter «В печати» → new row appears

- [ ] **Step 4: Update spec status to Approved** in `docs/superpowers/specs/2026-06-28-print-sheet-export-design.md`

---

## Self-Review (plan vs spec)

| Spec requirement | Task |
|------------------|------|
| Export B–K on V_PECHATI | Task 5, 6, 9 |
| Skip A, F, L | Task 5 row builder |
| Current month tab | Task 3 |
| Department config | Task 2, 4 |
| Date/time required | Task 8 GraphQL filter |
| Session re-entry | Task 8, 9 reset phase |
| Read-back A/W/X | Task 7, 9 |
| Deprecate full-tab lookup | Task 10 |
| Twenty new fields | Task 1 |
| Write scope | Task 3 client |
| Sync hook | Task 10 |
| No stage change on gotovo | Task 7 (boolean only) |

No TBD placeholders in task steps. Layout link field name resolved in Task 1 Step 1.
