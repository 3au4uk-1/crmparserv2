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
