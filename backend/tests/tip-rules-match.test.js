import { describe, expect, it } from 'vitest';
import { findTipRuleMatch } from '../src/services/tip-rules.js';

const rules = [
  { id: 1, pattern: 'оклейк', matchType: 'substring', tip: 'PLENKA', tipDetail: 'NASHI', priority: 50, createdAt: '2026-01-02' },
  { id: 2, pattern: 'клише', matchType: 'substring', tip: 'PODRYAD', tipDetail: 'KUVALDIN_KLISHE', priority: 50, createdAt: '2026-01-01' },
  { id: 3, pattern: 'флаги', matchType: 'substring', tip: 'PODRYAD', tipDetail: null, priority: 100, createdAt: '2026-01-01' },
];

describe('findTipRuleMatch', () => {
  it('returns null when nothing matches', () => {
    expect(findTipRuleMatch('Скотч', rules)).toBe(null);
  });

  it('prefers lower priority number', () => {
    const mixed = [
      { ...rules[2], priority: 100 },
      { pattern: 'флаги односторонние', matchType: 'substring', tip: 'PODRYAD', tipDetail: 'SVOE', priority: 40, createdAt: '2026-01-03' },
    ];
    expect(findTipRuleMatch('Флаги односторонние на виндеры', mixed).tipDetail).toBe('SVOE');
  });

  it('matches substring case-insensitively via normalizePattern', () => {
    expect(findTipRuleMatch('Печать клише лого', rules).tip).toBe('PODRYAD');
  });
});
