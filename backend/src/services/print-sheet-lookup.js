import { config } from '../config.js';
import { normalizePrintOrderName } from './print-sheet-normalize.js';
import { buildPrintSheetTabNames } from './print-sheet-tabs.js';
import { getPrintSheetClient } from './print-sheet-client.js';

const COL_FILM = 0;
const COL_ORDER = 2;
const COL_TYPE = 4;

let sheetCache = { key: '', fetchedAt: 0, rowsByTab: {} };

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

export async function fetchRowsForTabs(tabNames) {
  const client = getPrintSheetClient();
  if (!client || !config.printSheetId || !tabNames.length) return [];

  const cacheKey = tabNames.join('|');
  const now = Date.now();
  if (
    sheetCache.key === cacheKey &&
    now - sheetCache.fetchedAt < config.printSheetCacheTtlMs
  ) {
    return tabNames.map((t) => sheetCache.rowsByTab[t] || []);
  }

  const ranges = tabNames.map((t) => `'${t}'`);
  const resp = await client.spreadsheets.values.batchGet({
    spreadsheetId: config.printSheetId,
    ranges,
    majorDimension: 'ROWS',
  });

  const rowsByTab = {};
  const valueRanges = resp.data.valueRanges || [];
  for (let i = 0; i < tabNames.length; i++) {
    rowsByTab[tabNames[i]] = valueRanges[i]?.values || [];
  }

  sheetCache = { key: cacheKey, fetchedAt: now, rowsByTab };
  return tabNames.map((t) => rowsByTab[t] || []);
}

export async function lookupFilmsForOrder(orderName, closeDate) {
  const normalized = normalizePrintOrderName(orderName);
  if (!normalized) return [];

  const tabNames = buildPrintSheetTabNames(closeDate);
  const allRows = await fetchRowsForTabs(tabNames);
  return matchFilmsFromRows(allRows, normalized);
}

export async function lookupFilmsForLineItem(orderName, closeDate, lineItemName) {
  const normalized = normalizePrintOrderName(orderName);
  if (!normalized || !lineItemName) return [];

  const tabNames = buildPrintSheetTabNames(closeDate);
  const allRows = await fetchRowsForTabs(tabNames);
  return matchFilmsFromRows(allRows, normalized, lineItemName);
}

export function clearPrintSheetCacheForTests() {
  sheetCache = { key: '', fetchedAt: 0, rowsByTab: {} };
}
