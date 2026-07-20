import { describe, it, expect, beforeEach } from 'vitest';
import {
  createExportJob,
  getExportJob,
  updateExportJob,
  getActiveExportJob,
  resetExportJobsForTests,
} from '../src/services/export-jobs.js';

describe('export-jobs', () => {
  beforeEach(() => {
    resetExportJobsForTests();
  });

  it('creates and retrieves a job', () => {
    const job = createExportJob({ from: '2025-01-01', to: '2025-01-31' });
    expect(getExportJob(job.jobId).status).toBe('queued');
  });

  it('tracks active job', () => {
    const job = createExportJob({ from: '2025-01-01', to: '2025-01-31' });
    updateExportJob(job.jobId, { status: 'running' });
    expect(getActiveExportJob()?.jobId).toBe(job.jobId);
    updateExportJob(job.jobId, { status: 'completed' });
    expect(getActiveExportJob()).toBeNull();
  });

  it('scopes active job by kind', () => {
    const cal = createExportJob({ from: '2025-01-01', to: '2025-01-31', kind: 'calendar' });
    updateExportJob(cal.jobId, { status: 'running' });
    const tw = createExportJob({
      from: '2025-01-01',
      to: '2025-01-31',
      kind: 'twenty',
      includeCancelled: false,
    });
    updateExportJob(tw.jobId, { status: 'running' });

    expect(getActiveExportJob('calendar')?.jobId).toBe(cal.jobId);
    expect(getActiveExportJob('twenty')?.jobId).toBe(tw.jobId);
  });

  it('defaults kind to calendar', () => {
    const job = createExportJob({ from: '2025-01-01', to: '2025-01-31' });
    expect(job.kind).toBe('calendar');
    expect(getActiveExportJob()?.jobId).toBe(job.jobId);
  });
});
