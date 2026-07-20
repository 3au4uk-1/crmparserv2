# Twenty Excel Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/export-twenty` that fetches deal line items from Twenty CRM for a date range and downloads a one-sheet Russian Excel file (one row per position).

**Architecture:** Pure mappers in `twenty-export.js` turn GraphQL nodes into Excel rows (date = `closeDate` → `loadDate`, status = line-item stage → opportunity stage). Paginated GraphQL via `twenty-gql` + in-memory filter. Jobs reuse `export-jobs.js` with `kind: 'twenty'` so calendar export and Twenty export do not block each other. UI mirrors `Export.jsx` without company filter, with an «включая отмены» checkbox.

**Tech Stack:** Node.js ESM, Express 5, exceljs, vitest, React 19, TanStack Query. Spec: `docs/superpowers/specs/2026-07-20-twenty-excel-export-design.md`.

## Global Constraints

- Source of truth: Twenty GraphQL only (not SQLite, not calendar).
- One Excel row = one `dealLineItem`.
- Date filter field: `opportunity.closeDate`, fallback `opportunity.loadDate`; skip if both empty.
- Status: `dealLineItem.stage`, fallback `opportunity.stage`; Russian labels from `OPPORTUNITY_STAGE_OPTIONS`.
- Cancelled (`OTMENA`): excluded by default; `includeCancelled: true` includes them.
- Comment: `kommentariy`, fallback `kommentariyDlyaPechati`.
- Price columns: unit price + line sum (unit × quantity).
- Excel: one sheet, Russian headers, no status colors / date separator rows.
- Do not use `parsing-lock` for Twenty export.
- Calendar `/export` behavior unchanged.
- Filename: `twenty_заказы_YYYY-MM-DD_YYYY-MM-DD.xlsx`.

---

## File Structure

| File | Responsibility |
|------|----------------|
| **Create** `backend/src/services/twenty-export.js` | Mappers, GraphQL fetch, workbook, `runTwentyExport` |
| **Modify** `backend/src/services/export-jobs.js` | `kind` on jobs; `getActiveExportJob(kind)` |
| **Create** `backend/src/routes/export-twenty.js` | REST under `/api/export/twenty` |
| **Modify** `backend/src/index.js` | Mount Twenty export router **before** `/api/export` |
| **Create** `backend/tests/twenty-export.test.js` | Unit tests for mappers + workbook |
| **Modify** `backend/tests/export-jobs.test.js` | Kind-scoped active job |
| **Create** `frontend/src/pages/ExportTwenty.jsx` | UI |
| **Modify** `frontend/src/api.js` | Hooks + download helper |
| **Modify** `frontend/src/App.jsx` | Route + nav |
| **Modify** `frontend/src/components/ui/Icons.jsx` | Nav icon for `/export-twenty` |

---

### Task 1: Pure row mappers

**Files:**
- Create: `backend/src/services/twenty-export.js`
- Test: `backend/tests/twenty-export.test.js`

**Interfaces:**
- Produces:
  - `extractLinkUrl(link): string`
  - `amountMicrosToNumber(amount): number | null`
  - `resolveEffectiveDate(opportunity): string | null` — `YYYY-MM-DD` or null
  - `resolveEffectiveStage(lineItem, opportunity): string | null`
  - `resolveStageLabel(stage): string`
  - `resolveComment(lineItem): string`
  - `mapLineItemToRow(lineItem, { from, to, includeCancelled }): object | null`
  - `sortExportRows(rows): rows` (mutates copy: date ASC, name, position)

- [ ] **Step 1: Write the failing tests**

