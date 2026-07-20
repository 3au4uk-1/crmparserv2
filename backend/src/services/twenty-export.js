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
