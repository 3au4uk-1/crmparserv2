import { google } from 'googleapis';
import { config } from '../config.js';
import { normalizePrintOrderName } from './print-sheet-normalize.js';
import { buildPrintSheetTabNames } from './print-sheet-tabs.js';

const COL_FILM = 0;
const COL_ORDER = 2;
const COL_TYPE = 4;

let sheetCache = { key: '', fetchedAt: 0, rowsByTab: {} };

export function matchFilmsFromRows(allRows, normalizedOrderName) {
  const seen = new Set();
  const matches = [];

  for (const rows of allRows) {
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const printOrder = normalizePrintOrderName(row[COL_ORDER]);
      if (printOrder !== normalizedOrderName) continue;

      const film = row[COL_FILM];
      if (film === '' || film == null) continue;

      const type = String(row[COL_TYPE] ?? '').trim() || 'без названия';
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

function getSheetsClient() {
  if (!config.googleServiceAccountEmail || !config.googleServiceAccountPrivateKey) {
    return null;
  }
  const auth = new google.auth.JWT({
    email: config.googleServiceAccountEmail,
    key: config.googleServiceAccountPrivateKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  return google.sheets({ version: 'v4', auth });
}

export async function fetchRowsForTabs(tabNames) {
  const client = getSheetsClient();
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

export function clearPrintSheetCacheForTests() {
  sheetCache = { key: '', fetchedAt: 0, rowsByTab: {} };
}
