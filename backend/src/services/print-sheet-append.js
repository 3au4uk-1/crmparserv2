import { config } from '../config.js';
import { getPrintSheetClient } from './print-sheet-client.js';

/** First data row on print sheet tabs (rows 1–2 are headers). */
export const PRINT_SHEET_FIRST_DATA_ROW = 3;

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
      ranges.push(`'${tabName}'!B${row}`);
    }

    const resp = await client.spreadsheets.values.batchGet({
      spreadsheetId: config.printSheetId,
      ranges,
    });

    const valueRanges = resp.data.valueRanges ?? [];
    for (let i = 0; i < valueRanges.length; i++) {
      const cell = valueRanges[i]?.values?.[0]?.[0];
      if (isPrintSheetCellEmpty(cell)) {
        return chunkStart + i;
      }
    }
  }

  return maxRow + 1;
}

/**
 * Write B–K into the first empty row (column B empty). Uses update, not append,
 * so values land in the correct columns and skip blank rows above the sheet tail.
 */
export async function writePrintSheetRow(tabName, rowValues, options = {}) {
  const client = getPrintSheetClient();
  if (!client || !config.printSheetId) {
    throw new Error('Print sheet Google client not configured');
  }

  const rowNumber =
    options.rowNumber ?? (await findFirstEmptyPrintSheetRow(tabName, options));
  const range = `'${tabName}'!B${rowNumber}:K${rowNumber}`;

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
