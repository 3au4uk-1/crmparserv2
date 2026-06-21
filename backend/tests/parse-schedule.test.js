import { describe, it, expect, beforeEach } from 'vitest';
import {
  resolveParseTier,
  markParseSlotExecuted,
  resetParseScheduleState,
} from '../src/services/parse-schedule.js';
import { getParseRangeForTier } from '../src/utils/crm-dates.js';

describe('resolveParseTier', () => {
  beforeEach(() => {
    resetParseScheduleState();
  });

  it('returns weekday-fast on Fri 10:00 MSK', () => {
    expect(resolveParseTier(new Date('2026-06-19T10:00:00+03:00'))).toBe('weekday-fast');
  });

  it('returns weekday-fast on Fri 21:00 MSK', () => {
    expect(resolveParseTier(new Date('2026-06-19T21:00:00+03:00'))).toBe('weekday-fast');
  });

  it('returns weekday-deep on Fri 22:00 MSK', () => {
    expect(resolveParseTier(new Date('2026-06-19T22:00:00+03:00'))).toBe('weekday-deep');
  });

  it('returns night-light on Fri 02:00 MSK', () => {
    expect(resolveParseTier(new Date('2026-06-19T02:00:00+03:00'))).toBe('night-light');
  });

  it('returns null on Fri 03:00 MSK (quiet hours)', () => {
    expect(resolveParseTier(new Date('2026-06-19T03:00:00+03:00'))).toBeNull();
  });

  it('returns weekend on Sat 02:00 MSK (beats night-light)', () => {
    expect(resolveParseTier(new Date('2026-06-20T02:00:00+03:00'))).toBe('weekend');
  });

  it('returns weekend on Sat 14:00 MSK', () => {
    expect(resolveParseTier(new Date('2026-06-20T14:00:00+03:00'))).toBe('weekend');
  });

  it('returns null on Sun 23:00 MSK (off weekend slot)', () => {
    expect(resolveParseTier(new Date('2026-06-21T23:00:00+03:00'))).toBeNull();
  });

  it('deduplicates within the same hour slot', () => {
    const now = new Date('2026-06-19T10:05:00+03:00');
    expect(resolveParseTier(now)).toBe('weekday-fast');
    markParseSlotExecuted('weekday-fast', now);
    expect(resolveParseTier(new Date('2026-06-19T10:20:00+03:00'))).toBeNull();
  });

  it('allows the next hour slot', () => {
    const ten = new Date('2026-06-19T10:00:00+03:00');
    markParseSlotExecuted('weekday-fast', ten);
    expect(resolveParseTier(new Date('2026-06-19T11:00:00+03:00'))).toBe('weekday-fast');
  });
});

describe('getParseRangeForTier integration', () => {
  it('weekday-fast range matches +4 day offset', () => {
    const range = getParseRangeForTier('weekday-fast', new Date('2026-06-19T10:00:00+03:00'));
    expect(range.endDate).toBe('2026-06-23');
  });
});
