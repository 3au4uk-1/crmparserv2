import cron from 'node-cron';
import { getDb } from '../db/connection.js';
import { runParsing } from './parser.js';
import { syncDealToTwenty } from './twenty-sync.js';

let scheduledTask = null;

function getSetting(key) {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row?.value || '';
}

async function scheduledParse() {
  console.log(`[${new Date().toISOString()}] Scheduled parsing started`);
  try {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const end = new Date(now.getFullYear(), now.getMonth() + 2, 0).toISOString();

    await runParsing(start, end);

    const approvalMode = getSetting('approval_mode');
    if (approvalMode === 'auto' || approvalMode === 'semi') {
      const db = getDb();
      let query = "SELECT d.id FROM deals d WHERE d.approval_status = 'pending'";

      if (approvalMode === 'semi') {
        query += " AND EXISTS (SELECT 1 FROM deal_items di WHERE di.deal_id = d.id AND di.classification = 'keyword_match')";
      }

      const dealsToSync = db.prepare(query).all();
      for (const deal of dealsToSync) {
        try {
          await syncDealToTwenty(deal.id);
        } catch (err) {
          console.error(`Auto-sync failed for deal ${deal.id}:`, err.message);
        }
      }
    }

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
