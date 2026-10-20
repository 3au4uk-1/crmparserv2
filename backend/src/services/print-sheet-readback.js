import { config } from '../config.js';
import { getPrintSheetClient } from './print-sheet-client.js';
import { COL_A_INDEX, COL_F_INDEX, COL_W_INDEX, COL_X_INDEX } from './print-sheet-field-names.js';

export function formatPlenkaFromCellA(cellA) {
  const film = String(cellA ?? '').trim();
  if (!film) return 'Плёнка не найдена';
  return film;
}

export function parseSheetCheckbox(value) {
  if (value === true || value === 'TRUE' || value === 'true') return true;
  return false;
}

export function extractReadbackFromRow(cells) {
  const cellA = cells[COL_A_INDEX];
  const cellF = cells[COL_F_INDEX];
  const cellW = cells[COL_W_INDEX];
  const cellX = cells[COL_X_INDEX];
  return {
    plenkaText: formatPlenkaFromCellA(cellA),
    restavraciyaPechati: parseSheetCheckbox(cellF),
    vzatoVRabotu: parseSheetCheckbox(cellW),
    gotovo: parseSheetCheckbox(cellX),
  };
}

const DEFAULT_READ_TIMEOUT_MS = 20_000;
const MAX_READ_ATTEMPTS = 4;
const BATCH_RANGE_LIMIT = 80;

export function sheetRowRange(tabName, rowNumber) {
  const safe = String(tabName).replace(/'/g, "''");
  return `'${safe}'!A${rowNumber}:X${rowNumber}`;
}

export function rowKey(tabName, rowNumber) {
  return `${tabName}\0${rowNumber}`;
}

export function isSheetsQuotaError(err) {
  const status = Number(err?.code || err?.response?.status || err?.status);
  const message = String(err?.message || err?.response?.data?.error?.message || '');
  return status === 429 || status === 503 || /quota|rate limit|read requests per minute/i.test(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withReadBackoff(fn, { timeoutMs = DEFAULT_READ_TIMEOUT_MS, sleepFn = sleep } = {}) {
  const started = Date.now();
  let delay = 1000;
  let lastErr;
  for (let attempt = 1; attempt <= MAX_READ_ATTEMPTS; attempt += 1) {
    const remaining = timeoutMs - (Date.now() - started);
    if (remaining <= 0) break;
    let timer;
    try {
      const result = await Promise.race([
        fn(),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`Print sheet read timed out after ${timeoutMs}ms`)),
            remaining,
          );
        }),
      ]);
      clearTimeout(timer);
      return result;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      const timedOut = /timed out/i.test(String(err?.message || ''));
      if (!isSheetsQuotaError(err) && !timedOut) throw err;
      if (attempt === MAX_READ_ATTEMPTS || timedOut) break;
      const wait = Math.min(delay, Math.max(0, timeoutMs - (Date.now() - started)));
      if (wait <= 0) break;
      await sleepFn(wait);
      delay *= 2;
    }
  }
  throw lastErr || new Error('Print sheet read failed');
}

/**
 * One spreadsheets.values.batchGet for the requested rows (chunked).
 * A 429 backs off inside the overall timeout instead of issuing one read per row.
 */
export async function fetchPrintSheetRows(entries, options = {}) {
  const client = getPrintSheetClient();
  if (!client || !config.printSheetId) {
    throw new Error('Print sheet Google client not configured');
  }

  const unique = [];
  const seen = new Set();
  for (const entry of entries || []) {
    const key = rowKey(entry.tabName, entry.rowNumber);
    if (!entry.tabName || !entry.rowNumber || seen.has(key)) continue;
    seen.add(key);
    unique.push(entry);
  }

  const result = new Map();
  if (!unique.length) return result;

  for (let offset = 0; offset < unique.length; offset += BATCH_RANGE_LIMIT) {
    const chunk = unique.slice(offset, offset + BATCH_RANGE_LIMIT);
    const ranges = chunk.map((entry) => sheetRowRange(entry.tabName, entry.rowNumber));
    const resp = await withReadBackoff(
      () => client.spreadsheets.values.batchGet({
        spreadsheetId: config.printSheetId,
        ranges,
      }),
      options,
    );
    const valueRanges = resp.data?.valueRanges || [];
    chunk.forEach((entry, index) => {
      result.set(rowKey(entry.tabName, entry.rowNumber), valueRanges[index]?.values?.[0] ?? []);
    });
  }
  return result;
}

export async function fetchPrintSheetRow(tabName, rowNumber) {
  const rows = await fetchPrintSheetRows([{ tabName, rowNumber }]);
  return rows.get(rowKey(tabName, rowNumber)) ?? [];
}
