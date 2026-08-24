import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CRM_TIMEZONE } from '../src/utils/crm-dates.js';

const scheduleMock = vi.fn();
const runCatchUpSweep = vi.fn();
const runEveningBatch = vi.fn();
const getBannerPodryadHour = vi.fn();
const isEveningTick = vi.fn();

vi.mock('node-cron', () => ({
  default: { schedule: (...args) => scheduleMock(...args) },
}));
vi.mock('../src/telegram/banner-podryad/run.js', () => ({
  runCatchUpSweep: (...a) => runCatchUpSweep(...a),
  runEveningBatch: (...a) => runEveningBatch(...a),
}));
vi.mock('../src/telegram/banner-podryad/window.js', () => ({
  isEveningTick: (...a) => isEveningTick(...a),
}));
vi.mock('../src/telegram/settings.js', () => ({
  getBannerPodryadHour: (...a) => getBannerPodryadHour(...a),
}));
vi.mock('../src/db/connection.js', () => ({
  getDb: () => ({ cron: true }),
}));

import { initBannerPodryadCron } from '../src/telegram/banner-podryad/cron.js';

describe('initBannerPodryadCron', () => {
  beforeEach(() => {
    scheduleMock.mockReset().mockReturnValue({ stop: vi.fn() });
    runCatchUpSweep.mockReset().mockResolvedValue({});
    runEveningBatch.mockReset().mockResolvedValue({});
    getBannerPodryadHour.mockReset().mockReturnValue(18);
    isEveningTick.mockReset().mockReturnValue(false);
  });

  it('schedules hourly in CRM_TIMEZONE', () => {
    initBannerPodryadCron();
    expect(scheduleMock).toHaveBeenCalledWith(
      '0 * * * *',
      expect.any(Function),
      { timezone: CRM_TIMEZONE },
    );
  });

  it('always runs catch-up; evening batch only on evening tick', async () => {
    isEveningTick.mockReturnValueOnce(false).mockReturnValueOnce(true);
    initBannerPodryadCron();
    const tick = scheduleMock.mock.calls[0][1];

    await tick();
    expect(runCatchUpSweep).toHaveBeenCalledTimes(1);
    expect(runEveningBatch).not.toHaveBeenCalled();

    await tick();
    expect(runCatchUpSweep).toHaveBeenCalledTimes(2);
    expect(runEveningBatch).toHaveBeenCalledTimes(1);
    expect(isEveningTick).toHaveBeenCalledWith(expect.any(Date), 18);
  });
});
