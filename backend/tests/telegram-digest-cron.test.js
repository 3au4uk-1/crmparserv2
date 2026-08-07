import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CRM_TIMEZONE } from '../src/utils/crm-dates.js';

const scheduleMock = vi.fn();
const runMorningDigests = vi.fn();

vi.mock('node-cron', () => ({
  default: { schedule: (...args) => scheduleMock(...args) },
}));
vi.mock('../src/telegram/digest/run.js', () => ({
  runMorningDigests: (...a) => runMorningDigests(...a),
}));
vi.mock('../src/db/connection.js', () => ({
  getDb: () => ({}),
}));

import { initDigestCron } from '../src/telegram/digest/cron.js';

describe('initDigestCron', () => {
  beforeEach(() => {
    scheduleMock.mockReset().mockReturnValue({ stop: vi.fn() });
    runMorningDigests.mockReset().mockResolvedValue({});
  });

  it('schedules 09:00 Moscow', () => {
    initDigestCron();
    expect(scheduleMock).toHaveBeenCalledWith(
      '0 9 * * *',
      expect.any(Function),
      { timezone: CRM_TIMEZONE },
    );
  });
});
