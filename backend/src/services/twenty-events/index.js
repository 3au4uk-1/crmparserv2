import { config } from '../../config.js';

import { createEventJournal } from './journal.js';

let journal = null;

export function isTwentyEventsEnabled() {
  return config.twentyEventsEnabled;
}

export function getEventJournal() {
  return journal;
}

export function initTwentyEvents() {
  if (!config.twentyEventsEnabled) {
    console.log('[twenty-events] disabled (TWENTY_EVENTS_ENABLED=false)');
    return;
  }
  if (journal) return;

  if (!config.twentyWebhookSecret) {
    console.warn('[twenty-events] TWENTY_WEBHOOK_SECRET is not set: deliveries will be rejected');
  }

  journal = createEventJournal();
  console.log(`[twenty-events] journal ready (epoch ${journal.epoch})`);
}

/** Test-only teardown: production has no shutdown path by design. */
export function resetTwentyEventsForTests() {
  journal = null;
}
