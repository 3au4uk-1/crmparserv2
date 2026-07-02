import { describe, it, expect } from 'vitest';
import {
  matchesPodryadEntry,
  findPodryadMatch,
  isPodryadItem,
  PODRYAD_TIP,
} from '../src/services/podryad.js';
import { normalizePattern } from '../src/services/blacklist.js';

describe('podryad matching', () => {
  const entries = [
    { id: 1, pattern: 'флаги односторонние на виндеры', matchType: 'exact' },
    { id: 2, pattern: 'изготовление', matchType: 'substring' },
  ];

  it('exports PODRYAD_TIP constant', () => {
    expect(PODRYAD_TIP).toBe('PODRYAD');
  });

  it('reuses normalizePattern from blacklist', () => {
    expect(normalizePattern('  Флаги  ')).toBe('флаги');
  });

  it('exact match is case-insensitive', () => {
    expect(matchesPodryadEntry('Флаги односторонние на виндеры', entries[0])).toBe(true);
    expect(matchesPodryadEntry('Флаги односторонние', entries[0])).toBe(false);
  });

  it('substring match finds fragment', () => {
    expect(matchesPodryadEntry('Изготовление гобо 3шт', entries[1])).toBe(true);
    expect(matchesPodryadEntry('Баннер 3x6', entries[1])).toBe(false);
  });

  it('findPodryadMatch returns first entry by list order', () => {
    const match = findPodryadMatch('Флаги односторонние на виндеры', entries);
    expect(match?.id).toBe(1);
  });

  it('isPodryadItem returns boolean', () => {
    expect(isPodryadItem('Баннер 3x6', entries)).toBe(false);
    expect(isPodryadItem('Флаги односторонние на виндеры', entries)).toBe(true);
  });
});
