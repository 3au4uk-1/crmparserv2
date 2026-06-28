import { normalizePrintOrderName } from './print-sheet-normalize.js';

const COL_FILM = 0;
const COL_ORDER = 2;
const COL_TYPE = 4;

export function lineItemNameMatchesSheetType(lineItemName, sheetType) {
  const itemKey = normalizePrintOrderName(lineItemName);
  const typeKey = normalizePrintOrderName(sheetType);
  if (!itemKey || !typeKey) return false;
  if (itemKey === typeKey) return true;
  return itemKey.includes(typeKey) || typeKey.includes(itemKey);
}

export function matchFilmsFromRows(allRows, normalizedOrderName, lineItemName = null) {
  const seen = new Set();
  const matches = [];

  for (const rows of allRows) {
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const printOrder = normalizePrintOrderName(row[COL_ORDER]);
      if (printOrder !== normalizedOrderName) continue;

      const type = String(row[COL_TYPE] ?? '').trim() || 'без названия';
      if (lineItemName && !lineItemNameMatchesSheetType(lineItemName, type)) continue;

      const film = row[COL_FILM];
      if (film === '' || film == null) continue;

      const dedupeKey = `${type}|${film}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      matches.push({ type, film });
    }
  }

  return matches;
}

export function formatPlenkaText(matches) {
  if (!matches.length) return 'Плёнка не найдена';
  return matches.map(({ type, film }) => `${type} - ${film}`).join('\n');
}
