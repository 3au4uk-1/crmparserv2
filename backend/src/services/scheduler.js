import cron from 'node-cron';
import { getDb } from '../db/connection.js';
import { runParsing } from './parser.js';
import { getDefaultParseRange } from '../utils/crm-dates.js';

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
    scheduledTask = cron.schedule(schedule, scheduledParse);
    console.log(`Scheduler initialized with cron: ${schedule}`);
  } else {
    console.error(`Invalid cron expression: ${schedule}`);
  }
}

export function restartScheduler() {
  initScheduler();
}
