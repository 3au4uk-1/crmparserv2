import { resolvePrintSheetDepartment } from './print-sheet-departments.js';
import { LAYOUT_LINK_FIELD, PRINT_COMMENT_FIELD } from './print-sheet-field-names.js';
import { formatResponsibleFromUpdatedBy } from './print-sheet-responsible.js';
import { buildBitrixLinkInput } from './deal-bitrix-links.js';

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

/**
 * Resolve print-row deal label: parent name + canonical Bitrix when grouped.
 * @returns {{ name: string, bitrixUrl: string }}
 */
export function resolvePrintSheetDealLabel(db, opportunityId, fallbackOpp = {}) {
  const fallback = {
    name: fallbackOpp?.name ?? '',
    bitrixUrl: fallbackOpp?.bitrixLink?.primaryLinkUrl ?? '',
  };
  if (!db || !opportunityId) return fallback;

  const deal = db.prepare(
    'SELECT id FROM deals WHERE twenty_id = ? LIMIT 1',
  ).get(String(opportunityId));
  if (!deal) return fallback;

  const group = db.prepare(`
    SELECT g.name, g.canonical_bitrix_id
    FROM deal_group_members m
    JOIN deal_groups g ON g.id = m.group_id
    WHERE m.deal_id = ?
    LIMIT 1
  `).get(deal.id);
  if (!group) return fallback;

  const bitrixInput = buildBitrixLinkInput([
    { bitrixId: group.canonical_bitrix_id, isCanonical: true },
  ]);
  return {
    name: group.name,
    bitrixUrl: bitrixInput?.primaryLinkUrl ?? '',
  };
}

export function buildPrintSheetRowValues(lineItem, options = {}) {
  const { workspaceMemberById = {}, groupLabel } = options;
  const opp = lineItem.opportunity ?? {};
  const layoutUrl = extractLayoutLinkUrl(lineItem[LAYOUT_LINK_FIELD]);

  const printComment = String(lineItem[PRINT_COMMENT_FIELD] ?? '').trim();
  const dealName = groupLabel?.name ?? opp.name ?? '';
  const bitrixUrl = groupLabel?.bitrixUrl ?? opp.bitrixLink?.primaryLinkUrl ?? '';

  // B–J manager fields, K empty, L–O printer fields (skip), P print comment
  // Column F (index 4) = restoration checkbox
  return [
    resolvePrintSheetDepartment(opp.companyId),
    dealName,
    bitrixUrl,
    lineItem.name ?? '',
    lineItem.restavraciyaPechati === true ? 'TRUE' : 'FALSE',
    layoutUrl,
    formatResponsibleFromUpdatedBy(lineItem.updatedBy, workspaceMemberById),
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