```js
// backend/tests/twenty-export.test.js
import { describe, it, expect } from 'vitest';
import {
  extractLinkUrl,
  amountMicrosToNumber,
  resolveEffectiveDate,
  resolveEffectiveStage,
  resolveStageLabel,
  resolveComment,
  mapLineItemToRow,
  sortExportRows,
} from '../src/services/twenty-export.js';

describe('extractLinkUrl', () => {
  it('reads primaryLinkUrl', () => {
    expect(extractLinkUrl({ primaryLinkUrl: 'https://a.example' })).toBe('https://a.example');
  });
  it('returns empty for null', () => {
    expect(extractLinkUrl(null)).toBe('');
  });
});

describe('amountMicrosToNumber', () => {
  it('converts micros to rubles', () => {
    expect(amountMicrosToNumber({ amountMicros: 1_500_000 })).toBe(1.5);
  });
  it('returns null when missing', () => {
    expect(amountMicrosToNumber(null)).toBeNull();
  });
});

describe('resolveEffectiveDate', () => {
  it('prefers closeDate over loadDate', () => {
    expect(
      resolveEffectiveDate({ closeDate: '2026-06-05', loadDate: '2026-06-01' })
    ).toBe('2026-06-05');
  });
  it('falls back to loadDate', () => {
    expect(resolveEffectiveDate({ closeDate: null, loadDate: '2026-06-01' })).toBe('2026-06-01');
  });
  it('returns null when both empty', () => {
    expect(resolveEffectiveDate({ closeDate: null, loadDate: null })).toBeNull();
  });
});

describe('resolveEffectiveStage / label', () => {
  it('prefers line item stage', () => {
    expect(resolveEffectiveStage({ stage: 'V_PECHATI' }, { stage: 'NOVYY' })).toBe('V_PECHATI');
  });
  it('falls back to opportunity stage', () => {
    expect(resolveEffectiveStage({ stage: null }, { stage: 'GOTOVO' })).toBe('GOTOVO');
  });
  it('maps known stage to Russian label', () => {
    expect(resolveStageLabel('OTMENA')).toBe('Отмена');
  });
});

describe('resolveComment', () => {
  it('prefers kommentariy', () => {
    expect(
      resolveComment({ kommentariy: 'A', kommentariyDlyaPechati: 'B' })
    ).toBe('A');
  });
  it('falls back to print comment', () => {
    expect(
      resolveComment({ kommentariy: '', kommentariyDlyaPechati: 'B' })
    ).toBe('B');
  });
});

describe('mapLineItemToRow', () => {
  const base = {
    name: 'Баннер',
    stage: 'NOVYY',
    kommentariy: 'ок',
    kommentariyDlyaPechati: null,
    kolichestvo: 2,
    amount: { amountMicros: 1_000_000 },
    ssylkaNaMakety: { primaryLinkUrl: 'https://disk.example/m' },
    opportunity: {
      name: 'АРЕНДА/тест',
      closeDate: '2026-06-04',
      loadDate: '2026-06-01',
      stage: 'V_RABOTE',
      tonyLink: { primaryLinkUrl: 'https://tony.example/1' },
      bitrixLink: { primaryLinkUrl: 'https://bitrix.example/1' },
    },
  };

  it('maps full row', () => {
    const row = mapLineItemToRow(base, {
      from: '2026-06-01',
      to: '2026-06-30',
      includeCancelled: false,
    });
    expect(row).toMatchObject({
      date: '2026-06-04',
      dateDisplay: '04.06.2026',
      opportunityName: 'АРЕНДА/тест',
      positionName: 'Баннер',
      layoutUrl: 'https://disk.example/m',
      comment: 'ок',
      unitPrice: 1,
      quantity: 2,
      lineSum: 2,
      statusLabel: 'Новый',
      tonyUrl: 'https://tony.example/1',
      bitrixUrl: 'https://bitrix.example/1',
    });
  });

  it('skips outside range', () => {
    expect(
      mapLineItemToRow(base, { from: '2026-07-01', to: '2026-07-31', includeCancelled: false })
    ).toBeNull();
  });

  it('skips cancelled unless includeCancelled', () => {
    const cancelled = {
      ...base,
      stage: 'OTMENA',
      opportunity: { ...base.opportunity, stage: 'OTMENA' },
    };
    expect(
      mapLineItemToRow(cancelled, { from: '2026-06-01', to: '2026-06-30', includeCancelled: false })
    ).toBeNull();
    expect(
      mapLineItemToRow(cancelled, { from: '2026-06-01', to: '2026-06-30', includeCancelled: true })
    ).not.toBeNull();
  });

  it('returns null lineSum when quantity missing', () => {
    const row = mapLineItemToRow(
      { ...base, kolichestvo: null },
      { from: '2026-06-01', to: '2026-06-30', includeCancelled: false }
    );
    expect(row.quantity).toBeNull();
    expect(row.lineSum).toBeNull();
  });
});

describe('sortExportRows', () => {
  it('sorts by date, name, position', () => {
    const rows = sortExportRows([
      { date: '2026-06-02', opportunityName: 'B', positionName: 'z' },
      { date: '2026-06-01', opportunityName: 'A', positionName: 'b' },
      { date: '2026-06-01', opportunityName: 'A', positionName: 'a' },
    ]);
    expect(rows.map((r) => r.positionName)).toEqual(['a', 'b', 'z']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --prefix backend -- twenty-export`

