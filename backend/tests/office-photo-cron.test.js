import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CRM_TIMEZONE } from '../src/utils/crm-dates.js';

const scheduleMock = vi.fn();
const runOfficePhotoTasks = vi.fn();
const getOfficePhotoTaskCron = vi.fn();

vi.mock('node-cron', () => ({
  default: { schedule: (...args) => scheduleMock(...args) },
}));
vi.mock('../src/services/office-photo-tasks/run.js', () => ({
  runOfficePhotoTasks: (...a) => runOfficePhotoTasks(...a),
}));
vi.mock('../src/db/connection.js', () => ({
  getDb: () => ({}),
}));
vi.mock('../src/telegram/settings.js', () => ({
  getOfficePhotoTaskCron: (...a) => getOfficePhotoTaskCron(...a),
}));

import { initOfficePhotoTaskCron } from '../src/services/office-photo-tasks/cron.js';

describe('initOfficePhotoTaskCron', () => {
  beforeEach(() => {
    scheduleMock.mockReset().mockReturnValue({ stop: vi.fn() });
    runOfficePhotoTasks.mockReset().mockResolvedValue({});
    getOfficePhotoTaskCron.mockReset().mockReturnValue('0 7 * * *');
  });

  it('schedules default 07:00 Moscow', () => {
    initOfficePhotoTaskCron();
    expect(scheduleMock).toHaveBeenCalledWith(
      '0 7 * * *',
      expect.any(Function),
      { timezone: CRM_TIMEZONE },
    );
  });

  it('uses office_photo_task_cron from settings', () => {
    getOfficePhotoTaskCron.mockReturnValue('15 8 * * *');
    initOfficePhotoTaskCron();
    expect(scheduleMock).toHaveBeenCalledWith(
      '15 8 * * *',
      expect.any(Function),
      { timezone: CRM_TIMEZONE },
    );
  });
});
