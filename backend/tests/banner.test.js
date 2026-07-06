import { describe, it, expect } from 'vitest';
import {
  matchesBannerEntry,
  findBannerMatch,
  isBannerItem,
  BANNER_TIP,
} from '../src/services/banner.js';
import { normalizePattern } from '../src/services/blacklist.js';

describe('banner matching', () => {
  const entries = [
    { id: 1, pattern: 'баннер 3x6', matchType: 'exact' },
    { id: 2, pattern: 'баннер', matchType: 'substring' },
  ];

  it('exports BANNER_TIP constant', () => {
    expect(BANNER_TIP).toBe('BANNERA');
  });

  it('reuses normalizePattern from blacklist', () => {
    expect(normalizePattern('  Баннер  ')).toBe('баннер');
  });

  it('exact match is case-insensitive', () => {
    expect(matchesBannerEntry('Баннер 3x6', entries[0])).toBe(true);
    expect(matchesBannerEntry('Баннер 3x3', entries[0])).toBe(false);
  });

  it('substring match finds fragment', () => {
    expect(matchesBannerEntry('Баннер с люверсами', entries[1])).toBe(true);
    expect(matchesBannerEntry('Пленка 3x6', entries[1])).toBe(false);
  });

  it('findBannerMatch returns first entry by list order', () => {
    const match = findBannerMatch('Баннер 3x6', entries);
    expect(match?.id).toBe(1);
  });

  it('isBannerItem returns boolean', () => {
    expect(isBannerItem('Пленка 3x6', entries)).toBe(false);
    expect(isBannerItem('Баннер 3x6', entries)).toBe(true);
  });
});
