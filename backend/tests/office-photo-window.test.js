import { describe, expect, it } from 'vitest';
import { calendarYmd, shiftYmd } from '../src/services/office-photo-tasks/window.js';

describe('calendarYmd', () => {
  it('returns CRM calendar day for fixed Moscow instant', () => {
    const now = new Date('2026-08-27T12:00:00+03:00');
    expect(calendarYmd(now)).toBe('2026-08-27');
  });
});

describe('shiftYmd', () => {
  it('adds days to YYYY-MM-DD', () => {
    expect(shiftYmd('2026-08-27', 1)).toBe('2026-08-28');
  });

  it('subtracts days from YYYY-MM-DD', () => {
    expect(shiftYmd('2026-08-28', -1)).toBe('2026-08-27');
  });
});
