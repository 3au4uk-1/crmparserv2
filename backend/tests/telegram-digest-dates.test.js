import { describe, expect, it } from 'vitest';
import { getDigestDayMeta } from '../src/telegram/digest/dates.js';

describe('getDigestDayMeta', () => {
  it('tomorrow from fixed Moscow instant', () => {
    // 2026-08-06 12:00 MSK
    const now = new Date('2026-08-06T09:00:00.000Z');
    const meta = getDigestDayMeta(1, now);
    expect(meta.title).toBe('ЗАВТРА');
    expect(meta.inputDate).toBe('2026-08-07');
    expect(meta.dateLabel).toBe('07.08');
    expect(meta.gte).toContain('2026-08-07');
    expect(meta.lt).toContain('2026-08-08');
  });
});
