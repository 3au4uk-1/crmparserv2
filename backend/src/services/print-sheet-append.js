import { config } from '../config.js';
import { getPrintSheetClient } from './print-sheet-client.js';

/** First row allowed for data (rows 1–4 are sheet headers / reserved). */
export const PRINT_SHEET_FIRST_DATA_ROW = 5;

const DEFAULT_MAX_ROW_SCAN = 500;
const BATCH_GET_CHUNK_SIZE = 100;

export function parseRowNumberFromUpdatedRange(updatedRange) {
  if (!updatedRange) return null;
  const match = String(updatedRange).match(/![A-Z]+(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}

export function isPrintSheetCellEmpty(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

/** Columns B–P (15 cells) — same width as buildPrintSheetRowValues output. */
export const PRINT_SHEET_EXPORT_COLUMN_COUNT = 15;

/**
 * Offsets within a B–P row (0 = column B) for manager fields we export.
 * F is a sheet checkbox default (FALSE); K–O are printer columns — ignore for occupancy.
 */
export const PRINT_SHEET_MANAGER_COLUMN_OFFSETS = [0, 1, 2, 3, 5, 6, 7, 8, 14]; // B,C,D,E,G,H,I,J,P

/** Row is free for export when manager columns (B–E, G–J, P) are empty. */
export function isPrintSheetExportRowEmpty(cells) {
  if (!cells?.length) return true;
  const padded = [...cells];
  while (padded.length < PRINT_SHEET_EXPORT_COLUMN_COUNT) {
    padded.push(undefined);
  }
  return PRINT_SHEET_MANAGER_COLUMN_OFFSETS.every((idx) =>
    isPrintSheetCellEmpty(padded[idx])
  );
}

export async function findFirstEmptyPrintSheetRow(tabName, options = {}) {
  const client = getPrintSheetClient();
  if (!client || !config.printSheetId) {
    throw new Error('Print sheet Google client not configured');
  }

  const startRow = options.startRow ?? PRINT_SHEET_FIRST_DATA_ROW;
  const maxRow = options.maxRow ?? DEFAULT_MAX_ROW_SCAN;

  for (let chunkStart = startRow; chunkStart <= maxRow; chunkStart += BATCH_GET_CHUNK_SIZE) {
    const chunkEnd = Math.min(chunkStart + BATCH_GET_CHUNK_SIZE - 1, maxRow);
    const ranges = [];
    for (let row = chunkStart; row <= chunkEnd; row++) {
      ranges.push(`'${tabName}'!B${row}:P${row}`);
    }

    const resp = await client.spreadsheets.values.batchGet({
      spreadsheetId: config.printSheetId,
      ranges,
    });

    const valueRanges = resp.data.valueRanges ?? [];
    for (let i = 0; i < valueRanges.length; i++) {
      const cells = valueRanges[i]?.values?.[0] ?? [];
      if (isPrintSheetExportRowEmpty(cells)) {
        return chunkStart + i;
      }
    }
  }

  return maxRow + 1;
}

/**
 * Write B–P into the first row where manager export columns are empty,
 * so values land in the correct columns and skip blank rows above the sheet tail.
 */
export async function writePrintSheetRow(tabName, rowValues, options = {}) {
  const client = getPrintSheetClient();
  if (!client || !config.printSheetId) {
    throw new Error('Print sheet Google client not configured');
  }

  const rowNumber =
    options.rowNumber ?? (await findFirstEmptyPrintSheetRow(tabName, options));
  const range = `'${tabName}'!B${rowNumber}:P${rowNumber}`;

  await client.spreadsheets.values.update({
    spreadsheetId: config.printSheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [rowValues] },
  });

  return { rowNumber, updatedRange: range };
}

/** @deprecated Use writePrintSheetRow */
export async function appendPrintSheetRow(tabName, rowValues) {
  return writePrintSheetRow(tabName, rowValues);
}
