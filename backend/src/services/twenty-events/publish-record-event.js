import { getEventJournal, isTwentyEventsEnabled } from './index.js';

/**
 * Push a board event without waiting for Twenty's webhook job.
 * Webhook delivery can lag minutes; the deals board long-polls this journal.
 */
export function publishRecordEvent(event) {
  if (!isTwentyEventsEnabled()) return null;
  const journal = getEventJournal();
  if (!journal) return null;
  if (
    typeof event?.action !== 'string'
    || typeof event?.objectNameSingular !== 'string'
    || typeof event?.recordId !== 'string'
  ) {
    return null;
  }

  return journal.append({
    action: event.action,
    objectNameSingular: event.objectNameSingular,
    recordId: event.recordId,
    properties: event.properties ?? {},
  });
}

export function publishDealLineItemEvent(action, recordId, properties = {}) {
  return publishRecordEvent({
    action,
    objectNameSingular: 'dealLineItem',
    recordId,
    properties,
  });
}
