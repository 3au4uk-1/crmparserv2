import cron from 'node-cron';
import { getDb } from '../db/connection.js';
import { runParsing } from './parser.js';
import { CRM_TIMEZONE, getDefaultParseRange } from '../utils/crm-dates.js';

let scheduledTask = null;

function getSetting(key) {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row?.value || '';
}

async function scheduledParse() {
  console.log(`[${new Date().toISOString()}] Scheduled parsing started`);
  try {
    const { start, end } = getDefaultParseRange();
    await runParsing(start, end);

    console.log(`[${new Date().toISOString()}] Scheduled parsing completed`);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Scheduled parsing failed:`, err.message);
  }
}

export function initScheduler() {
  const schedule = getSetting('parse_schedule') || '0 18 * * *';

  if (scheduledTask) {
    scheduledTask.stop();
  }

  if (cron.validate(schedule)) {
    scheduledTask = cron.schedule(schedule, scheduledParse, { timezone: CRM_TIMEZONE });
    console.log(`Scheduler initialized with cron: ${schedule} (${CRM_TIMEZONE})`);
  } else {
    console.error(`Invalid cron expression: ${schedule}`);
  }
}

export function restartScheduler() {
  initScheduler();
}
