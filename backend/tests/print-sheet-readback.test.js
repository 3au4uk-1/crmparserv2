import { describe, it, expect } from 'vitest';
import {
  formatPlenkaFromCellA,
  parseSheetCheckbox,
  extractReadbackFromRow,
} from '../src/services/print-sheet-readback.js';

describe('formatPlenkaFromCellA', () => {
  it('returns sequential number from A', () => {
    expect(formatPlenkaFromCellA('295')).toBe('295');
  });

  it('returns not found when A empty', () => {
    expect(formatPlenkaFromCellA('')).toBe('Плёнка не найдена');
  });
});

describe('parseSheetCheckbox', () => {
  it('parses TRUE string', () => {
    expect(parseSheetCheckbox('TRUE')).toBe(true);
  });

  it('returns false for empty', () => {
    expect(parseSheetCheckbox('')).toBe(false);
  });
});

describe('extractReadbackFromRow', () => {
  it('reads A, F, W, X from A:X range row', () => {
    const cells = new Array(24).fill('');
    cells[0] = '295';
    cells[5] = 'TRUE';
    cells[22] = 'TRUE';
    cells[23] = 'FALSE';
    expect(extractReadbackFromRow(cells)).toEqual({
      plenkaText: '295',
      restavraciyaPechati: true,
      vzatoVRabotu: true,
      gotovo: false,
    });
  });
});
