import { describe, it, expect } from 'vitest';
import {
  parseRowNumberFromUpdatedRange,
  isPrintSheetCellEmpty,
  isPrintSheetExportRowEmpty,
  PRINT_SHEET_FIRST_DATA_ROW,
} from '../src/services/print-sheet-append.js';

describe('parseRowNumberFromUpdatedRange', () => {
  it('parses row from Sheets updatedRange', () => {
    expect(parseRowNumberFromUpdatedRange("'Июнь 2026'!B297:K297")).toBe(297);
  });

  it('returns null when range missing', () => {
    expect(parseRowNumberFromUpdatedRange(undefined)).toBeNull();
  });
});

describe('isPrintSheetCellEmpty', () => {
  it('treats undefined, null, and blank as empty', () => {
    expect(isPrintSheetCellEmpty(undefined)).toBe(true);
    expect(isPrintSheetCellEmpty(null)).toBe(true);
    expect(isPrintSheetCellEmpty('')).toBe(true);
    expect(isPrintSheetCellEmpty('   ')).toBe(true);
  });

  it('treats non-blank as occupied', () => {
    expect(isPrintSheetCellEmpty('Про')).toBe(false);
    expect(isPrintSheetCellEmpty(0)).toBe(false);
  });
});

describe('isPrintSheetExportRowEmpty', () => {
  it('returns true when all B–P cells are empty', () => {
    expect(isPrintSheetExportRowEmpty([])).toBe(true);
    expect(isPrintSheetExportRowEmpty(['', '', ''])).toBe(true);
  });

  it('returns false when B is empty but another export column has data', () => {
    const row = ['', 'ПРО/28.06/order name'];
    expect(isPrintSheetExportRowEmpty(row)).toBe(false);
  });

  it('returns false when any cell in B–P range has data', () => {
    const row = new Array(14).fill('');
    row.push('комментарий');
    expect(isPrintSheetExportRowEmpty(row)).toBe(false);
  });
});

describe('PRINT_SHEET_FIRST_DATA_ROW', () => {
  it('skips first 4 rows (headers reserved)', () => {
    expect(PRINT_SHEET_FIRST_DATA_ROW).toBe(5);
  });
});
