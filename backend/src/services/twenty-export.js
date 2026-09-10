import ExcelJS from 'exceljs';
import { normalizeExportRange, toInputDate } from '../utils/crm-dates.js';
import {
  OPPORTUNITY_STAGE_OPTIONS,
  CANCELLED_OPPORTUNITY_STAGE,
} from './twenty-opportunity.js';
import { LAYOUT_LINK_FIELD } from './print-sheet-field-names.js';
import { PRINT_COMMENT_FIELD } from './print-sheet-field-names.js';
import { assertGqlSuccess, assertHttpSuccess, gql } from './twenty-gql.js';
import { requireTwentyConfig } from './twenty-config.js';
import { getExportJob, setExportJobFile, updateExportJob } from './export-jobs.js';
import { EXPENSE_FIELDS } from './expense-field-names.js';
import { isRestorationItem, loadRestorationList } from './restoration.js';
import { getDb } from '../db/connection.js';

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

const DEAL_EXPENSE_ROW_KEYS = [
  EXPENSE_FIELDS.printing,
  EXPENSE_FIELDS.milling,
  EXPENSE_FIELDS.logistics,
  EXPENSE_FIELDS.fieldTeam,
  EXPENSE_FIELDS.beznal,
  EXPENSE_FIELDS.total,
];

const DEAL_ONCE_ROW_KEYS = [...DEAL_EXPENSE_ROW_KEYS, 'amountDeal'];

/**
 * @returns {object|null} Excel row or null if filtered out
 */
export function mapLineItemToRow(lineItem, {
  from,
  to,
  includeCancelled = false,
  includeRestoration = false,
  restorationList = [],
}) {
  const opportunity = lineItem?.opportunity ?? {};
  const date = resolveEffectiveDate(opportunity);
  if (!date) return null;
  if (date < from || date > to) return null;

  const stage = resolveEffectiveStage(lineItem, opportunity);
  if (!includeCancelled && stage === CANCELLED_OPPORTUNITY_STAGE) return null;

  if (!includeRestoration && isRestorationItem(lineItem?.name, restorationList)) {
    return null;
  }

  const unitPrice = amountMicrosToNumber(lineItem.amount);
  const quantity = parseQuantity(lineItem.kolichestvo);
  const lineSum =
    unitPrice != null && quantity != null ? unitPrice * quantity : null;

  const opportunityId = opportunity.id || null;

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
    opportunityId,
    amountDeal: amountMicrosToNumber(opportunity.amount),
    ...Object.fromEntries(
      DEAL_EXPENSE_ROW_KEYS.map((key) => [key, amountMicrosToNumber(opportunity[key])])
    ),
  };
}

function clearDealExpenses(row) {
  const next = { ...row };
  for (const key of DEAL_ONCE_ROW_KEYS) next[key] = null;
  return next;
}

export function attachDealExpensesOnce(rows) {
  const seen = new Set();
  return rows.map((row, index) => {
    const key = row.opportunityId == null ? `__row_${index}` : row.opportunityId;
    if (seen.has(key)) return clearDealExpenses(row);
    seen.add(key);
    return { ...row };
  });
}

export function sortExportRows(rows) {
  return [...rows].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    const byName = (a.opportunityName || '').localeCompare(b.opportunityName || '', 'ru');
    if (byName !== 0) return byName;
    return (a.positionName || '').localeCompare(b.positionName || '', 'ru');
  });
}

export const TWENTY_EXPORT_COLUMNS = [
  { key: 'date', header: 'Дата', sheets: ['lineItems', 'deals'], rowKey: 'dateDisplay' },
  { key: 'opportunityName', header: 'Название', sheets: ['lineItems', 'deals'] },
  { key: 'positionName', header: 'Позиция', sheets: ['lineItems'] },
  { key: 'layoutUrl', header: 'Ссылка на макет', sheets: ['lineItems'], kind: 'link' },
  { key: 'comment', header: 'Комментарий', sheets: ['lineItems'] },
  { key: 'unitPrice', header: 'Цена за ед.', sheets: ['lineItems'] },
  { key: 'lineSum', header: 'Сумма позиции', sheets: ['lineItems'] },
  { key: 'quantity', header: 'Количество', sheets: ['lineItems'] },
  { key: 'status', header: 'Статус', sheets: ['lineItems', 'deals'], rowKey: 'statusLabel' },
  { key: 'tonyUrl', header: 'Ссылка на тони', sheets: ['lineItems', 'deals'], kind: 'link' },
  { key: 'bitrixUrl', header: 'Ссылка на битрикс', sheets: ['lineItems', 'deals'], kind: 'link' },
  { key: EXPENSE_FIELDS.printing, header: 'Расход: печать', sheets: ['lineItems', 'deals'] },
  { key: EXPENSE_FIELDS.milling, header: 'Расход: фреза', sheets: ['lineItems', 'deals'] },
  { key: EXPENSE_FIELDS.logistics, header: 'Расход: логистика', sheets: ['lineItems', 'deals'] },
  { key: EXPENSE_FIELDS.fieldTeam, header: 'Расход: выездная команда', sheets: ['lineItems', 'deals'] },
  { key: EXPENSE_FIELDS.beznal, header: 'Расход: безнал', sheets: ['lineItems', 'deals'] },
  { key: EXPENSE_FIELDS.total, header: 'Расход итого', sheets: ['lineItems', 'deals'] },
  { key: 'amountDeal', header: 'Сумма сделки', sheets: ['lineItems', 'deals'] },
];

const COLUMN_BY_KEY = new Map(TWENTY_EXPORT_COLUMNS.map((col) => [col.key, col]));

