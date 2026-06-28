import { describe, it, expect } from 'vitest';
import {
  formatPlenkaFromCellA,
  parseSheetCheckbox,
  extractReadbackFromRow,
} from '../src/services/print-sheet-readback.js';

describe('formatPlenkaFromCellA', () => {
  it('formats line with sequential number from A', () => {
    expect(formatPlenkaFromCellA('Тайсон', '295')).toBe('Тайсон - 295');
  });

  it('returns not found when A empty', () => {
    expect(formatPlenkaFromCellA('Тайсон', '')).toBe('Плёнка не найдена');
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
  it('reads A, W, X from A:X range row', () => {
    const cells = new Array(24).fill('');
    cells[0] = '295';
    cells[22] = 'TRUE';
    cells[23] = 'FALSE';
    expect(extractReadbackFromRow(cells, 'Тайсон')).toEqual({
      plenkaText: 'Тайсон - 295',
      vzatoVRabotu: true,
      gotovo: false,
    });
  });
});
