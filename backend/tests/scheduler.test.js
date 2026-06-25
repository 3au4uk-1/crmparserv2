import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CRM_TIMEZONE } from '../src/utils/crm-dates.js';

const scheduleMock = vi.fn();
const stopMock = vi.fn();
const runParsingMock = vi.fn();
const resolveParseTierMock = vi.fn();
const markParseSlotExecutedMock = vi.fn();
const getParseRangeForTierMock = vi.fn();
const isParsingInProgressMock = vi.fn();
const tryAcquireParsingLockMock = vi.fn();
const releaseParsingLockMock = vi.fn();

vi.mock('node-cron', () => ({
  default: {
    schedule: (...args) => scheduleMock(...args),
    validate: () => true,
  },
}));

vi.mock('../src/services/parser.js', () => ({
  runParsing: (...args) => runParsingMock(...args),
}));

vi.mock('../src/services/parse-schedule.js', () => ({
  resolveParseTier: (...args) => resolveParseTierMock(...args),
  markParseSlotExecuted: (...args) => markParseSlotExecutedMock(...args),
}));

vi.mock('../src/utils/crm-dates.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getParseRangeForTier: (...args) => getParseRangeForTierMock(...args),
  };
});

vi.mock('../src/services/parsing-lock.js', () => ({
  isParsingInProgress: (...args) => isParsingInProgressMock(...args),
  tryAcquireParsingLock: (...args) => tryAcquireParsingLockMock(...args),
  releaseParsingLock: (...args) => releaseParsingLockMock(...args),
}));

import { initScheduler, tickScheduler } from '../src/services/scheduler.js';

describe('scheduler', () => {
  beforeEach(() => {
    scheduleMock.mockReset();
    stopMock.mockReset();
    runParsingMock.mockReset();
    resolveParseTierMock.mockReset();
    markParseSlotExecutedMock.mockReset();
    getParseRangeForTierMock.mockReset();
    isParsingInProgressMock.mockReset();
    tryAcquireParsingLockMock.mockReset();
    releaseParsingLockMock.mockReset();

    scheduleMock.mockReturnValue({ stop: stopMock });
    runParsingMock.mockResolvedValue({});
    getParseRangeForTierMock.mockReturnValue({
      start: '2026-06-19T00:00:00+03:00',
      end: '2026-06-23T23:59:59+03:00',
    });
    tryAcquireParsingLockMock.mockReturnValue(true);
  });

  it('registers hourly cron in CRM timezone', () => {
    initScheduler();
    expect(scheduleMock).toHaveBeenCalledTimes(1);
    const [expression, , options] = scheduleMock.mock.calls[0];
    expect(expression).toBe('0 * * * *');
    expect(options).toEqual({ timezone: CRM_TIMEZONE });
  });

  it('runs parsing when tier resolves and lock acquired', async () => {
    resolveParseTierMock.mockReturnValue('weekday-fast');
    await tickScheduler(new Date('2026-06-19T10:00:00+03:00'));

    expect(getParseRangeForTierMock).toHaveBeenCalledWith('weekday-fast', expect.any(Date));
    expect(runParsingMock).toHaveBeenCalledWith(
      '2026-06-19T00:00:00+03:00',
      '2026-06-23T23:59:59+03:00'
    );
    expect(markParseSlotExecutedMock).toHaveBeenCalledWith('weekday-fast', expect.any(Date));
    expect(releaseParsingLockMock).toHaveBeenCalled();
  });

  it('skips when no tier', async () => {
    resolveParseTierMock.mockReturnValue(null);
    await tickScheduler(new Date('2026-06-19T03:00:00+03:00'));
    expect(runParsingMock).not.toHaveBeenCalled();
    expect(tryAcquireParsingLockMock).not.toHaveBeenCalled();
  });

  it('skips when lock not acquired', async () => {
    resolveParseTierMock.mockReturnValue('weekday-fast');
    tryAcquireParsingLockMock.mockReturnValue(false);
    await tickScheduler(new Date('2026-06-19T10:00:00+03:00'));
    expect(runParsingMock).not.toHaveBeenCalled();
    expect(markParseSlotExecutedMock).not.toHaveBeenCalled();
  });
});
