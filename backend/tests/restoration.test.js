import { describe, it, expect } from 'vitest';
import {
  matchesRestorationEntry,
  findRestorationMatch,
  isRestorationItem,
} from '../src/services/restoration.js';
import { normalizePattern } from '../src/services/blacklist.js';

describe('restoration matching', () => {
  const entries = [
    { id: 1, pattern: 'колесо фортуны', matchType: 'exact' },
    { id: 2, pattern: 'реставр', matchType: 'substring' },
  ];

  it('reuses normalizePattern from blacklist', () => {
    expect(normalizePattern('  Колесо  ')).toBe('колесо');
  });

  it('exact match is case-insensitive', () => {
    expect(matchesRestorationEntry('Колесо фортуны', entries[0])).toBe(true);
    expect(matchesRestorationEntry('Колесо фортуны XL', entries[0])).toBe(false);
  });

  it('substring match finds fragment', () => {
    expect(matchesRestorationEntry('Проверка реставрации стойки', entries[1])).toBe(true);
    expect(matchesRestorationEntry('Новая стойка', entries[1])).toBe(false);
  });

  it('findRestorationMatch returns first entry by list order', () => {
    const match = findRestorationMatch('Колесо фортуны', entries);
    expect(match?.id).toBe(1);
  });

  it('isRestorationItem returns boolean', () => {
    expect(isRestorationItem('Баннер 3x6', entries)).toBe(false);
    expect(isRestorationItem('Колесо фортуны', entries)).toBe(true);
  });
});
