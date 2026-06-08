import { describe, it, expect } from 'vitest';
import {
  normalizePattern,
  matchesBlacklistEntry,
  findBlacklistMatch,
  isBlacklisted,
} from '../src/services/blacklist.js';

describe('blacklist matching', () => {
  const entries = [
    { id: 1, pattern: 'стойка указатель напольная а4', matchType: 'exact' },
    { id: 2, pattern: 'указатель', matchType: 'substring' },
  ];

  it('normalizes case and ё', () => {
    expect(normalizePattern('  СтЁйка  ')).toBe('стейка');
  });

  it('exact match is case-insensitive', () => {
    expect(
      matchesBlacklistEntry('Стойка указатель напольная А4', entries[0])
    ).toBe(true);
    expect(
      matchesBlacklistEntry('Стойка указатель напольная А40', entries[0])
    ).toBe(false);
  });

  it('substring match finds fragment', () => {
    expect(matchesBlacklistEntry('Стойка-указатель А3', entries[1])).toBe(true);
    expect(matchesBlacklistEntry('Стойка напольная', entries[1])).toBe(false);
  });

  it('findBlacklistMatch returns first entry by list order', () => {
    const match = findBlacklistMatch('Стойка указатель напольная А4', entries);
    expect(match?.id).toBe(1);
  });

  it('isBlacklisted returns boolean', () => {
    expect(isBlacklisted('любая стойка', entries)).toBe(false);
    expect(isBlacklisted('Стойка указатель напольная А4', entries)).toBe(true);
  });
});
