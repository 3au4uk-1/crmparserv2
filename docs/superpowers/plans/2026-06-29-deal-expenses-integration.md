# Deal Expenses → Twenty CRM Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync deal expenses from Google Sheets (and optional beznal upload) into Twenty CRM opportunity fields for all locally synced deals (`twenty_id`), using deal-centric matching — no month/tab filtering.

**Architecture:** Port `deal-expenses` parsers into `backend/src/services/deal-expenses/`, add `runDealCentricPipeline({ targetDealIds })` that scans all tabs, keeps only matching Bitrix IDs, sums per source. `expense-sync.js` loads target deals from SQLite, runs pipeline, pushes 6 CURRENCY fields + `rashodSyncedAt` via Twenty GraphQL. Async job + cron mirror `export-jobs` pattern.

**Tech Stack:** Node.js 20 ESM, vitest, googleapis, xlsx, better-sqlite3, express, Twenty GraphQL, MCP metadata (one-time field creation).

**Spec:** `docs/superpowers/specs/2026-06-29-deal-expenses-integration-design.md`

---

## File Map

| File | Responsibility |
|------|----------------|
| `backend/src/services/deal-expenses/bitrix.js` | Extract Bitrix deal ID from URL/text |
| `backend/src/services/deal-expenses/amounts.js` | Parse ruble amounts |
| `backend/src/services/deal-expenses/dates.js` | Date parsers (used by readers, not for filtering) |
| `backend/src/services/deal-expenses/readers/*.js` | Layout parsers (ported from deal-expenses) |
| `backend/src/services/deal-expenses/pipeline.js` | `runDealCentricPipeline` — deal-centric aggregation |
| `backend/src/services/deal-expenses/sheets-reader.js` | Google Sheets → tab data + hyperlinks |
| `backend/src/services/deal-expenses/spreadsheet-id.js` | Parse URL or bare ID |
| `backend/src/services/deal-expenses/beznal-storage.js` | Read latest beznal xlsx upload |
| `backend/src/services/expense-field-names.js` | Twenty field API names |
| `backend/src/services/expense-field-setup.js` | Idempotent GraphQL field ensure (optional runtime) |
| `backend/src/services/expense-sync.js` | Orchestrator: pipeline → Twenty updates |
| `backend/src/services/expense-jobs.js` | In-memory job state (like export-jobs) |
| `backend/src/services/expense-sync-cron.js` | Cron trigger |
| `backend/src/routes/expenses.js` | REST API |
| `backend/config/expense-logistics-users.json` | Logistics allowed_users |
| `backend/tests/deal-expenses/*.test.js` | Parser + pipeline tests |
| `backend/tests/expense-sync.test.js` | Sync orchestration tests |
| `backend/tests/expense-jobs.test.js` | Job lifecycle |
| `frontend/src/pages/Expenses.jsx` | Manual sync + beznal upload UI |
| `frontend/src/api.js` | React Query hooks |

---

### Task 1: Twenty metadata — expense fields on Opportunity

**Files:**
- Modify: Twenty workspace via MCP
- Create: `backend/src/services/expense-field-names.js`

- [ ] **Step 1: Create CURRENCY fields via MCP**

`execute_tool` → `create_field_metadata` on opportunity object `806bcba5-5967-477f-a989-06afd3ea1d24`:

| name | type | label |
|------|------|-------|
| `rashodVyezdnayaKomanda` | CURRENCY | Расход: выездная команда |
| `rashodPechat` | CURRENCY | Расход: печать |
| `rashodFrezerovka` | CURRENCY | Расход: фрезеровка |
| `rashodLogistika` | CURRENCY | Расход: логистика |
| `rashodBeznal` | CURRENCY | Расход: безнал |
| `rashodItogo` | CURRENCY | Расход: итого |
| `rashodSyncedAt` | DATE_TIME | Расход: обновлено |

For each CURRENCY field, pass `settings: { currencyCode: 'RUB' }` if MCP schema requires it.

- [ ] **Step 2: Create constants file**

`backend/src/services/expense-field-names.js`:

