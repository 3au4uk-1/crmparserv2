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
  return sortExportRows(rows);
}

export async function runTwentyExport(
  jobId,
  { from, to, includeCancelled = false },
  { gqlFn = gql, requireTwentyConfigFn = requireTwentyConfig } = {}
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
    const rows = buildRowsFromLineItems(lineItems, { from, to, includeCancelled });
    const buffer = await buildTwentyExportWorkbook(rows);

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
