import { createBulkResyncJob, executeBulkResyncJob, getActiveBulkResyncJob } from './bulk-resync-jobs.js';

const DEBOUNCE_MS = 5000;
let timer = null;

export function scheduleListChangeResync() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    if (getActiveBulkResyncJob()) return;
    const job = createBulkResyncJob({ trigger: 'list_change' });
    executeBulkResyncJob(job.jobId).catch((err) => {
      console.error(`[list-change-resync] job ${job.jobId} failed:`, err.message);
    });
  }, DEBOUNCE_MS);
}

export function resetListChangeResyncForTests() {
  if (timer) clearTimeout(timer);
  timer = null;
}

export function getListChangeResyncDebounceMs() {
  return DEBOUNCE_MS;
}
