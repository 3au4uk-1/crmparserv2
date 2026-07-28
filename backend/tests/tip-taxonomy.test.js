import { describe, expect, it } from 'vitest';
import {
  isTipDetailValidForTip,
  resolveTipDetail,
} from '../src/services/tip-taxonomy.js';

describe('resolveTipDetail', () => {
  it('uses explicit valid tipDetail', () => {
    expect(resolveTipDetail({ tip: 'PODRYAD', tipDetail: 'LIZA_SUKNO' })).toBe('LIZA_SUKNO');
  });

  it('defaults PLENKA → NASHI when empty', () => {
    expect(resolveTipDetail({ tip: 'PLENKA', tipDetail: null })).toBe('NASHI');
  });

  it('defaults BANNERA → KTO_EDET when empty', () => {
    expect(resolveTipDetail({ tip: 'BANNERA', tipDetail: null })).toBe('KTO_EDET');
  });

  it('returns null for PODRYAD without detail (omit)', () => {
    expect(resolveTipDetail({ tip: 'PODRYAD', tipDetail: null })).toBe(null);
  });

  it('ignores invalid explicit detail and falls back to default/omit', () => {
    expect(resolveTipDetail({ tip: 'BANNERA', tipDetail: 'LIZA_SUKNO' })).toBe('KTO_EDET');
    expect(resolveTipDetail({ tip: 'PODRYAD', tipDetail: 'NASHI' })).toBe(null);
  });
});

describe('isTipDetailValidForTip', () => {
  it('allows empty', () => {
    expect(isTipDetailValidForTip('PODRYAD', null)).toBe(true);
  });
  it('rejects wrong pair', () => {
    expect(isTipDetailValidForTip('PLENKA', 'ROLL_UP')).toBe(false);
  });
});
