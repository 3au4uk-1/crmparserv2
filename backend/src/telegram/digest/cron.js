import cron from 'node-cron';
import { getDb } from '../../db/connection.js';
import { CRM_TIMEZONE } from '../../utils/crm-dates.js';
import { runMorningDigests } from './run.js';

let cronTask = null;

export function initDigestCron() {
  if (cronTask) cronTask.stop();
  cronTask = cron.schedule(
    '0 9 * * *',
    () => {
      runMorningDigests({ db: getDb() }).catch((err) => {
        console.error('[digest] cron error:', err.message);
      });
    },
    { timezone: CRM_TIMEZONE },
  );
  console.log(`Digest cron initialized: 0 9 * * * (${CRM_TIMEZONE})`);
}
