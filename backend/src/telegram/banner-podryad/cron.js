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
    () => {
      const db = getDb();
      const now = new Date();
      runCatchUpSweep({ db, now }).catch((err) => {
        console.error('[banner-podryad] catch-up cron error:', err.message);
      });
      if (isEveningTick(now, getBannerPodryadHour(db))) {
        runEveningBatch({ db, now }).catch((err) => {
          console.error('[banner-podryad] evening cron error:', err.message);
        });
      }
    },
    { timezone: CRM_TIMEZONE },
  );
  console.log(`Banner/podryad cron initialized: 0 * * * * (${CRM_TIMEZONE})`);
}
