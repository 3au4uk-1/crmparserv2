import { describe, it, expect } from 'vitest';
import {
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

  it('clamps start date before today', () => {
    const { start } = normalizeParseRange('2026-05-01', '2026-07-31', now);
    expect(start).toBe(getMinParseStart(now));
  });

  it('keeps valid future start date', () => {
    const { start } = normalizeParseRange('2026-06-10', '2026-07-31', now);
    expect(start).toContain('2026-06-10');
  });
});
