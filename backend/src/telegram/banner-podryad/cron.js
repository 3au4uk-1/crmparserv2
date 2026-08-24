import cron from 'node-cron';
import { getDb } from '../../db/connection.js';
import { CRM_TIMEZONE } from '../../utils/crm-dates.js';
import { getBannerPodryadHour } from '../settings.js';
import { runCatchUpSweep, runEveningBatch } from './run.js';
import { isEveningTick } from './window.js';

let cronTask = null;

export function initBannerPodryadCron() {
  if (cronTask) cronTask.stop();
  cronTask = cron.schedule(
    '0 * * * *',
    async () => {
      const db = getDb();
      const now = new Date();
      try {
        if (isEveningTick(now, getBannerPodryadHour(db))) {
          await runEveningBatch({ db, now });
        }
        await runCatchUpSweep({ db, now });
      } catch (err) {
        console.error('[banner-podryad] cron error:', err.message);
      }
    },
    { timezone: CRM_TIMEZONE },
  );
  console.log(`Banner/podryad cron initialized: 0 * * * * (${CRM_TIMEZONE})`);
}
