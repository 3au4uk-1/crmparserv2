import { describe, it, expect } from 'vitest';
import { normalizePrintOrderName } from '../src/services/print-sheet-normalize.js';

describe('normalizePrintOrderName', () => {
  it('lowercases and strips punctuation', () => {
    const input = 'АРЕНДА/13.06/Эльвира/фудтрак/155409/Лучинова';
    expect(normalizePrintOrderName(input)).toBe(
      'аренда1306эльвирафудтрак155409лучинова'
    );
  });

  it('collapses whitespace', () => {
    expect(normalizePrintOrderName('  плашки   2шт  ')).toBe('плашки 2шт');
  });

  it('returns empty for blank', () => {
    expect(normalizePrintOrderName('')).toBe('');
    expect(normalizePrintOrderName(null)).toBe('');
  });
});