Expected: FAIL — module not found / exports missing

- [ ] **Step 3: Implement mappers**

```js
// backend/src/services/twenty-export.js
import { toInputDate } from '../utils/crm-dates.js';
import {
  OPPORTUNITY_STAGE_OPTIONS,
  CANCELLED_OPPORTUNITY_STAGE,
} from './twenty-opportunity.js';
import { LAYOUT_LINK_FIELD } from './print-sheet-field-names.js';
import { PRINT_COMMENT_FIELD } from './print-sheet-field-names.js';

const STAGE_LABEL_BY_VALUE = Object.fromEntries(
  OPPORTUNITY_STAGE_OPTIONS.map((o) => [o.value, o.label])
);

export function extractLinkUrl(link) {
  if (!link) return '';
  if (typeof link === 'string') return link;
  if (link.primaryLinkUrl) return link.primaryLinkUrl;
  if (Array.isArray(link.primaryLinks) && link.primaryLinks[0]) {
    return link.primaryLinks[0].primaryLinkUrl || link.primaryLinks[0].url || '';
  }
  return '';
}

export function amountMicrosToNumber(amount) {
  if (amount == null || amount.amountMicros == null) return null;
  const n = Number(amount.amountMicros) / 1_000_000;
  return Number.isFinite(n) ? n : null;
}

/** Normalize Twenty date/datetime to YYYY-MM-DD (CRM TZ via toInputDate). */
export function resolveEffectiveDate(opportunity) {
  const close = toInputDate(opportunity?.closeDate);
  if (close) return close;
  const load = toInputDate(opportunity?.loadDate);
  return load || null;
}

export function resolveEffectiveStage(lineItem, opportunity) {
  return lineItem?.stage || opportunity?.stage || null;
}

export function resolveStageLabel(stage) {
  if (!stage) return '';
  return STAGE_LABEL_BY_VALUE[stage] || stage;
}

export function resolveComment(lineItem) {
  const general = String(lineItem?.kommentariy ?? '').trim();
  if (general) return general;
  return String(lineItem?.[PRINT_COMMENT_FIELD] ?? lineItem?.kommentariyDlyaPechati ?? '').trim();
}

function formatDisplayDate(yyyyMmDd) {
  if (!yyyyMmDd) return '';
  const [y, m, d] = yyyyMmDd.split('-');
  return `${d}.${m}.${y}`;
}

function parseQuantity(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * @returns {object|null} Excel row or null if filtered out
 */
export function mapLineItemToRow(lineItem, { from, to, includeCancelled = false }) {
  const opportunity = lineItem?.opportunity ?? {};
  const date = resolveEffectiveDate(opportunity);
  if (!date) return null;
  if (date < from || date > to) return null;

  const stage = resolveEffectiveStage(lineItem, opportunity);
  if (!includeCancelled && stage === CANCELLED_OPPORTUNITY_STAGE) return null;

  const unitPrice = amountMicrosToNumber(lineItem.amount);
  const quantity = parseQuantity(lineItem.kolichestvo);
  const lineSum =
    unitPrice != null && quantity != null ? unitPrice * quantity : null;

  return {
    date,
    dateDisplay: formatDisplayDate(date),
    opportunityName: opportunity.name || '',
    positionName: lineItem.name || '',
    layoutUrl: extractLinkUrl(lineItem[LAYOUT_LINK_FIELD] ?? lineItem.ssylkaNaMakety),
    comment: resolveComment(lineItem),
    unitPrice,
    quantity,
    lineSum,
    status: stage,
    statusLabel: resolveStageLabel(stage),
    tonyUrl: extractLinkUrl(opportunity.tonyLink),
    bitrixUrl: extractLinkUrl(opportunity.bitrixLink),
  };
}

export function sortExportRows(rows) {
  return [...rows].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const byName = (a.opportunityName || '').localeCompare(b.opportunityName || '', 'ru');
    if (byName !== 0) return byName;
    return (a.positionName || '').localeCompare(b.positionName || '', 'ru');
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test --prefix backend -- twenty-export`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/twenty-export.js backend/tests/twenty-export.test.js
git commit -m "feat(export-twenty): add Twenty line-item Excel row mappers"
```

---

### Task 2: Excel workbook builder

**Files:**
- Modify: `backend/src/services/twenty-export.js`
- Test: `backend/tests/twenty-export.test.js`

**Interfaces:**
- Consumes: row shape from Task 1
- Produces: `buildTwentyExportWorkbook(rows): Promise<Buffer>`

- [ ] **Step 1: Write the failing test**

```js
// append to backend/tests/twenty-export.test.js
import ExcelJS from 'exceljs';
import { buildTwentyExportWorkbook } from '../src/services/twenty-export.js';

