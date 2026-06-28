import { resolvePrintSheetDepartment } from './print-sheet-departments.js';
import { LAYOUT_LINK_FIELD, PRINT_COMMENT_FIELD } from './print-sheet-field-names.js';

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

function extractLayoutLinkUrl(layoutLink) {
  if (!layoutLink) return '';
  if (typeof layoutLink === 'string') return layoutLink;
  if (layoutLink.primaryLinkUrl) return layoutLink.primaryLinkUrl;
  if (Array.isArray(layoutLink)) {
    const first = layoutLink[0];
    if (typeof first === 'string') return first;
    return first?.primaryLinkUrl ?? first?.url ?? '';
  }
  if (Array.isArray(layoutLink?.primaryLinks)) {
    return layoutLink.primaryLinks[0]?.url ?? layoutLink.primaryLinks[0]?.primaryLinkUrl ?? '';
  }
  return '';
}

export function buildPrintSheetRowValues(lineItem) {
  const opp = lineItem.opportunity ?? {};
  const layoutUrl = extractLayoutLinkUrl(lineItem[LAYOUT_LINK_FIELD]);

  const printComment = String(lineItem[PRINT_COMMENT_FIELD] ?? '').trim();

  // B–J manager fields, K empty, L–O printer fields (skip), P print comment
  return [
    resolvePrintSheetDepartment(opp.companyId),
    opp.name ?? '',
    opp.bitrixLink?.primaryLinkUrl ?? '',
    lineItem.name ?? '',
    '',
    layoutUrl,
    formatUpdatedByName(lineItem.updatedBy),
    formatPrintReadyDate(lineItem.dataGotovnostiPechati),
    (lineItem.vremyaGotovnostiPechati ?? '').trim(),
    '',
    '',
    '',
    '',
    '',
    printComment,
  ];
}
