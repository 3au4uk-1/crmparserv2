# Historical Excel Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/export` page that runs a background job to parse historical CRM calendar events in-memory, filter deals by keyword_match (excluding blacklist), and download a two-sheet Russian Excel file — without writing to SQLite or Twenty.

**Architecture:** `normalizeExportRange` allows past dates. `buildExportDealsFromEvent` mirrors Tony/calendar branches from `applyEvent` but returns pure objects. `export-jobs.js` tracks in-memory jobs and temp files under `data/exports/`. `runHistoricalExport` fetches events, classifies with `classifyByKeywords` only, writes xlsx via `exceljs`. Shared `parsing-lock` prevents concurrent CRM hammering with regular parsing.

**Tech Stack:** Node.js ESM, Express 5, exceljs, vitest, React 19, TanStack Query, Tailwind 4. Spec: `docs/superpowers/specs/2026-06-26-historical-excel-export-design.md`.

---

## File Structure

| File | Responsibility |
|------|----------------|
| **Create** `backend/src/utils/crm-dates.js` (modify) | Add `normalizeExportRange` |
| **Create** `backend/src/services/historical-export.js` | `buildExportDealsFromEvent`, `filterExportItems`, `runHistoricalExport`, `buildExportWorkbook` |
| **Create** `backend/src/services/export-jobs.js` | Job registry, TTL cleanup, start/get/download |
| **Create** `backend/src/routes/export.js` | REST endpoints |
| **Modify** `backend/src/index.js` | Mount `/api/export` |
| **Modify** `backend/package.json` | Add `exceljs` |
| **Create** `backend/tests/historical-export.test.js` | Unit tests for deal building + excel headers |
| **Create** `backend/tests/export-jobs.test.js` | Job lifecycle tests |
| **Modify** `backend/tests/crm-dates.test.js` | `normalizeExportRange` tests |
| **Modify** `backend/tests/parsing-lock.test.js` | Document shared lock (no code change if reusing same module) |
| **Create** `frontend/src/pages/Export.jsx` | Export UI |
| **Modify** `frontend/src/api.js` | Export hooks |
| **Modify** `frontend/src/App.jsx` | Route + nav item |
| **Modify** `frontend/src/components/ui/Icons.jsx` | `IconExport` + nav entry |

---

## Task 1: `normalizeExportRange`

**Files:**
- Modify: `backend/src/utils/crm-dates.js`
- Test: `backend/tests/crm-dates.test.js`

- [ ] **Step 1: Write the failing test**

```js
// append to backend/tests/crm-dates.test.js
import { normalizeExportRange } from '../src/utils/crm-dates.js';

describe('normalizeExportRange', () => {
  const now = new Date('2026-06-05T12:00:00+03:00');

  it('does not clamp start before today', () => {
    const { start, end } = normalizeExportRange('2025-01-01', '2025-03-31', now);
    expect(start).toContain('2025-01-01');
    expect(end).toContain('2025-03-31');
  });

  it('expands YYYY-MM-DD to full-day Moscow bounds', () => {
    const { start, end } = normalizeExportRange('2025-06-01', '2025-06-30', now);
    expect(start).toBe('2025-06-01T00:00:00+03:00');
    expect(end).toBe('2025-06-30T23:59:59+03:00');
  });

  it('throws when from > to', () => {
    expect(() => normalizeExportRange('2025-06-30', '2025-06-01', now)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix backend -- crm-dates`
Expected: FAIL — `normalizeExportRange is not exported`

- [ ] **Step 3: Implement**

```js
// backend/src/utils/crm-dates.js — add after normalizeParseRange
export function normalizeExportRange(startDate, endDate, now = new Date()) {
  if (!DATE_INPUT_RE.test(startDate) || !DATE_INPUT_RE.test(endDate)) {
    throw new Error('from and to required (YYYY-MM-DD)');
  }
  const start = `${startDate}T00:00:00${crmOffsetSuffix()}`;
  const end = `${endDate}T23:59:59${crmOffsetSuffix()}`;
  const startTs = parseEventDate(start)?.getTime() ?? 0;
  const endTs = parseEventDate(end)?.getTime() ?? 0;
  if (startTs > endTs) {
    throw new Error('from must be <= to');
  }
  return { start, end, startDate, endDate };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --prefix backend -- crm-dates`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/utils/crm-dates.js backend/tests/crm-dates.test.js