export function resolveExportColumns(requested) {
  if (requested == null || (Array.isArray(requested) && requested.length === 0)) {
    return TWENTY_EXPORT_COLUMNS;
  }
  if (!Array.isArray(requested)) {
    throw new Error('columns должен быть массивом ключей');
  }
  const unknown = requested.filter((key) => !COLUMN_BY_KEY.has(key));
  if (unknown.length) {
    throw new Error(`Неизвестные колонки: ${unknown.join(', ')}`);
  }
  const selected = new Set(requested);
  return TWENTY_EXPORT_COLUMNS.filter((col) => selected.has(col.key));
}

export function buildDealExportRows(rows) {
  const seen = new Set();
  const deals = [];
  rows.forEach((row, index) => {
    const key = row.opportunityId == null ? `__row_${index}` : row.opportunityId;
    if (seen.has(key)) return;
    seen.add(key);
    deals.push(row);
  });
  return deals;
}

function cellLink(url) {
  if (!url) return '';
  return { text: url, hyperlink: url };
}

function cellValue(row, column) {
  const value = row[column.rowKey || column.key];
  if (column.kind === 'link') return cellLink(value);
  return value ?? null;
}

function addExportSheet(wb, name, rows, columns) {
  const sheet = wb.addWorksheet(name);
  sheet.addRow(columns.map((col) => col.header)).font = { bold: true };
  for (const row of rows) {
    sheet.addRow(columns.map((col) => cellValue(row, col)));
  }
  sheet.columns.forEach((col) => {
    col.width = 18;
  });
  return sheet;
}

export async function buildTwentyExportWorkbook(
  rows,
  { columns = TWENTY_EXPORT_COLUMNS, includeDealsSheet = false } = {}
) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CRM Parser';
  addExportSheet(wb, 'Заказы', rows, columns.filter((col) => col.sheets.includes('lineItems')));
  if (includeDealsSheet) {
    const dealColumns = columns.filter((col) => col.sheets.includes('deals'));
    if (dealColumns.length) {
      addExportSheet(wb, 'Сделки', buildDealExportRows(rows), dealColumns);
    }
  }
  return wb.xlsx.writeBuffer();
}

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
    ${EXPENSE_FIELDS.printing} { amountMicros }
    ${EXPENSE_FIELDS.milling} { amountMicros }
    ${EXPENSE_FIELDS.logistics} { amountMicros }
    ${EXPENSE_FIELDS.fieldTeam} { amountMicros }
    ${EXPENSE_FIELDS.beznal} { amountMicros }
    ${EXPENSE_FIELDS.total} { amountMicros }
    amount { amountMicros }
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
    const response = await gqlFn(apiUrl, apiToken, LIST_LINE_ITEMS_PAGE, {
      first: pageSize,
      after,
    });
    assertHttpSuccess(response, apiUrl);
    assertGqlSuccess(response, 'Twenty GraphQL request failed while fetching deal line items');

    const connection = response.data?.data?.dealLineItems;
    if (!connection) {
      throw new Error('Twenty GraphQL response is missing dealLineItems');
    }

    const edges = connection.edges ?? [];
    for (const edge of edges) {
      if (edge?.node) items.push(edge.node);
    }

    pagesFetched += 1;
    onPage?.({ pagesFetched, lineItemsFetched: items.length });

    const pageInfo = connection.pageInfo;
    if (pageInfo) {
      if (!pageInfo.hasNextPage) break;
      if (!pageInfo.endCursor) {
        throw new Error(
          'Twenty GraphQL response has hasNextPage but is missing endCursor for dealLineItems'
        );
      }
      after = pageInfo.endCursor;
      continue;
    }

    if (edges.length < pageSize) break;
    const lastCursor = edges.at(-1)?.cursor;
    if (!lastCursor) {
      throw new Error('Twenty GraphQL response is missing a cursor for a full dealLineItems page');
    }
    after = lastCursor;
  }

  return items;
}

export function buildRowsFromLineItems(lineItems, options) {
  const rows = [];
  for (const lineItem of lineItems) {
    const row = mapLineItemToRow(lineItem, options);
    if (row) rows.push(row);
  }
  return attachDealExpensesOnce(sortExportRows(rows));
}

export async function runTwentyExport(
  jobId,
  { from, to, includeCancelled = false, includeRestoration = false, columns, includeDealsSheet = false },
  {
    gqlFn = gql,
    requireTwentyConfigFn = requireTwentyConfig,
    getDbFn = getDb,
    loadRestorationListFn = loadRestorationList,
  } = {},
) {
  updateExportJob(jobId, { status: 'running' });

  try {
    normalizeExportRange(from, to);
    const twenty = requireTwentyConfigFn();
    const lineItems = await fetchAllDealLineItems(gqlFn, twenty.apiUrl, twenty.apiToken, {
      onPage: ({ pagesFetched, lineItemsFetched }) => {
        updateExportJob(jobId, {
          progress: { pagesFetched, lineItemsFetched },
        });
      },
    });
    const restorationList = includeRestoration ? [] : loadRestorationListFn(getDbFn());
    const rows = buildRowsFromLineItems(lineItems, {
      from,
      to,
      includeCancelled,
      includeRestoration,
      restorationList,
    });
    const resolvedColumns = resolveExportColumns(columns);
    const buffer = await buildTwentyExportWorkbook(rows, {
      columns: resolvedColumns,
      includeDealsSheet: Boolean(includeDealsSheet),
    });

    setExportJobFile(jobId, buffer);
    const pagesFetched = getExportJob(jobId)?.progress?.pagesFetched ?? 0;
    updateExportJob(jobId, {
      status: 'completed',
      completedAt: new Date().toISOString(),
      progress: {
        pagesFetched,
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
