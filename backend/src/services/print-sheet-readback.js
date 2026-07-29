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

export async function fetchPrintSheetRow(tabName, rowNumber) {
  const client = getPrintSheetClient();
  if (!client || !config.printSheetId) {
    throw new Error('Print sheet Google client not configured');
  }

  const range = `'${tabName}'!A${rowNumber}:X${rowNumber}`;
  const resp = await client.spreadsheets.values.get({
    spreadsheetId: config.printSheetId,
    range,
  });

  return resp.data.values?.[0] ?? [];
}
