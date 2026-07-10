import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const createBulkResyncJobMock = vi.fn(() => ({ jobId: '1' }));
const executeBulkResyncJobMock = vi.fn(() => Promise.resolve());
const getActiveBulkResyncJobMock = vi.fn(() => null);

vi.mock('../src/services/bulk-resync-jobs.js', () => ({
  createBulkResyncJob: (...args) => createBulkResyncJobMock(...args),
  executeBulkResyncJob: (...args) => executeBulkResyncJobMock(...args),
  getActiveBulkResyncJob: (...args) => getActiveBulkResyncJobMock(...args),
}));

import {
  resetListChangeResyncForTests,
  scheduleListChangeResync,
} from '../src/services/list-change-resync.js';

describe('list-change-resync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetListChangeResyncForTests();
    createBulkResyncJobMock.mockClear();
    executeBulkResyncJobMock.mockClear();
    getActiveBulkResyncJobMock.mockClear();
    getActiveBulkResyncJobMock.mockReturnValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
    resetListChangeResyncForTests();
  });

  it('debounces multiple calls into one job', () => {
    scheduleListChangeResync();
    scheduleListChangeResync();
    scheduleListChangeResync();
    expect(createBulkResyncJobMock).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5000);
    expect(createBulkResyncJobMock).toHaveBeenCalledTimes(1);
    expect(createBulkResyncJobMock).toHaveBeenCalledWith({ trigger: 'list_change' });
    expect(executeBulkResyncJobMock).toHaveBeenCalledWith('1');
  });

  it('skips scheduling when bulk resync already active', () => {
    getActiveBulkResyncJobMock.mockReturnValue({ jobId: '99', status: 'running' });
    scheduleListChangeResync();
    vi.advanceTimersByTime(5000);
    expect(createBulkResyncJobMock).not.toHaveBeenCalled();
  });
});
