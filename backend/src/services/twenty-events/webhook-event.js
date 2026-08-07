// backend/src/services/twenty-events/webhook-event.js

/** Objects the deals board renders; anything else is not journalled. */
export const WATCHED_OBJECT_NAMES = [
  'opportunity',
  'dealLineItem',
  'okleykaDealShare',
  'okleykaSalaryEntry',
  'company',
  'restorationTemplate',
];

const ACTION_BY_EVENT = {
  created: 'CREATED',
  updated: 'UPDATED',
  deleted: 'DELETED',
};

/**
 * Maps Twenty's webhook body (CallWebhookJobData minus `secret`) to the record-event
 * shape the board client already knows. Returns null for payloads to ignore.
 */
export function mapWebhookToRecordEvent(payload) {
  const eventName = payload?.eventName;
  if (typeof eventName !== 'string') return null;

  const [namePart, eventPart] = eventName.split('.');
  const action = ACTION_BY_EVENT[eventPart];
  if (!action) return null;

  const objectNameSingular = payload.objectMetadata?.nameSingular ?? namePart;
  if (!WATCHED_OBJECT_NAMES.includes(objectNameSingular)) return null;

  const record = payload.record;
  const recordId = typeof record?.id === 'string' ? record.id : null;
  if (!recordId) return null;

  const properties =
    action === 'DELETED'
      ? { before: record }
      : {
          ...(Array.isArray(payload.updatedFields)
            ? { updatedFields: payload.updatedFields }
            : {}),
          after: record,
        };

  return { action, objectNameSingular, recordId, properties };
}
