import { describe, it, expect } from 'vitest';
import {
  buildCloseDate,
  getDefaultParseRange,
  getMinParseStart,
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
