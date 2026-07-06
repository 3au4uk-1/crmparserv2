import { describe, it, expect } from 'vitest';
import {
  buildCloseDate,
  getDefaultParseRange,
  getMinParseStart,
  getParseRangeForTier,
  normalizeExportRange,
  normalizeManualParseRange,
  normalizeParseRange,
  parseEventDate,
} from '../src/utils/crm-dates.js';

describe('crm-dates', () => {
  const now = new Date('2026-06-05T12:00:00+03:00');

  it('default range starts from today, not month start', () => {
    const range = getDefaultParseRange(now);
    expect(range.startDate).toBe('2026-06-05');
    expect(parseEventDate(range.start).getDate()).toBe(5);
  });

  it('default range ends 2 weeks ahead', () => {
    const range = getDefaultParseRange(now);
    expect(range.endDate).toBe('2026-06-19');
  });

  it('clamps start date before today', () => {
    const { start } = normalizeParseRange('2026-05-01', '2026-07-31', now);
    expect(start).toBe(getMinParseStart(now));
  });

  it('keeps valid future start date', () => {
    const { start } = normalizeParseRange('2026-06-10', '2026-07-31', now);
    expect(start).toContain('2026-06-10');
  });
});

describe('getParseRangeForTier', () => {
  it('weekday-fast ends 7 days ahead', () => {
    const now = new Date('2026-06-19T10:00:00+03:00');
    const range = getParseRangeForTier('weekday-fast', now);
    expect(range.endDate).toBe('2026-06-26');
  });

  it('weekday-deep ends 14 days ahead', () => {
    const now = new Date('2026-06-19T22:00:00+03:00');
    const range = getParseRangeForTier('weekday-deep', now);
    expect(range.endDate).toBe('2026-07-03');
  });

  it('night-light ends 4 days ahead', () => {
    const now = new Date('2026-06-19T02:00:00+03:00');
    const range = getParseRangeForTier('night-light', now);
    expect(range.endDate).toBe('2026-06-23');
  });

  it('weekend ends 7 days ahead', () => {
    const now = new Date('2026-06-20T14:00:00+03:00');
    const range = getParseRangeForTier('weekend', now);
    expect(range.endDate).toBe('2026-06-27');
  });

  it('start equals getMinParseStart(now)', () => {
    const now = new Date('2026-06-19T10:00:00+03:00');
    const range = getParseRangeForTier('weekday-fast', now);
    expect(range.start).toBe(getMinParseStart(now));
  });
});

describe('buildCloseDate', () => {
  it('combines start_date and arrival_time with Moscow offset', () => {
    const result = buildCloseDate({
      start_date: '2026-06-10T00:00:00+03:00',
      arrival_time: '09:00',
    });
    expect(result).toBe('2026-06-10T09:00:00+03:00');
  });

  it('uses midnight when arrival_time missing', () => {
    const result = buildCloseDate({ start_date: '2026-06-10' });
    expect(result).toBe('2026-06-10T00:00:00+03:00');
  });

  it('falls back to end_date then ignores invalid time', () => {
    const result = buildCloseDate({
      end_date: '2026-06-11',
      arrival_time: 'not-a-time',
    });
    expect(result).toBe('2026-06-11T00:00:00+03:00');
  });

  it('returns ISO string when no dates on deal', () => {
    const result = buildCloseDate({});
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

describe('normalizeManualParseRange', () => {
  const now = new Date('2026-06-05T12:00:00+03:00');

  it('allows start date before today', () => {
    const { start } = normalizeManualParseRange('2026-05-01', '2026-07-31', now);
    expect(start).toContain('2026-05-01');
  });

  it('throws when from > to', () => {
    expect(() => normalizeManualParseRange('2026-07-31', '2026-05-01', now)).toThrow();
  });

  it('defaults missing bounds to today + 2 weeks', () => {
    const { start, end } = normalizeManualParseRange(undefined, undefined, now);
    expect(start).toContain('2026-06-05');
    expect(end).toContain('2026-06-19');
  });
});

describe('normalizeExportRange', () => {
  const now = new Date('2026-06-05T12:00:00+03:00');

  it('does not clamp start before today', () => {
    const { start, end } = normalizeExportRange('2025-01-01', '2025-03-31', now);
    expect(start).toContain('2025-01-01');
    expect(end).toContain('2025-03-31');
  });

  it('expands YYYY-MM-DD to full-day Moscow bounds', () => {
    const { start, end } = normalizeExportRange('2025-06-01', '2025-06-30', now);
    expect(start).toBe('2025-06-01T00:00:00+03:00');
    expect(end).toBe('2025-06-30T23:59:59+03:00');
  });

  it('throws when from > to', () => {
    expect(() => normalizeExportRange('2025-06-30', '2025-06-01', now)).toThrow();
  });
});
