import cron from 'node-cron';
import { getDb } from '../../db/connection.js';
import { getOfficePhotoTaskCron } from '../../telegram/settings.js';
import { CRM_TIMEZONE } from '../../utils/crm-dates.js';
import { runOfficePhotoTasks } from './run.js';

let cronTask = null;

export function initOfficePhotoTaskCron() {
  if (cronTask) cronTask.stop();
  const expression = getOfficePhotoTaskCron(getDb());
  cronTask = cron.schedule(
    expression,
    () => {
      runOfficePhotoTasks().catch((err) => {
        console.error('[office-photo] cron error:', err.message);
      });
    },
    { timezone: CRM_TIMEZONE },
  );
  console.log(`Office photo cron initialized: ${expression} (${CRM_TIMEZONE})`);
}