describe('buildTwentyExportWorkbook', () => {
  it('writes Russian headers and one data row with hyperlinks', async () => {
    const buffer = await buildTwentyExportWorkbook([
      {
        dateDisplay: '04.06.2026',
        opportunityName: 'Заказ',
        positionName: 'Баннер',
        layoutUrl: 'https://disk.example/m',
        comment: 'коммент',
        unitPrice: 100,
        lineSum: 200,
        quantity: 2,
        statusLabel: 'Новый',
        tonyUrl: 'https://tony.example/1',
        bitrixUrl: 'https://bitrix.example/1',
      },
    ]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const sheet = wb.getWorksheet('Заказы');
    expect(sheet.getRow(1).values.slice(1)).toEqual([
      'Дата',
      'Название',
      'Позиция',
      'Ссылка на макет',
      'Комментарий',
      'Цена за ед.',
      'Сумма позиции',
      'Количество',
      'Статус',
      'Ссылка на тони',
      'Ссылка на битрикс',
    ]);
    expect(sheet.getRow(2).getCell(1).value).toBe('04.06.2026');
    expect(sheet.getRow(2).getCell(4).value).toEqual({
      text: 'https://disk.example/m',
      hyperlink: 'https://disk.example/m',
    });
  });

  it('writes headers only when rows empty', async () => {
    const buffer = await buildTwentyExportWorkbook([]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    expect(wb.getWorksheet('Заказы').rowCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix backend -- twenty-export`

Expected: FAIL — `buildTwentyExportWorkbook` not exported

- [ ] **Step 3: Implement workbook**

```js
// append to backend/src/services/twenty-export.js
import ExcelJS from 'exceljs';

const HEADERS = [
  'Дата',
  'Название',
  'Позиция',
  'Ссылка на макет',
  'Комментарий',
  'Цена за ед.',
  'Сумма позиции',
  'Количество',
  'Статус',
  'Ссылка на тони',
  'Ссылка на битрикс',
];

function cellLink(url) {
  if (!url) return '';
  return { text: url, hyperlink: url };
}

export async function buildTwentyExportWorkbook(rows) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CRM Parser';
  const sheet = wb.addWorksheet('Заказы');
  sheet.addRow(HEADERS).font = { bold: true };

  for (const row of rows) {
    sheet.addRow([
      row.dateDisplay,
      row.opportunityName,
      row.positionName,
      cellLink(row.layoutUrl),
      row.comment,
      row.unitPrice,
      row.lineSum,
      row.quantity,
      row.statusLabel,
      cellLink(row.tonyUrl),
      cellLink(row.bitrixUrl),
    ]);
  }

  sheet.columns.forEach((col) => {
    col.width = 18;
  });

  return wb.xlsx.writeBuffer();
}
```

- [ ] **Step 4: Run tests**

Run: `npm test --prefix backend -- twenty-export`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/twenty-export.js backend/tests/twenty-export.test.js
git commit -m "feat(export-twenty): build Excel workbook for Twenty orders"
```

---

### Task 3: Job registry `kind` support

**Files:**
- Modify: `backend/src/services/export-jobs.js`
- Modify: `backend/src/routes/export.js` (pass `kind: 'calendar'` implicitly via default)
- Test: `backend/tests/export-jobs.test.js`

**Interfaces:**
- Produces:
  - `createExportJob({ from, to, company?, includeCancelled?, kind? })` — default `kind: 'calendar'`
  - `getActiveExportJob(kind = 'calendar')` — only jobs of that kind

Calendar route must keep calling `getActiveExportJob()` / `getActiveExportJob('calendar')` so a running Twenty job does **not** return 409 for calendar export.

- [ ] **Step 1: Write the failing tests**

```js
// append to backend/tests/export-jobs.test.js
it('scopes active job by kind', () => {
  const cal = createExportJob({ from: '2025-01-01', to: '2025-01-31', kind: 'calendar' });
  updateExportJob(cal.jobId, { status: 'running' });
  const tw = createExportJob({
    from: '2025-01-01',
    to: '2025-01-31',
    kind: 'twenty',
    includeCancelled: false,
  });
  updateExportJob(tw.jobId, { status: 'running' });

  expect(getActiveExportJob('calendar')?.jobId).toBe(cal.jobId);
  expect(getActiveExportJob('twenty')?.jobId).toBe(tw.jobId);
});

it('defaults kind to calendar', () => {
  const job = createExportJob({ from: '2025-01-01', to: '2025-01-31' });
  expect(job.kind).toBe('calendar');
  expect(getActiveExportJob()?.jobId).toBe(job.jobId);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --prefix backend -- export-jobs`

Expected: FAIL — `kind` ignored / twenty job collides

- [ ] **Step 3: Implement**

```js
// backend/src/services/export-jobs.js — replace createExportJob + getActiveExportJob

export function createExportJob({
  from,
  to,
  company = null,
  includeCancelled = false,
  kind = 'calendar',
}) {
  const jobId = crypto.randomUUID();
  const progress =
    kind === 'twenty'
      ? { pagesFetched: 0, lineItemsFetched: 0, rowsWritten: 0 }
      : { eventsTotal: 0, eventsDone: 0, dealsMatched: 0 };

  const job = {
    jobId,
    kind,
    status: 'queued',
    from,
    to,
    company,
    includeCancelled: kind === 'twenty' ? Boolean(includeCancelled) : undefined,
    progress,
    error: null,
    filePath: null,
    createdAt: new Date().toISOString(),
    completedAt: null,
  };
  jobs.set(jobId, job);
  return job;
}

export function getActiveExportJob(kind = 'calendar') {
  for (const job of jobs.values()) {
    if (job.kind !== kind) continue;
    if (job.status === 'queued' || job.status === 'running') return job;
  }
  return null;
}
```

Ensure existing calendar `routes/export.js` still works: `getActiveExportJob()` defaults to `'calendar'`. No change required there unless tests fail.

- [ ] **Step 4: Run tests**

Run: `npm test --prefix backend -- export-jobs`

Expected: PASS (including prior cases)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/export-jobs.js backend/tests/export-jobs.test.js
git commit -m "feat(export): scope export jobs by kind for Twenty vs calendar"
```

---

### Task 4: GraphQL fetch + `runTwentyExport`

**Files:**
- Modify: `backend/src/services/twenty-export.js`
- Test: `backend/tests/twenty-export.test.js` (mock `gql`)

**Interfaces:**
- Consumes: mappers + workbook + `export-jobs` + `requireTwentyConfig` + `gql`
- Produces:
  - `fetchAllDealLineItems(gqlFn, { onPage }): Promise<lineItem[]>`
  - `runTwentyExport(jobId, { from, to, includeCancelled }): Promise<void>`

GraphQL page size: `100`. Use cursor pagination (`after` / `pageInfo.endCursor` / `hasNextPage`). If Twenty returns no `pageInfo`, stop after first page with `< first` edges.

- [ ] **Step 1: Write the failing tests**

```js
// append to backend/tests/twenty-export.test.js
import { fetchAllDealLineItems, buildRowsFromLineItems } from '../src/services/twenty-export.js';

describe('fetchAllDealLineItems', () => {
  it('paginates until hasNextPage false', async () => {
    const calls = [];
    async function fakeGql(_url, _token, _query, variables) {
      calls.push(variables);
      if (!variables.after) {
        return {
          data: {
            data: {
              dealLineItems: {
                edges: [{ node: { id: '1' } }, { node: { id: '2' } }],
                pageInfo: { hasNextPage: true, endCursor: 'c1' },
              },
            },
          },
        };
      }
      return {
        data: {
          data: {
            dealLineItems: {
              edges: [{ node: { id: '3' } }],
              pageInfo: { hasNextPage: false, endCursor: 'c2' },
            },
          },
        },
      };
    }
    const items = await fetchAllDealLineItems(fakeGql, 'http://gql', 'tok', {
      pageSize: 2,
    });
    expect(items.map((i) => i.id)).toEqual(['1', '2', '3']);
    expect(calls).toHaveLength(2);
    expect(calls[1].after).toBe('c1');
  });
});

describe('buildRowsFromLineItems', () => {
  it('maps and sorts', () => {
    const rows = buildRowsFromLineItems(
      [
        {
          name: 'B',
          stage: 'NOVYY',
          kolichestvo: 1,
          amount: { amountMicros: 1_000_000 },
          opportunity: { name: 'Z', closeDate: '2026-06-02', stage: 'NOVYY' },
        },
        {
          name: 'A',
          stage: 'NOVYY',
          kolichestvo: 1,
          amount: { amountMicros: 1_000_000 },
          opportunity: { name: 'Z', closeDate: '2026-06-01', stage: 'NOVYY' },
        },
      ],
      { from: '2026-06-01', to: '2026-06-30', includeCancelled: false }
    );
    expect(rows.map((r) => r.positionName)).toEqual(['A', 'B']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test --prefix backend -- twenty-export`

Expected: FAIL — missing exports

- [ ] **Step 3: Implement fetch + runner**

```js
// append to backend/src/services/twenty-export.js
import { gql } from './twenty-gql.js';
import { requireTwentyConfig } from './twenty-config.js';
import { setExportJobFile, updateExportJob } from './export-jobs.js';
import { normalizeExportRange } from '../utils/crm-dates.js';

const LINE_ITEM_EXPORT_FIELDS = `
  id
  name
  stage
  kommentariy
  ${PRINT_COMMENT_FIELD}
  kolichestvo
  amount { amountMicros currencyCode }
  ${LAYOUT_LINK_FIELD} { primaryLinkUrl }
  opportunity {
    id
    name
    closeDate
    loadDate
    stage
    tonyLink { primaryLinkUrl }
    bitrixLink { primaryLinkUrl }
  }
`;

const LIST_LINE_ITEMS_PAGE = `
  query ListDealLineItemsForExport($first: Int!, $after: String) {
    dealLineItems(first: $first, after: $after) {
      edges { cursor node { ${LINE_ITEM_EXPORT_FIELDS} } }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

export async function fetchAllDealLineItems(
  gqlFn,
  apiUrl,
  apiToken,
  { pageSize = 100, onPage } = {}
) {
  const items = [];
  let after = null;
  let pagesFetched = 0;

  for (;;) {
    const resp = await gqlFn(apiUrl, apiToken, LIST_LINE_ITEMS_PAGE, {
      first: pageSize,
      after,
    });
    const connection = resp.data?.data?.dealLineItems;
    const edges = connection?.edges ?? [];
    for (const edge of edges) {
      if (edge?.node) items.push(edge.node);
    }
    pagesFetched += 1;
    onPage?.({ pagesFetched, lineItemsFetched: items.length });

    const pageInfo = connection?.pageInfo;
    if (!pageInfo?.hasNextPage || !pageInfo.endCursor) break;
    after = pageInfo.endCursor;
  }

  return items;
}

export function buildRowsFromLineItems(lineItems, options) {
  const rows = [];
  for (const item of lineItems) {
    const row = mapLineItemToRow(item, options);
    if (row) rows.push(row);
  }
  return sortExportRows(rows);
}

export async function runTwentyExport(jobId, { from, to, includeCancelled = false }) {
  normalizeExportRange(from, to);
  updateExportJob(jobId, { status: 'running' });

  try {
    const twenty = requireTwentyConfig();
    const lineItems = await fetchAllDealLineItems(
      gql,
      twenty.apiUrl,
      twenty.apiToken,
      {
        onPage: ({ pagesFetched, lineItemsFetched }) => {
          updateExportJob(jobId, {
            progress: { pagesFetched, lineItemsFetched },
          });
        },
      }
    );

    const rows = buildRowsFromLineItems(lineItems, { from, to, includeCancelled });
    const buffer = await buildTwentyExportWorkbook(rows);
    setExportJobFile(jobId, buffer);
    updateExportJob(jobId, {
      status: 'completed',
      completedAt: new Date().toISOString(),
      progress: {
        pagesFetched: undefined,
        lineItemsFetched: lineItems.length,
        rowsWritten: rows.length,
      },
    });
  } catch (err) {
    updateExportJob(jobId, {
      status: 'failed',
      error: err.message || String(err),
      completedAt: new Date().toISOString(),
    });
  }
}
```

Note: `updateExportJob` merges `progress` shallowly — ensure `rowsWritten` is set on complete. If merge keeps stale `pagesFetched`, that is fine for UI.

- [ ] **Step 4: Run tests**

Run: `npm test --prefix backend -- twenty-export`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/twenty-export.js backend/tests/twenty-export.test.js
git commit -m "feat(export-twenty): fetch Twenty line items and run export job"
```

---

### Task 5: REST API routes

**Files:**
- Create: `backend/src/routes/export-twenty.js`
- Modify: `backend/src/index.js`

**Interfaces:**
- Mount: `app.use('/api/export/twenty', exportTwentyRouter)` **before** `app.use('/api/export', exportRouter)`
- Endpoints:
  - `POST /` → `{ from, to, includeCancelled? }` → `201 { jobId }`
  - `GET /active` → job | null
  - `GET /:jobId` → job
  - `GET /:jobId/file` → download + delete file

- [ ] **Step 1: Implement router**

```js
// backend/src/routes/export-twenty.js
import { Router } from 'express';
import {
  createExportJob,
  getExportJob,
  getActiveExportJob,
  getExportJobFilePath,
  deleteExportJobFile,
} from '../services/export-jobs.js';
import { runTwentyExport } from '../services/twenty-export.js';
import { normalizeExportRange } from '../utils/crm-dates.js';
import { getTwentyConfig } from '../services/twenty-config.js';

const router = Router();

router.post('/', (req, res) => {
  if (getActiveExportJob('twenty')) {
    return res.status(409).json({ error: 'Выгрузка Twenty уже выполняется' });
  }

  const twenty = getTwentyConfig();
  if (!twenty.apiUrl || !twenty.apiToken) {
    return res.status(503).json({ error: 'Twenty CRM не настроен' });
  }

  const { from, to, includeCancelled = false } = req.body ?? {};
  try {
    normalizeExportRange(from, to);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const job = createExportJob({
    from,
    to,
    includeCancelled: Boolean(includeCancelled),
    kind: 'twenty',
  });
  runTwentyExport(job.jobId, {
    from,
    to,
    includeCancelled: Boolean(includeCancelled),
  }).catch((err) => {
    console.error(`[export-twenty] job ${job.jobId} failed:`, err.message);
  });

  res.status(201).json({ jobId: job.jobId });
});

router.get('/active', (req, res) => {
  res.json(getActiveExportJob('twenty') ?? null);
});

router.get('/:jobId', (req, res) => {
  const job = getExportJob(req.params.jobId);
  if (!job || job.kind !== 'twenty') {
    return res.status(404).json({ error: 'Задача не найдена' });
  }
  res.json(job);
});

router.get('/:jobId/file', (req, res) => {
  const job = getExportJob(req.params.jobId);
  if (!job || job.kind !== 'twenty') {
    return res.status(404).json({ error: 'Задача не найдена' });
  }
  if (job.status !== 'completed') {
    return res.status(404).json({ error: 'Файл ещё не готов' });
  }
  const filePath = getExportJobFilePath(job.jobId);
  if (!filePath) return res.status(410).json({ error: 'Файл удалён' });

  const filename = `twenty_заказы_${job.from}_${job.to}.xlsx`;
  res.download(filePath, filename, (err) => {
    if (!err) deleteExportJobFile(job.jobId);
  });
});

export default router;
```

```js
// backend/src/index.js — add import and mount BEFORE /api/export
import exportTwentyRouter from './routes/export-twenty.js';
// ...
app.use('/api/export/twenty', exportTwentyRouter);
app.use('/api/export', exportRouter);
```

- [ ] **Step 2: Smoke-check route registration (optional manual)**

Start server briefly or add a small supertest if the project already uses it for routes. Prefer manual: ensure `POST /api/export/twenty` is not captured by calendar `/:jobId`.

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/export-twenty.js backend/src/index.js
git commit -m "feat(export-twenty): add REST API for Twenty Excel export jobs"
```

---

### Task 6: Frontend page + API hooks

**Files:**
- Create: `frontend/src/pages/ExportTwenty.jsx`
- Modify: `frontend/src/api.js`
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/components/ui/Icons.jsx`

- [ ] **Step 1: Add API helpers** (after calendar export helpers in `frontend/src/api.js`)

```js
export function useStartTwentyExport() {
  return useMutation({
    mutationFn: (body) => api.post('/export/twenty', body).then((r) => r.data),
  });
}

export function useTwentyExportJob(jobId, { enabled = true } = {}) {
  return useQuery({
    queryKey: ['export-twenty-job', jobId],
    queryFn: () => api.get(`/export/twenty/${jobId}`).then((r) => r.data),
    enabled: enabled && !!jobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'queued' || status === 'running' ? 2000 : false;
    },
  });
}

export function useActiveTwentyExportJob() {
  return useQuery({
    queryKey: ['export-twenty-active'],
    queryFn: () => api.get('/export/twenty/active').then((r) => r.data),
  });
}

export async function downloadTwentyExportFile(jobId, from, to) {
  const resp = await api.get(`/export/twenty/${jobId}/file`, { responseType: 'blob' });
  const url = URL.createObjectURL(resp.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = `twenty_заказы_${from}_${to}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 2: Create `ExportTwenty.jsx`**

Mirror `Export.jsx` structure:
- `PageHeader` title «Выгрузка Twenty», description про заказы из Twenty за период
- date from/to
- checkbox «включая отмены» (default unchecked)
- submit «Сформировать»
- progress: pages / line items / rowsWritten
- empty-result warning when `rowsWritten === 0`
- download button
- restore active job via `useActiveTwentyExportJob`

Key submit body:

```js
startExport.mutate(
  { from, to, includeCancelled },
  {
    onSuccess: (data) => setJobId(data.jobId),
    onError: (err) => {
      if (err.response?.status === 409) {
        setStartError('Выгрузка Twenty уже выполняется');
        return;
      }
      if (err.response?.status === 503) {
        setStartError('Twenty CRM не настроен');
        return;
      }
      setStartError(err.response?.data?.error || err.message || 'Не удалось запустить выгрузку');
    },
  }
);
```

- [ ] **Step 3: Wire navigation**

```js
// App.jsx
import ExportTwenty from './pages/ExportTwenty';

const navItems = [
  // ...
  { to: '/export', label: 'Выгрузка' },
  { to: '/export-twenty', label: 'Выгрузка Twenty' },
  // ...
];

// routes:
<Route path="/export-twenty" element={<ExportTwenty />} />
```

```js
// Icons.jsx — reuse IconExport for both paths
'/export': IconExport,
'/export-twenty': IconExport,
```

- [ ] **Step 4: Manual UI check**

1. Open `/export-twenty`
2. Invalid dates → client or 400 error
3. With Twenty configured: start job, wait for completed, download xlsx
4. Confirm calendar `/export` still works while Twenty job idle
5. Confirm two jobs of different kinds can conceptually run (no shared lock)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/ExportTwenty.jsx frontend/src/api.js frontend/src/App.jsx frontend/src/components/ui/Icons.jsx
git commit -m "feat(export-twenty): add Twenty Excel export page"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| One row per dealLineItem | 1, 2 |
| Date closeDate → loadDate | 1 |
| Status line → opportunity | 1 |
| includeCancelled checkbox default off | 1, 5, 6 |
| Comment fallback | 1 |
| Unit price + line sum | 1, 2 |
| Russian headers, no colors | 2 |
| Separate `/export-twenty` UI | 6 |
| Job + file download | 3, 4, 5 |
| No parsing-lock | 5 |
| Empty → headers only | 2, 6 |
| Twenty credentials check | 5 |
| Filename `twenty_заказы_...` | 5, 6 |
| Route not shadowed by `/export/:jobId` | 5 |

---

## Self-review notes

- No TBD placeholders.
- `getActiveExportJob` default `'calendar'` preserves existing calendar tests/routes.
- `PRINT_COMMENT_FIELD` / `LAYOUT_LINK_FIELD` imported from existing print-sheet constants (avoid hardcoding drift).
- In-memory date filter after full pagination matches approved spec v1.
