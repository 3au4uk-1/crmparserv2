import { describe, expect, it } from 'vitest';
import { shouldCatchUp, isEveningTick } from '../src/telegram/banner-podryad/window.js';

describe('isEveningTick', () => {
  it('matches configured hour in Europe/Moscow', () => {
    expect(isEveningTick(new Date('2026-08-24T15:00:00.000Z'), 18)).toBe(true); // 18:00 MSK
    expect(isEveningTick(new Date('2026-08-24T14:00:00.000Z'), 18)).toBe(false);
  });
});

describe('shouldCatchUp', () => {
  const hour = 18;
  it('true when loadDate is today', () => {
    expect(
      shouldCatchUp({
        loadDateYmd: '2026-08-24',
        todayYmd: '2026-08-24',
        tomorrowYmd: '2026-08-25',
        now: new Date('2026-08-24T08:00:00.000Z'),
        hour,
      }),
    ).toBe(true);
  });
  it('true when loadDate is tomorrow and hour already passed', () => {
    expect(
      shouldCatchUp({
        loadDateYmd: '2026-08-25',
        todayYmd: '2026-08-24',
        tomorrowYmd: '2026-08-25',
        now: new Date('2026-08-24T15:30:00.000Z'),
        hour,
      }),
    ).toBe(true);
  });
  it('false when loadDate is tomorrow before evening hour', () => {
    expect(
      shouldCatchUp({
        loadDateYmd: '2026-08-25',
        todayYmd: '2026-08-24',
        tomorrowYmd: '2026-08-25',
        now: new Date('2026-08-24T14:00:00.000Z'),
        hour,
      }),
    ).toBe(false);
  });
});
