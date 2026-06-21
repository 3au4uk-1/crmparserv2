import cron from 'node-cron';
import { runParsing } from './parser.js';
import { resolveParseTier, markParseSlotExecuted } from './parse-schedule.js';
import {
  tryAcquireParsingLock,
  releaseParsingLock,
} from './parsing-lock.js';
import { CRM_TIMEZONE, getParseRangeForTier, toInputDate } from '../utils/crm-dates.js';

let scheduledTask = null;

export async function tickScheduler(now = new Date()) {
  const tier = resolveParseTier(now);
  if (!tier) return;

  if (!tryAcquireParsingLock()) {
    console.log(`[scheduler] skipped tier=${tier} (parsing in progress)`);
    return;
  }

  const { start, end } = getParseRangeForTier(tier, now);
  console.log(
    `[scheduler] tier=${tier} range=${toInputDate(start)}..${toInputDate(end)}`
  );

  try {
    markParseSlotExecuted(tier, now);
    await runParsing(start, end);
    console.log(`[scheduler] tier=${tier} completed`);
  } catch (err) {
    console.error(`[scheduler] tier=${tier} failed:`, err.message);
  } finally {
    releaseParsingLock();
  }
}

export function initScheduler() {
  if (scheduledTask) {
    scheduledTask.stop();
  }

  scheduledTask = cron.schedule(
    '*/15 * * * *',
    () => {
      tickScheduler().catch((err) => {
        console.error('[scheduler] tick error:', err.message);
      });
    },
    { timezone: CRM_TIMEZONE }
  );

  console.log(`Scheduler initialized: */15 * * * * (${CRM_TIMEZONE})`);
}

export function restartScheduler() {
  initScheduler();
}