```js
export const EXPENSE_FIELDS = {
  fieldTeam: 'rashodVyezdnayaKomanda',
  printing: 'rashodPechat',
  milling: 'rashodFrezerovka',
  logistics: 'rashodLogistika',
  beznal: 'rashodBeznal',
  total: 'rashodItogo',
  syncedAt: 'rashodSyncedAt',
};

export const SOURCE_TO_FIELD = {
  field_team: EXPENSE_FIELDS.fieldTeam,
  printing: EXPENSE_FIELDS.printing,
  milling: EXPENSE_FIELDS.milling,
  logistics: EXPENSE_FIELDS.logistics,
  beznal: EXPENSE_FIELDS.beznal,
};

export const OPPORTUNITY_OBJECT_ID = '806bcba5-5967-477f-a989-06afd3ea1d24';
```

- [ ] **Step 3: Verify fields via GraphQL**

Use `find_one_opportunity` or test mutation with zero amounts in dev. Confirm field names resolve.

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/expense-field-names.js
git commit -m "chore: add Twenty expense field name constants"
```

---

### Task 2: Database migration + default settings

**Files:**
- Modify: `backend/src/db/migrate.js`
- Modify: `backend/src/db/schema.sql` (document new tables)

- [ ] **Step 1: Write failing migration test**

Create `backend/tests/expense-migrate.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = path.join(__dirname, '../data/test-expense-migrate.db');

