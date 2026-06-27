import cron from 'node-cron';
import { config } from '../config.js';
import { CRM_TIMEZONE } from '../utils/crm-dates.js';
import { requireTwentyConfig } from './twenty-config.js';
import { createTwentyGqlClient } from './twenty-gql.js';
import {
  listLineItemsInPrintStage,
  refreshPlenkaForLineItem,
} from './print-sheet-twenty.js';

let cronTask = null;

export async function runPrintSheetRefresh() {
  if (
    !config.printSheetId ||
    !config.googleServiceAccountEmail ||
    !config.googleServiceAccountPrivateKey
  ) {
    return;
  }

  let gql;
  try {
    const twenty = requireTwentyConfig();
    gql = createTwentyGqlClient(twenty.apiUrl, twenty.apiToken);
  } catch {
    return;
  }

  const lineItems = await listLineItemsInPrintStage(gql);
  for (const lineItem of lineItems) {
    try {
      await refreshPlenkaForLineItem(gql, lineItem);
    } catch (err) {
      console.error(`[print-sheet] refresh failed for ${lineItem.id}:`, err.message);
    }
  }
}

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
