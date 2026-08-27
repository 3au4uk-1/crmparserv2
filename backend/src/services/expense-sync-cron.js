import cron from 'node-cron';
import { getDb } from '../db/connection.js';
import { CRM_TIMEZONE } from '../utils/crm-dates.js';
import {
  createExpenseJob,
  executeExpenseJob,
  getActiveExpenseJob,
} from './expense-jobs.js';

let cronTask = null;

function getExpenseSyncSchedule() {
  const db = getDb();
  return (
    db.prepare('SELECT value FROM settings WHERE key = ?').get('expense_sync_schedule')?.value ||
    '30 7 * * *'
  );
}

export function initExpenseSyncCron() {
  if (cronTask) {
    cronTask.stop();
  }

  const db = getDb();
  db.prepare(
    "UPDATE settings SET value = '30 7 * * *' WHERE key = 'expense_sync_schedule' AND value = '0 6 * * *'",
  ).run();

  const scheduleExpression = getExpenseSyncSchedule();

  cronTask = cron.schedule(
    scheduleExpression,
    () => {
      if (getActiveExpenseJob()) {
        console.log('[expense-sync] cron skipped: active sync job exists');
        return;
      }

      const job = createExpenseJob({ trigger: 'cron' });
      executeExpenseJob(job.jobId).catch((err) => {
        console.error(`[expense-sync] cron job ${job.jobId} failed:`, err.message);
      });
    },
    { timezone: CRM_TIMEZONE },
  );

  console.log(`Expense sync cron initialized: ${scheduleExpression} (${CRM_TIMEZONE})`);
}