describe('expense tables migration', () => {
  beforeEach(() => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    process.env.DB_PATH = TEST_DB;
  });
  afterEach(() => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    delete process.env.DB_PATH;
  });

  it('creates expense_sync_runs and expense_beznal_uploads', async () => {
    const { initDb, getDb } = await import('../src/db/connection.js');
    const { migrate } = await import('../src/db/migrate.js');
    initDb();
    migrate();
    const db = getDb();
    const runs = db.prepare("SELECT name FROM sqlite_master WHERE name='expense_sync_runs'").get();
    const uploads = db.prepare("SELECT name FROM sqlite_master WHERE name='expense_beznal_uploads'").get();
    expect(runs).toBeTruthy();
    expect(uploads).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- tests/expense-migrate.test.js`
Expected: FAIL — tables missing

- [ ] **Step 3: Add migration SQL to `migrate.js`**

Append inside `migrate()` before final log:

```js
  db.exec(`
    CREATE TABLE IF NOT EXISTS expense_sync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL DEFAULT 'queued',
      trigger TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      deals_targeted INTEGER DEFAULT 0,
      deals_updated INTEGER DEFAULT 0,
      deals_with_expenses INTEGER DEFAULT 0,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS expense_beznal_uploads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      storage_path TEXT NOT NULL,
      original_filename TEXT,
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const expenseDefaults = [
    ['expense_sheet_field_team', '1cqOIF0MBJggXdUzJ_ll4GaW9jVcDmFPKyrsbWr3ofwk'],
    ['expense_sheet_printing', '1OYLaUJukGnjvx5qmdHAaKWuVaCTscDsdffzCTqy64pA'],
    ['expense_sheet_milling', '1fKlBKDQlOQgvqyEz-qVDWIE5oBKin40RSuRkWvrw-xA'],
    ['expense_sheet_logistics', '1MtGMGzsSS-0ci1HVwdjXcapQQrkaC6qOdI8MdH2mTFM'],
    ['expense_sheet_beznal', ''],
    ['expense_sync_schedule', '0 6 * * *'],
  ];
  for (const [key, value] of expenseDefaults) {
    db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(key, value);
  }
```

Also add table definitions to `schema.sql` for fresh installs.

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add backend/src/db/migrate.js backend/src/db/schema.sql backend/tests/expense-migrate.test.js
git commit -m "feat: add expense sync database tables and default settings"
```

---

### Task 3: Port core parsers (bitrix, amounts, readers)

**Files:**
- Create: `backend/src/services/deal-expenses/bitrix.js`
- Create: `backend/src/services/deal-expenses/amounts.js`
- Create: `backend/src/services/deal-expenses/readers/columnLayout.js`
- Create: `backend/src/services/deal-expenses/readers/rowLayout.js`
- Create: `backend/src/services/deal-expenses/readers/rowLayoutLogistics.js`
- Create: `backend/src/services/deal-expenses/readers/beznalLayout.js`
- Create: `backend/config/expense-logistics-users.json`
- Modify: `backend/package.json` — add `xlsx` dependency

- [ ] **Step 1: Install xlsx**

```bash
cd backend && npm install xlsx
```

- [ ] **Step 2: Copy and convert parsers**

Copy from `C:\Users\Василий\Projects\deal-expenses\src\` into `backend/src/services/deal-expenses/`:

- `bitrix.js` → ESM `export function extractDealId...`
- `amounts.js` → ESM exports
- `readers/*.js` → ESM; change `require('../bitrix')` to `import { extractDealId } from '../bitrix.js'`

`expense-logistics-users.json`:

```json
[
  "Абашин Андрей Дмитриевич",
  "Очаев Илья Александрович",
  "Казеев Кирилл Григорьевич",
  "Суслов Александр Валерьевич"
]
```

- [ ] **Step 3: Write parser fixture test**

`backend/tests/deal-expenses/beznal-layout.test.js` — read a minimal fixture xlsx (copy one small sample to `backend/tests/fixtures/expenses/beznal-sample.xlsx` or build inline array) and assert `deal_id` + `amount` extracted.

- [ ] **Step 4: Run tests — PASS**

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/deal-expenses backend/config/expense-logistics-users.json backend/package.json backend/package-lock.json backend/tests/deal-expenses
git commit -m "feat: port deal-expenses layout parsers to backend"
```

---

### Task 4: Deal-centric pipeline

**Files:**
- Create: `backend/src/services/deal-expenses/pipeline.js`
- Create: `backend/tests/deal-expenses/pipeline.test.js`

- [ ] **Step 1: Write failing tests**

`backend/tests/deal-expenses/pipeline.test.js`:

```js
import { describe, it, expect } from 'vitest';
import {
  runDealCentricPipeline,
  shouldSkipSheet,
  aggregateDealsForTargets,
} from '../../src/services/deal-expenses/pipeline.js';

describe('runDealCentricPipeline', () => {
  it('keeps only records matching target deal IDs', () => {
    const records = [
      { deal_id: '111', source: 'printing', amount: 100, tab: 'A' },
      { deal_id: '222', source: 'printing', amount: 50, tab: 'B' },
      { deal_id: '111', source: 'milling', amount: 30, tab: 'C' },
    ];
    const result = aggregateDealsForTargets(records, ['111'], ['printing', 'milling']);
    expect(result).toHaveLength(1);
    expect(result[0].deal_id).toBe('111');
    expect(result[0].amounts.printing).toBe(100);
    expect(result[0].amounts.milling).toBe(30);
  });

  it('sums same deal across multiple tabs (no month filter)', () => {
    const records = [
      { deal_id: '111', source: 'printing', amount: 100, tab: 'МАЙ 2026' },
      { deal_id: '111', source: 'printing', amount: 200, tab: 'ИЮНЬ 2026' },
    ];
    const result = aggregateDealsForTargets(records, ['111'], ['printing']);
    expect(result[0].amounts.printing).toBe(300);
  });

  it('shouldSkipSheet skips junk tabs only', () => {
    const patterns = ['^болванка', 'копия'];
    expect(shouldSkipSheet('Болванка май', patterns)).toBe(true);
    expect(shouldSkipSheet('МАЙ 2026', patterns)).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `pipeline.js`**

```js
const SOURCE_LABELS = {
  field_team: 'Выездная команда',
  printing: 'Печать',
  milling: 'Фрезеровка',
  logistics: 'Логистика',
  beznal: 'Безнал',
};

const PARSERS = {
  column_layout: parseColumnLayoutSheet,
  row_layout: parseRowLayoutSheet,
  row_layout_logistics: parseLogisticsSheet,
  beznal_layout: parseBeznalSheet,
};

export function shouldSkipSheet(sheetName, patterns) {
  return patterns.some((p) => new RegExp(p, 'i').test(sheetName));
}

function createEmptyAmounts(sourceKeys) {
  return Object.fromEntries(sourceKeys.map((k) => [k, 0]));
}

export function aggregateDealsForTargets(records, targetDealIds, sourceKeys) {
  const targetSet = new Set(targetDealIds.map(String));
  const deals = new Map();

  for (const record of records) {
    if (!record.deal_id || !targetSet.has(String(record.deal_id))) continue;
    if (!deals.has(record.deal_id)) {
      deals.set(record.deal_id, {
        deal_id: record.deal_id,
        amounts: createEmptyAmounts(sourceKeys),
      });
    }
    const deal = deals.get(record.deal_id);
    deal.amounts[record.source] += record.amount;
  }
  return [...deals.values()];
}

export function parseWorkbookTabs(workbook, sourceKey, sourceConfig, skipPatterns, getSheetMeta) {
  const parser = PARSERS[sourceConfig.type];
  const allRecords = [];
  for (const sheetName of workbook.SheetNames) {
    if (shouldSkipSheet(sheetName, skipPatterns)) continue;
    const { data, sheet, hyperlinks } = getSheetMeta(sheetName);
    const records = parser(data, {
      source: sourceKey,
      spreadsheet: workbook.name || sourceKey,
      tab: sheetName,
      sheet,
      hyperlinks,
      sourceConfig,
    });
    allRecords.push(...records);
  }
  return allRecords;
}

export function runDealCentricPipeline({ sources, targetDealIds, skipSheetPatterns = [], readSource }) {
  const sourceKeys = Object.keys(sources);
  const allRecords = [];

  for (const [sourceKey, sourceConfig] of Object.entries(sources)) {
    const workbook = readSource(sourceKey, sourceConfig);
    if (!workbook) continue;
    const parsed = parseWorkbookTabs(
      workbook,
      sourceKey,
      sourceConfig,
      skipSheetPatterns,
      workbook.getSheetMeta
    );
    allRecords.push(...parsed);
  }

  const aggregated = aggregateDealsForTargets(allRecords, targetDealIds, sourceKeys);

  // Ensure every target deal appears (zeros if no rows)
  const byId = new Map(aggregated.map((d) => [String(d.deal_id), d]));
  for (const id of targetDealIds) {
    if (!byId.has(String(id))) {
      byId.set(String(id), { deal_id: String(id), amounts: createEmptyAmounts(sourceKeys) });
    }
  }

  return {
    deals: [...byId.values()],
    sourceKeys,
    sourceLabels: Object.fromEntries(sourceKeys.map((k) => [k, SOURCE_LABELS[k] || k])),
    stats: {
      parsed_rows: allRecords.length,
      matched_rows: allRecords.filter((r) => targetDealIds.includes(String(r.deal_id))).length,
      deals: byId.size,
    },
  };
}
```

**Note:** Remove `shouldSkipSheetByYear` and `filterByMonth` entirely — not called.

- [ ] **Step 4: Run tests — PASS**

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/deal-expenses/pipeline.js backend/tests/deal-expenses/pipeline.test.js
git commit -m "feat: add deal-centric expense pipeline without month filtering"
```

---

### Task 5: Google Sheets reader + spreadsheet ID parser

**Files:**
- Create: `backend/src/services/deal-expenses/spreadsheet-id.js`
- Create: `backend/src/services/deal-expenses/sheets-reader.js`
- Create: `backend/tests/deal-expenses/spreadsheet-id.test.js`
- Create: `backend/tests/deal-expenses/sheets-reader.test.js`

- [ ] **Step 1: Test spreadsheet ID parsing**

`spreadsheet-id.js`:

```js
export function parseSpreadsheetId(input) {
  const text = String(input || '').trim();
  if (!text) return '';
  const m = text.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9-_]{20,}$/.test(text)) return text;
  return '';
}
```

Test URLs and bare IDs.

- [ ] **Step 2: Implement sheets-reader with mock**

`fetchSpreadsheetWorkbook(client, spreadsheetId)` returns:

```js
{
  SheetNames: ['Tab1'],
  name: spreadsheetId,
  getSheetMeta(sheetName) {
    return { data: [[...]], sheet: null, hyperlinks: new Map() };
  },
}
```

Use `client.spreadsheets.get({ spreadsheetId, includeGridData: true, fields: 'sheets.properties.title,sheets.data.rowData.values(formattedValue,hyperlink)' })`.

Convert grid to `data[row][col]` 2D array; build hyperlinks map keyed `row:col`.

- [ ] **Step 3: Adapt beznal/row parsers to accept `hyperlinks` map**

In `beznalLayout.js`, replace `getCellHyperlink(sheet, row, col)` with:

```js
function getCellHyperlink(meta, rowIndex, colIndex) {
  return meta.hyperlinks?.get(`${rowIndex}:${colIndex}`) ?? null;
}
```

- [ ] **Step 4: Run tests — PASS**

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/deal-expenses/spreadsheet-id.js backend/src/services/deal-expenses/sheets-reader.js backend/tests/deal-expenses/
git commit -m "feat: add Google Sheets reader for expense sources"
```

---

### Task 6: Bezнал storage (xlsx fallback)

**Files:**
- Create: `backend/src/services/deal-expenses/beznal-storage.js`
- Create: `backend/tests/deal-expenses/beznal-storage.test.js`

- [ ] **Step 1: Implement storage helpers**

```js
import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import { fileURLToPath } from 'url';
import { getDb } from '../../db/connection.js';

const UPLOADS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../data/expense-uploads');

export function saveBeznalUpload(buffer, originalFilename) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const storagePath = path.join(UPLOADS_DIR, 'beznal-latest.xlsx');
  fs.writeFileSync(storagePath, buffer);
  const db = getDb();
  db.prepare('DELETE FROM expense_beznal_uploads').run();
  db.prepare(
    'INSERT INTO expense_beznal_uploads (storage_path, original_filename) VALUES (?, ?)'
  ).run(storagePath, originalFilename || 'beznal.xlsx');
  return storagePath;
}

export function loadBeznalWorkbook() {
  const db = getDb();
  const row = db.prepare('SELECT storage_path FROM expense_beznal_uploads ORDER BY id DESC LIMIT 1').get();
  if (!row?.storage_path || !fs.existsSync(row.storage_path)) return null;
  const wb = XLSX.readFile(row.storage_path);
  return {
    SheetNames: wb.SheetNames,
    name: 'beznal-upload',
    getSheetMeta(sheetName) {
      const sheet = wb.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      return { data, sheet, hyperlinks: extractXlsxHyperlinks(sheet) };
    },
  };
}
```

Implement `extractXlsxHyperlinks` from cell `.l.Target`.

- [ ] **Step 2: Test save + load roundtrip**

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/deal-expenses/beznal-storage.js backend/tests/deal-expenses/beznal-storage.test.js
git commit -m "feat: add beznal xlsx upload storage fallback"
```

---

### Task 7: Build Twenty update payload + expense-sync orchestrator

**Files:**
- Create: `backend/src/services/expense-sync.js`
- Create: `backend/tests/expense-sync.test.js`

- [ ] **Step 1: Write failing test for `buildExpenseUpdateInput`**

```js
import { describe, it, expect } from 'vitest';
import { buildExpenseUpdateInput } from '../src/services/expense-sync.js';

describe('buildExpenseUpdateInput', () => {
  it('maps source amounts to Twenty currency fields', () => {
    const input = buildExpenseUpdateInput({
      amounts: { field_team: 100, printing: 200, milling: 0, logistics: 50, beznal: 25 },
    });
    expect(input.rashodVyezdnayaKomanda.amountMicros).toBe(100_000_000);
    expect(input.rashodPechat.amountMicros).toBe(200_000_000);
    expect(input.rashodItogo.amountMicros).toBe(375_000_000);
    expect(input.rashodSyncedAt).toBeTruthy();
  });
});
```

- [ ] **Step 2: Implement `expense-sync.js`**

Key exports:

```js
export function buildExpenseUpdateInput({ amounts }) {
  const rub = (n) => ({
    amountMicros: Math.round((n || 0) * 1_000_000),
    currencyCode: 'RUB',
  });
  const total =
    (amounts.field_team || 0) +
    (amounts.printing || 0) +
    (amounts.milling || 0) +
    (amounts.logistics || 0) +
    (amounts.beznal || 0);

  return {
    [EXPENSE_FIELDS.fieldTeam]: rub(amounts.field_team),
    [EXPENSE_FIELDS.printing]: rub(amounts.printing),
    [EXPENSE_FIELDS.milling]: rub(amounts.milling),
    [EXPENSE_FIELDS.logistics]: rub(amounts.logistics),
    [EXPENSE_FIELDS.beznal]: rub(amounts.beznal),
    [EXPENSE_FIELDS.total]: rub(total),
    [EXPENSE_FIELDS.syncedAt]: new Date().toISOString(),
  };
}

export function loadTargetDeals(db) {
  return db.prepare(`
    SELECT id, twenty_id, crm_lead_id
    FROM deals
    WHERE twenty_id IS NOT NULL
      AND crm_lead_id IS NOT NULL
      AND TRIM(crm_lead_id) != ''
  `).all();
}

export async function runExpenseSync({ trigger = 'manual', onProgress }) {
  // 1. load settings, build sources config
  // 2. loadTargetDeals → targetDealIds = crm_lead_ids
  // 3. readSource per key: sheets-reader or beznal-storage
  // 4. runDealCentricPipeline
  // 5. map deal_id → twenty_id
  // 6. for each target deal: gql updateOpportunity
  // 7. return stats
}
```

`loadExpenseSourceSettings(db)` reads `expense_sheet_*` keys, builds:

```js
{
  field_team: { type: 'column_layout', spreadsheetId: '...' },
  printing: { type: 'row_layout', spreadsheetId: '...' },
  ...
  beznal: { type: 'beznal_layout', spreadsheetId: '...' },
}
```

Skip sources with empty spreadsheetId (except beznal → try upload).

- [ ] **Step 3: Mock gql in test for full orchestrator path**

- [ ] **Step 4: Run tests — PASS**

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/expense-sync.js backend/tests/expense-sync.test.js
git commit -m "feat: add expense sync orchestrator for Twenty CRM"
```

---

### Task 8: Expense jobs + routes + cron

**Files:**
- Create: `backend/src/services/expense-jobs.js`
- Create: `backend/src/services/expense-sync-cron.js`
- Create: `backend/src/routes/expenses.js`
- Modify: `backend/src/index.js`
- Create: `backend/tests/expense-jobs.test.js`

- [ ] **Step 1: Implement expense-jobs (mirror export-jobs)**

In-memory `Map` for job state; also insert/update `expense_sync_runs` row in SQLite for history.

```js
export function createExpenseJob({ trigger }) { ... }
export function getActiveExpenseJob() { ... }
export async function executeExpenseJob(jobId) {
  updateJob(jobId, { status: 'running', started_at: ... });
  try {
    const stats = await runExpenseSync({ trigger, onProgress });
    updateJob(jobId, { status: 'completed', ...stats });
  } catch (err) {
    updateJob(jobId, { status: 'failed', error: err.message });
  }
}
```

- [ ] **Step 2: Implement routes**

`backend/src/routes/expenses.js`:

```js
import multer from 'multer'; // or express raw buffer — add multer dep if needed
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

router.post('/sync', (req, res) => {
  if (getActiveExpenseJob()) return res.status(409).json({ error: 'Синхронизация расходов уже выполняется' });
  const job = createExpenseJob({ trigger: 'manual' });
  executeExpenseJob(job.jobId).catch(console.error);
  res.status(201).json({ jobId: job.jobId });
});

router.post('/beznal-upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не передан' });
  saveBeznalUpload(req.file.buffer, req.file.originalname);
  res.json({ success: true });
});
```

**Alternative without multer:** use `express.raw` only on this route — prefer `multer` for multipart.

- [ ] **Step 3: Wire cron**

`expense-sync-cron.js`:

```js
export function initExpenseSyncCron() {
  const schedule = getSetting('expense_sync_schedule') || '0 6 * * *';
  cron.schedule(schedule, () => {
    if (getActiveExpenseJob()) return;
    const job = createExpenseJob({ trigger: 'schedule' });
    executeExpenseJob(job.jobId).catch(console.error);
  }, { timezone: CRM_TIMEZONE });
}
```

Add to `index.js`: `import { initExpenseSyncCron } from './services/expense-sync-cron.js';` and call in `start()`.

Add route: `app.use('/api/expenses', expensesRouter);`

- [ ] **Step 4: Test 409 on concurrent job**

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/expense-jobs.js backend/src/services/expense-sync-cron.js backend/src/routes/expenses.js backend/src/index.js backend/tests/expense-jobs.test.js backend/package.json
git commit -m "feat: add expense sync API, jobs, and cron"
```

---

### Task 9: Frontend — Expenses page + Settings

**Files:**
- Modify: `frontend/src/api.js`
- Create: `frontend/src/pages/Expenses.jsx`
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/pages/Settings.jsx`

- [ ] **Step 1: Add API hooks**

In `frontend/src/api.js`:

```js
export function useStartExpenseSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/expenses/sync').then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expenseJob'] }),
  });
}

export function useActiveExpenseJob() {
  return useQuery({
    queryKey: ['expenseJob', 'active'],
    queryFn: () => api.get('/expenses/jobs/active').then((r) => r.data),
    refetchInterval: (q) => (q.state.data?.status === 'running' ? 2000 : false),
  });
}

export function useUploadBeznal() {
  return useMutation({
    mutationFn: (file) => {
      const fd = new FormData();
      fd.append('file', file);
      return api.post('/expenses/beznal-upload', fd).then((r) => r.data);
    },
  });
}
```

- [ ] **Step 2: Create Expenses.jsx**

Mirror `Export.jsx` structure but simpler:
- Button «Синхронизировать расходы в Twenty»
- Progress: status, deals_targeted, deals_updated, deals_with_expenses
- File input for beznal `.xlsx` upload
- No month/year picker

- [ ] **Step 3: Add Settings section «Расходы»**

Five spreadsheet URL inputs + `expense_sync_schedule` cron field (reuse pattern from `parse_schedule`).

- [ ] **Step 4: Add nav item**

In `App.jsx` `navItems`: `{ to: '/expenses', label: 'Расходы' }`

Route: `<Route path="/expenses" element={<Expenses />} />`

- [ ] **Step 5: Build frontend**

```bash
cd frontend && npm run build
cd ../backend && npm run build:public
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/api.js frontend/src/pages/Expenses.jsx frontend/src/App.jsx frontend/src/pages/Settings.jsx
git commit -m "feat: add Expenses UI and settings for spreadsheet URLs"
```

---

### Task 10: End-to-end verification

- [ ] **Step 1: Run full test suite**

```bash
cd backend && npm test
```

Expected: all PASS

- [ ] **Step 2: Manual smoke test**

1. Ensure `GOOGLE_SERVICE_ACCOUNT_*` in `.env` and sheets shared with service account.
2. Ensure Twenty credentials configured.
3. POST `/api/expenses/sync` (authenticated).
4. Verify opportunity in Twenty shows expense fields populated for a known synced deal.

- [ ] **Step 3: Update spec status**

In `docs/superpowers/specs/2026-06-29-deal-expenses-integration-design.md`, set `Status: Implemented`.

- [ ] **Step 4: Final commit**

```bash
git add docs/
git commit -m "docs: mark deal expenses integration as implemented"
```

---

## Self-Review (plan vs spec)

| Spec requirement | Task |
|------------------|------|
| Deal-centric, no month/tab filter | Task 4 — no `filterByMonth` / `shouldSkipSheetByYear` |
| Only Twenty-synced deals | Task 7 `loadTargetDeals` |
| Zeros when no sheet rows | Task 4 `aggregateDealsForTargets` ensures all targets |
| Sum across all tabs | Task 4 test + pipeline |
| Google Sheets in settings | Task 2 defaults + Task 9 Settings UI |
| Bezнал sheet + upload fallback | Task 6 + Task 5/7 resolution order |
| 6 CURRENCY + syncedAt fields | Task 1 |
| Cron + manual | Task 8 + Task 9 |
| Skip junk tabs only | Task 4 `shouldSkipSheet` |
| Don't touch revenue `amount` | Task 7 only expense fields in mutation |

No placeholders remain. Field names consistent across Tasks 1, 7, 8.
