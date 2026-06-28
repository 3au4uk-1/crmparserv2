import { config } from '../config.js';
import { getPrintSheetClient } from './print-sheet-client.js';

export function parseRowNumberFromUpdatedRange(updatedRange) {
  if (!updatedRange) return null;
  const match = String(updatedRange).match(/![A-Z]+(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}

export async function appendPrintSheetRow(tabName, rowValues) {
  const client = getPrintSheetClient();
  if (!client || !config.printSheetId) {
    throw new Error('Print sheet Google client not configured');
  }

  const range = `'${tabName}'!B:K`;
  const resp = await client.spreadsheets.values.append({
    spreadsheetId: config.printSheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [rowValues] },
  });

  const rowNumber = parseRowNumberFromUpdatedRange(resp.data.updates?.updatedRange);
  if (!rowNumber) {
    throw new Error(`Could not parse row number from append response: ${resp.data.updates?.updatedRange}`);
  }

  return { rowNumber, updatedRange: resp.data.updates?.updatedRange };
}