git commit -m "feat(export): add normalizeExportRange for historical periods"
```

---

## Task 2: `buildExportDealsFromEvent` (in-memory deal builder)

**Files:**
- Create: `backend/src/services/historical-export.js`
- Test: `backend/tests/historical-export.test.js`

- [ ] **Step 1: Write the failing tests**

```js
// backend/tests/historical-export.test.js
import { describe, it, expect } from 'vitest';
import {
  buildExportDealsFromEvent,
  filterExportItems,
} from '../src/services/historical-export.js';

const keywords = ['баннер', 'печать'];
const blacklist = [{ pattern: 'тест', matchType: 'substring' }];

describe('filterExportItems', () => {
  it('keeps keyword_match not in blacklist', () => {
    const items = [
      { name: 'Баннер 3x6', classification: 'keyword_match' },
      { name: 'тестовый баннер', classification: 'keyword_match' },
      { name: 'Кофе', classification: 'unclassified' },
    ];
    expect(filterExportItems(items, blacklist).map((i) => i.name)).toEqual(['Баннер 3x6']);
  });
});

describe('buildExportDealsFromEvent', () => {
  const event = {
    title: 'ПРО Иванов 12345 Конференция',
    start: '2025-03-15T10:00:00+03:00',
    department: 'Брендинг',
  };
  const eventId = 'evt-1';

  it('uses Tony items when order present', () => {
    const order = {
      items: [{ name: 'Баннер', price: 1000, quantity: '1', sum: 1000 }],
      budget: '5000',
      start_date: '2025-03-15',
    };
    const data = {
      bookingNumbers: ['12345'],
      calParsed: { items: [{ name: 'Кофе-брейк', price: 100 }], meta: {}, contact: {}, event: {} },
      tonyOrders: new Map([['12345', order]]),
    };
    const deals = buildExportDealsFromEvent(event, eventId, data, ['ПРО'], keywords, blacklist);
    expect(deals).toHaveLength(1);
    expect(deals[0].exportId).toBe('evt-1#12345');
    expect(deals[0].items[0].name).toBe('Баннер');
  });

  it('falls back to calendar items when no Tony order', () => {
    const data = {
      bookingNumbers: [],
      calParsed: {
        items: [{ name: 'Печать наклеек', price: 500 }],
        meta: { budget: '3000' },
        contact: {},
        event: {},
      },
      tonyOrders: new Map(),
    };
    const deals = buildExportDealsFromEvent(event, eventId, data, ['ПРО'], keywords, blacklist);
    expect(deals).toHaveLength(1);
    expect(deals[0].exportId).toBe('evt-1#cal');
    expect(deals[0].items[0].name).toBe('Печать наклеек');
  });

  it('skips deal with no keyword_match items', () => {
    const data = {
      bookingNumbers: [],
      calParsed: { items: [{ name: 'Кофе' }], meta: {}, contact: {}, event: {} },
      tonyOrders: new Map(),
    };
    expect(buildExportDealsFromEvent(event, eventId, data, ['ПРО'], keywords, blacklist)).toEqual([]);
  });

  it('filters by company when companyFilter set', () => {
    const data = {
      bookingNumbers: [],
      calParsed: { items: [{ name: 'Баннер' }], meta: { budget: '1' }, contact: {}, event: {} },
      tonyOrders: new Map(),
    };
    expect(
      buildExportDealsFromEvent(event, eventId, data, ['ПРО'], keywords, blacklist, 'АРТ')
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix backend -- historical-export`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```js
// backend/src/services/historical-export.js
import { classifyByKeywords } from './classifier.js';
import { isBlacklisted } from './blacklist.js';
import { parseDealTitle } from './title-parser.js';
import { desiredDealKeys } from './tony-reconcile.js';
import { buildTonyDealFields, buildTonyItems } from './tony-mapping.js';

export function filterExportItems(items, blacklist = []) {
  return items.filter(
    (item) => item.classification === 'keyword_match' && !isBlacklisted(item.name, blacklist)
  );
}

export function buildExportDealsFromEvent(
  event,
  eventId,
  data,
  knownCodes,
  keywords,
  blacklist,
  companyFilter = null
) {
  const { calParsed, tonyOrders, bookingNumbers } = data;
  const titleInfo = parseDealTitle(event.title || '', knownCodes);
  if (companyFilter && titleInfo.companyCode !== companyFilter) return [];

  const targets = desiredDealKeys(eventId, bookingNumbers);
  const deals = [];

  for (const target of targets) {
    const order = target.bookingNumber ? tonyOrders.get(target.bookingNumber) : undefined;
    let classified;
    let start_date;
    let budget;

    if (order?.items?.length) {
      classified = classifyByKeywords(buildTonyItems(order), keywords);
      const fields = buildTonyDealFields(order);
      start_date = fields.start_date;
      budget = fields.budget;
    } else {
      if (!calParsed?.items?.length) continue;
      classified = classifyByKeywords(calParsed.items, keywords);
      start_date = event.start ?? event.start_date;
      budget = calParsed.meta?.budget ?? null;
    }

    const items = filterExportItems(classified, blacklist);
    if (items.length === 0) continue;

    deals.push({
      exportId: target.dealKey,
      title: event.title || '',
      company_code: titleInfo.companyCode,
      manager_name: titleInfo.managerName,
      start_date,
      budget,
      items,
    });
  }

  return deals;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --prefix backend -- historical-export`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/historical-export.js backend/tests/historical-export.test.js
git commit -m "feat(export): build in-memory export deals from calendar/Tony"
```

---

## Task 3: Excel workbook builder

**Files:**
- Modify: `backend/src/services/historical-export.js`
- Modify: `backend/package.json`
- Test: `backend/tests/historical-export.test.js`

- [ ] **Step 1: Install exceljs**

Run: `npm install exceljs --prefix backend`

- [ ] **Step 2: Write the failing test**

```js
// append to backend/tests/historical-export.test.js
import { buildExportWorkbook } from '../src/services/historical-export.js';
import ExcelJS from 'exceljs';

describe('buildExportWorkbook', () => {
  it('creates two sheets with Russian headers', async () => {
    const deals = [{
      exportId: 'e1#cal',
      title: 'Сделка А',
      company_code: 'ПРО',
      manager_name: 'Иванов',
      start_date: '2025-03-15T10:00:00+03:00',
      budget: '10000',
      items: [{ name: 'Баннер', price: 1000, quantity: '1', sum: 1000 }],
    }];
    const buffer = await buildExportWorkbook(deals, '2025-03-01', '2025-03-31');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    expect(wb.getWorksheet('Сделки').getRow(1).getCell(1).value).toBe('Дата начала');
    expect(wb.getWorksheet('Позиции').getRow(1).getCell(3).value).toBe('Позиция');
    expect(wb.getWorksheet('Сделки').rowCount).toBe(2);
    expect(wb.getWorksheet('Позиции').rowCount).toBe(2);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test --prefix backend -- historical-export`
Expected: FAIL — `buildExportWorkbook is not exported`

- [ ] **Step 4: Implement**

```js
// append to backend/src/services/historical-export.js
import ExcelJS from 'exceljs';
import { toInputDate } from '../utils/crm-dates.js';

function formatExportDate(iso) {
  const d = toInputDate(iso);
  if (!d) return '';
  const [y, m, day] = d.split('-');
  return `${day}.${m}.${y}`;
}

export async function buildExportWorkbook(deals, from, to) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CRM Parser';
  const dealsSheet = wb.addWorksheet('Сделки');
  const itemsSheet = wb.addWorksheet('Позиции');

  const dealHeaders = ['Дата начала', 'Название', 'Компания', 'Менеджер', 'Бюджет'];
  const itemHeaders = ['ID сделки', 'Название сделки', 'Позиция', 'Цена', 'Количество', 'Сумма'];

  dealsSheet.addRow(dealHeaders).font = { bold: true };
  itemsSheet.addRow(itemHeaders).font = { bold: true };

  const sorted = [...deals].sort(
    (a, b) => (parseEventDate(b.start_date)?.getTime() ?? 0) - (parseEventDate(a.start_date)?.getTime() ?? 0)
  );

  for (const deal of sorted) {
    dealsSheet.addRow([
      formatExportDate(deal.start_date),
      deal.title,
      deal.company_code,
      deal.manager_name,
      deal.budget,
    ]);
    for (const item of deal.items) {
      itemsSheet.addRow([
        deal.exportId,
        deal.title,
        item.name,
        item.price,
        item.quantity,
        item.sum,
      ]);
    }
  }

  dealsSheet.columns.forEach((col) => { col.width = 18; });
  itemsSheet.columns.forEach((col) => { col.width = 18; });

  return wb.xlsx.writeBuffer();
}

// add import at top:
import { parseEventDate } from '../utils/crm-dates.js';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test --prefix backend -- historical-export`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/src/services/historical-export.js backend/tests/historical-export.test.js
git commit -m "feat(export): generate two-sheet Russian Excel workbook"
```

---

## Task 4: Export job registry

**Files:**
- Create: `backend/src/services/export-jobs.js`
- Test: `backend/tests/export-jobs.test.js`

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/export-jobs.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import {
  createExportJob,
  getExportJob,
  updateExportJob,
  getActiveExportJob,
} from '../src/services/export-jobs.js';

describe('export-jobs', () => {
  beforeEach(() => {
    // reset in-memory store — export a resetForTests() from module
  });

  it('creates and retrieves a job', () => {
    const job = createExportJob({ from: '2025-01-01', to: '2025-01-31' });
    expect(getExportJob(job.jobId).status).toBe('queued');
  });

  it('tracks active job', () => {
    const job = createExportJob({ from: '2025-01-01', to: '2025-01-31' });
    updateExportJob(job.jobId, { status: 'running' });
    expect(getActiveExportJob()?.jobId).toBe(job.jobId);
    updateExportJob(job.jobId, { status: 'completed' });
    expect(getActiveExportJob()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix backend -- export-jobs`
Expected: FAIL

- [ ] **Step 3: Implement**

```js
// backend/src/services/export-jobs.js
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const EXPORTS_DIR = path.join(__dirname, '../../data/exports');

const jobs = new Map();

export function resetExportJobsForTests() {
  jobs.clear();
}

function ensureExportsDir() {
  fs.mkdirSync(EXPORTS_DIR, { recursive: true });
}

export function createExportJob({ from, to, company = null }) {
  const jobId = crypto.randomUUID();
  const job = {
    jobId,
    status: 'queued',
    from,
    to,
    company,
    progress: { eventsTotal: 0, eventsDone: 0, dealsMatched: 0 },
    error: null,
    filePath: null,
    createdAt: new Date().toISOString(),
    completedAt: null,
  };
  jobs.set(jobId, job);
  return job;
}

export function getExportJob(jobId) {
  return jobs.get(jobId) ?? null;
}

export function getActiveExportJob() {
  for (const job of jobs.values()) {
    if (job.status === 'queued' || job.status === 'running') return job;
  }
  return null;
}

export function updateExportJob(jobId, patch) {
  const job = jobs.get(jobId);
  if (!job) return null;
  Object.assign(job, patch);
  if (patch.progress) job.progress = { ...job.progress, ...patch.progress };
  return job;
}

export function setExportJobFile(jobId, buffer) {
  ensureExportsDir();
  const filePath = path.join(EXPORTS_DIR, `${jobId}.xlsx`);
  fs.writeFileSync(filePath, buffer);
  updateExportJob(jobId, { filePath });
  return filePath;
}

export function getExportJobFilePath(jobId) {
  const job = getExportJob(jobId);
  if (!job?.filePath || !fs.existsSync(job.filePath)) return null;
  return job.filePath;
}

export function deleteExportJobFile(jobId) {
  const job = getExportJob(jobId);
  if (job?.filePath && fs.existsSync(job.filePath)) {
    fs.unlinkSync(job.filePath);
    job.filePath = null;
  }
}
```

Add `beforeEach(() => resetExportJobsForTests())` in test file.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --prefix backend -- export-jobs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/export-jobs.js backend/tests/export-jobs.test.js
git commit -m "feat(export): in-memory export job registry"
```

---

## Task 5: `runHistoricalExport` orchestration

**Files:**
- Modify: `backend/src/services/historical-export.js`
- Test: `backend/tests/historical-export.test.js` (mocked integration)

- [ ] **Step 1: Implement `runHistoricalExport`**

```js
// backend/src/services/historical-export.js — add imports and function
import { authenticate } from './auth.js';
import { tonyLogin, getTonyConfig } from './tony-auth.js';
import { fetchEvents, fetchEventData, prefetchAll } from './parser.js';
import { loadCompanyCodes } from './companies.js';
import { loadBlacklist } from './blacklist.js';
import { getDb } from '../db/connection.js';
import { isEventInRange, normalizeExportRange, parseEventDate } from '../utils/crm-dates.js';
import { config } from '../config.js';
import { createPool } from './fetch-pool.js';
import { buildExportWorkbook } from './historical-export.js'; // same file
import { setExportJobFile, updateExportJob } from './export-jobs.js';
import { releaseParsingLock } from './parsing-lock.js';

function getSetting(key) {
  const db = getDb();
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value || '';
}

export async function runHistoricalExport(jobId, { from, to, company }) {
  const { start, end } = normalizeExportRange(from, to);
  updateExportJob(jobId, { status: 'running' });

  try {
    await authenticate();
    let tonyReady = false;
    const tonyCfg = getTonyConfig();
    if (tonyCfg.login && tonyCfg.password) {
      try { await tonyLogin(); tonyReady = true; } catch { /* calendar fallback */ }
    }

    const db = getDb();
    const keywords = JSON.parse(getSetting('keywords') || '[]');
    const blacklist = loadBlacklist(db);
    const knownCodes = loadCompanyCodes(db);

    const events = (await fetchEvents(start, end))
      .filter((e) => isEventInRange(e, start, end))
      .sort((a, b) => (parseEventDate(a.start)?.getTime() ?? 0) - (parseEventDate(b.start)?.getTime() ?? 0));

    updateExportJob(jobId, { progress: { eventsTotal: events.length, eventsDone: 0, dealsMatched: 0 } });

    let prefetched = null;
    if (config.parsePipeline === 'parallel') {
      const run = createPool({ concurrency: config.fetchConcurrency });
      prefetched = await prefetchAll(events, tonyReady, start, end, run);
    }

    const allDeals = [];
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      const eventId = String(event.original_id || event.id);
      if (!eventId) continue;

      const data = prefetched
        ? prefetched.get(eventId)
        : await fetchEventData(event, eventId, tonyReady);
      if (!data) {
        updateExportJob(jobId, { progress: { eventsDone: i + 1 } });
        continue;
      }

      const deals = buildExportDealsFromEvent(
        event, eventId, data, knownCodes, keywords, blacklist, company || null
      );
      allDeals.push(...deals);

      updateExportJob(jobId, {
        progress: { eventsDone: i + 1, dealsMatched: allDeals.length },
      });
    }

    const buffer = await buildExportWorkbook(allDeals, from, to);
    setExportJobFile(jobId, buffer);
    updateExportJob(jobId, { status: 'completed', completedAt: new Date().toISOString() });
  } catch (err) {
    updateExportJob(jobId, { status: 'failed', error: err.message, completedAt: new Date().toISOString() });
    throw err;
  } finally {
    releaseParsingLock();
  }
}
```

- [ ] **Step 2: Manual smoke** (no live CRM in CI)

Document in test file that `runHistoricalExport` is integration-tested manually; unit tests cover `buildExportDealsFromEvent` + workbook.

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/historical-export.js
git commit -m "feat(export): orchestrate historical calendar fetch and xlsx write"
```

---

## Task 6: REST routes

**Files:**
- Create: `backend/src/routes/export.js`
- Modify: `backend/src/index.js`
- Modify: `backend/src/routes/parsing.js` (ensure 409 message mentions export)

- [ ] **Step 1: Create router**

```js
// backend/src/routes/export.js
import { Router } from 'express';
import path from 'path';
import {
  createExportJob,
  getExportJob,
  getActiveExportJob,
  getExportJobFilePath,
  deleteExportJobFile,
} from '../services/export-jobs.js';
import { runHistoricalExport } from '../services/historical-export.js';
import {
  isParsingInProgress,
  tryAcquireParsingLock,
} from '../services/parsing-lock.js';
import { normalizeExportRange } from '../utils/crm-dates.js';

const router = Router();

router.post('/', (req, res) => {
  if (isParsingInProgress() || getActiveExportJob()) {
    return res.status(409).json({ error: 'Парсинг или выгрузка уже выполняется' });
  }
  if (!tryAcquireParsingLock()) {
    return res.status(409).json({ error: 'Парсинг или выгрузка уже выполняется' });
  }

  const { from, to, company } = req.body ?? {};
  try {
    normalizeExportRange(from, to);
  } catch (err) {
    releaseParsingLockOnError();
    return res.status(400).json({ error: err.message });
  }

  const job = createExportJob({ from, to, company: company || null });
  runHistoricalExport(job.jobId, { from, to, company: company || null }).catch((err) => {
    console.error(`[export] job ${job.jobId} failed:`, err.message);
  });

  res.status(201).json({ jobId: job.jobId });
});

function releaseParsingLockOnError() {
  import('../services/parsing-lock.js').then(({ releaseParsingLock }) => releaseParsingLock());
}

router.get('/active', (req, res) => {
  const job = getActiveExportJob();
  res.json(job ?? null);
});

router.get('/:jobId', (req, res) => {
  const job = getExportJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Задача не найдена' });
  res.json(job);
});

router.get('/:jobId/file', (req, res) => {
  const job = getExportJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Задача не найдена' });
  if (job.status !== 'completed') {
    return res.status(404).json({ error: 'Файл ещё не готов' });
  }
  const filePath = getExportJobFilePath(job.jobId);
  if (!filePath) return res.status(410).json({ error: 'Файл удалён' });

  const filename = `сделки_${job.from}_${job.to}.xlsx`;
  res.download(filePath, filename, (err) => {
    if (!err) deleteExportJobFile(job.jobId);
  });
});

export default router;
```

Fix: use static import for `releaseParsingLock` instead of dynamic helper — call `releaseParsingLock()` in catch of normalizeExportRange validation.

- [ ] **Step 2: Mount in index.js**

```js
import exportRouter from './routes/export.js';
// ...
app.use('/api/export', exportRouter);
```

- [ ] **Step 3: Add `data/exports/` to `.gitignore` if not present**

- [ ] **Step 4: Run all backend tests**

Run: `npm test --prefix backend`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/export.js backend/src/index.js .gitignore
git commit -m "feat(export): add REST API for background Excel export jobs"
```

---

## Task 7: Frontend API hooks

**Files:**
- Modify: `frontend/src/api.js`

- [ ] **Step 1: Add hooks**

```js
export function useStartExport() {
  return useMutation({
    mutationFn: (body) => api.post('/export', body).then((r) => r.data),
  });
}

export function useExportJob(jobId, { enabled = true } = {}) {
  return useQuery({
    queryKey: ['export-job', jobId],
    queryFn: () => api.get(`/export/${jobId}`).then((r) => r.data),
    enabled: enabled && !!jobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'queued' || status === 'running' ? 2000 : false;
    },
  });
}

export function useActiveExportJob() {
  return useQuery({
    queryKey: ['export-active'],
    queryFn: () => api.get('/export/active').then((r) => r.data),
  });
}

export function getExportDownloadUrl(jobId) {
  return `/api/export/${jobId}/file`;
}
```

Note: file download uses `window.location` or `<a href>` with Bearer — use blob fetch:

```js
export async function downloadExportFile(jobId, from, to) {
  const resp = await api.get(`/export/${jobId}/file`, { responseType: 'blob' });
  const url = URL.createObjectURL(resp.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = `сделки_${from}_${to}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/api.js
git commit -m "feat(export): add React Query hooks for export jobs"
```

---

## Task 8: Export page UI

**Files:**
- Create: `frontend/src/pages/Export.jsx`
- Modify: `frontend/src/components/ui/Icons.jsx`
- Modify: `frontend/src/App.jsx`

- [ ] **Step 1: Add IconExport to Icons.jsx**

Simple download/spreadsheet SVG; add to `navIcons`:

```js
export const navIcons = {
  '/': IconDashboard,
  '/deals': IconDeals,
  '/export': IconExport,
  '/settings': IconSettings,
  '/logs': IconLogs,
};
```

- [ ] **Step 2: Create Export.jsx**

Key behavior:
- State: `from`, `to`, `company`, `jobId`
- On mount: `useActiveExportJob` — if active job, set `jobId` to resume progress
- Form + «Запустить выгрузку» → `useStartExport`
- Show progress bar: `eventsDone / eventsTotal`, `dealsMatched`
- On `completed`: show warning if `dealsMatched === 0`, button «Скачать Excel» → `downloadExportFile`
- On `failed`: show `error`
- On 409: show «Парсинг или выгрузка уже выполняется»
- Use `useCompanies()` for company select (same pattern as `Deals.jsx`)
- No `min` date constraint on inputs (unlike Dashboard)

- [ ] **Step 3: Wire App.jsx**

```js
import Export from './pages/Export';
// navItems:
{ to: '/export', label: 'Выгрузка' },
// Routes:
<Route path="/export" element={<Export />} />
```

- [ ] **Step 4: Build frontend**

Run: `npm run build --prefix frontend`
Expected: success

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Export.jsx frontend/src/App.jsx frontend/src/components/ui/Icons.jsx
git commit -m "feat(export): add Export page with job progress and download"
```

---

## Task 9: End-to-end verification

- [ ] **Step 1: Run full test suite**

Run: `npm test --prefix backend`
Expected: all PASS

- [ ] **Step 2: Manual E2E checklist**

1. Start backend dev server with valid CRM cookies
2. Open `/export`, set past date range (e.g. last month)
3. Click «Запустить выгрузку» — progress updates
4. Download xlsx — two sheets, Russian headers
5. Confirm no new rows in `deals` table for that period
6. Start regular parsing on Dashboard — export POST returns 409 while parsing runs

- [ ] **Step 3: Final commit if any fixes**

```bash
git commit -m "fix(export): address E2E findings"
```

---

## Spec Coverage Checklist

| Spec requirement | Task |
|------------------|------|
| Past date range (no clamp) | Task 1 |
| No SQLite writes | Task 5 (no `applyEvent`) |
| No Twenty/approval | Task 5 |
| keyword_match + blacklist | Task 2 |
| Tony priority / calendar fallback | Task 2 |
| Two Excel sheets, Russian | Task 3 |
| Background job + progress | Tasks 4–6 |
| Shared CRM lock | Task 6 |
| `/export` page | Task 8 |
| Company filter optional | Tasks 2, 8 |
| Temp file cleanup on download | Task 6 |
