import { getDb } from '../db/connection.js';
import { config } from '../config.js';
import { parseSpreadsheetId } from './deal-expenses/spreadsheet-id.js';

/**
 * Freza production queue spreadsheet.
 * Prefer Settings UI `freza_sheet_id` (may be URL or raw id); fall back to FREZA_SHEET_ID env.
 * Empty → freza sheet cycle should no-op.
 */
export function resolveFrezaSheetId() {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = 'freza_sheet_id'").get();
  const fromSettings = String(row?.value ?? '').trim();
  if (fromSettings) {
    return parseSpreadsheetId(fromSettings) || fromSettings;
  }
  return String(config.frezaSheetId ?? '').trim();
}
