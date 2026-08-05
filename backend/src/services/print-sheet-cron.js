import cron from 'node-cron';
import { config } from '../config.js';
import { CRM_TIMEZONE } from '../utils/crm-dates.js';
import { runPrintSheetRefresh } from './print-sheet-runner.js';

export { runPrintSheetRefresh };

let cronTask = null;

export function initPrintSheetCron() {
  if (cronTask) {
    cronTask.stop();
  }

  if (!config.printSheetId) {
    console.log('Print sheet cron disabled (PRINT_SHEET_ID not set)');
    return;
  }

  cronTask = cron.schedule(
    '* * * * *',
    () => {
      runPrintSheetRefresh().catch((err) => {
        console.error('[print-sheet] cron error:', err.message);
      });
    },
    { timezone: CRM_TIMEZONE }
  );

  console.log(`Print sheet cron initialized: every 1 minute (${CRM_TIMEZONE})`);
}
