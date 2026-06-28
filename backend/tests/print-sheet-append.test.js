import { describe, it, expect } from 'vitest';
import {
  parseRowNumberFromUpdatedRange,
  isPrintSheetCellEmpty,
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
