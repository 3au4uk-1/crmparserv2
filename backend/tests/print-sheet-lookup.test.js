import { describe, it, expect } from 'vitest';
import {
  matchFilmsFromRows,
  formatPlenkaText,
  lineItemNameMatchesSheetType,
} from '../src/services/print-sheet-lookup.js';

describe('matchFilmsFromRows', () => {
  const rows = [
    ['№', 'Отдел', 'Название заказа', 'x', 'Что брендируется'],
    [6, 'Про', 'АРЕНДА/13.06/Тест/155409/Иванов', '', 'ростовая фигура'],
    [7, 'Про', 'АРЕНДА/13.06/Тест/155409/Иванов', '', 'плашки'],
    [8, 'Про', 'АРЕНДА/13.06/Тест/155409/Иванов', '', 'плашки'],
    [99, 'Про', 'ДРУГОЙ ЗАКАЗ', '', 'баннер'],
  ];

  it('returns one entry per film number', () => {
    const matches = matchFilmsFromRows([rows], 'аренда1306тест155409иванов');
    expect(matches).toEqual([
      { type: 'ростовая фигура', film: 6 },
      { type: 'плашки', film: 7 },
      { type: 'плашки', film: 8 },
    ]);
  });

  it('uses без названия when type empty', () => {
    const r = [
      ['h', 'h', 'h', 'h', 'h'],
      [12, '', 'ORDER/1', '', ''],
    ];
    const matches = matchFilmsFromRows([r], 'order1');
    expect(matches[0].type).toBe('без названия');
  });

  it('filters rows by line item name when provided', () => {
    const matches = matchFilmsFromRows([rows], 'аренда1306тест155409иванов', 'плашки');
    expect(matches).toEqual([
      { type: 'плашки', film: 7 },
      { type: 'плашки', film: 8 },
    ]);
  });
});

describe('lineItemNameMatchesSheetType', () => {
  it('matches exact and partial names', () => {
    expect(lineItemNameMatchesSheetType('плашки', 'плашки')).toBe(true);
    expect(lineItemNameMatchesSheetType('Печать плашки А4', 'плашки')).toBe(true);
    expect(lineItemNameMatchesSheetType('ростовая фигура', 'плашки')).toBe(false);
  });
});

describe('formatPlenkaText', () => {
  it('formats one line per film', () => {
    const text = formatPlenkaText([
      { type: 'плашки', film: 7 },
      { type: 'плашки', film: 8 },
    ]);
    expect(text).toBe('7\n8');
  });

  it('returns not found message when empty', () => {
    expect(formatPlenkaText([])).toBe('Плёнка не найдена');
  });
});
