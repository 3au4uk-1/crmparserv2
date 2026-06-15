import { describe, it, expect } from 'vitest';
import { buildPrintSheetTabNames } from '../src/services/print-sheet-tabs.js';

describe('buildPrintSheetTabNames', () => {
  it('returns event, previous, and current month tabs deduplicated', () => {
    const closeDate = '2026-07-01T10:00:00.000Z';
    const now = new Date('2026-06-29T12:00:00.000Z');
    const tabs = buildPrintSheetTabNames(closeDate, now);
    expect(tabs).toEqual(['Июль 2026', 'Июнь 2026']);
  });

  it('handles January closeDate with December previous year', () => {
    const closeDate = '2026-01-15T10:00:00.000Z';
    const now = new Date('2025-12-20T12:00:00.000Z');
    const tabs = buildPrintSheetTabNames(closeDate, now);
    expect(tabs).toContain('Январь 2026');
    expect(tabs).toContain('Декабрь 2025');
  });
});
