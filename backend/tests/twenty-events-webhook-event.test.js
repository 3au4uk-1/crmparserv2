// backend/tests/twenty-events-webhook-event.test.js
import { describe, it, expect } from 'vitest';

import {
  mapWebhookToRecordEvent,
  WATCHED_OBJECT_NAMES,
} from '../src/services/twenty-events/webhook-event.js';

const record = { id: 'opp-1', name: 'Deal', stage: 'PROIZVODSTVO' };

const payload = (overrides = {}) => ({
  targetUrl: 'https://crm.example.com/api/twenty-webhook',
  eventName: 'opportunity.updated',
  workspaceId: 'ws-1',
  webhookId: 'wh-1',
  eventDate: '2026-08-07T12:00:00.000Z',
  objectMetadata: { id: 'meta-1', nameSingular: 'opportunity' },
  record,
  updatedFields: ['stage'],
  ...overrides,
});

describe('WATCHED_OBJECT_NAMES', () => {
  it('lists exactly the objects the board renders', () => {
    expect(WATCHED_OBJECT_NAMES).toEqual([
      'opportunity',
      'dealLineItem',
      'okleykaDealShare',
      'okleykaSalaryEntry',
      'company',
      'restorationTemplate',
    ]);
  });
});

describe('mapWebhookToRecordEvent', () => {
  it('maps an update, keeping updatedFields and the new record state', () => {
    expect(mapWebhookToRecordEvent(payload())).toEqual({
      action: 'UPDATED',
      objectNameSingular: 'opportunity',
      recordId: 'opp-1',
      properties: { updatedFields: ['stage'], after: record },
    });
  });

  it('maps a creation without updatedFields', () => {
    const event = mapWebhookToRecordEvent(
      payload({ eventName: 'opportunity.created', updatedFields: undefined }),
    );

    expect(event).toEqual({
      action: 'CREATED',
      objectNameSingular: 'opportunity',
      recordId: 'opp-1',
      properties: { after: record },
    });
  });

  it('maps a deletion to the before state', () => {
    const event = mapWebhookToRecordEvent(
      payload({ eventName: 'dealLineItem.deleted', objectMetadata: { id: 'm', nameSingular: 'dealLineItem' } }),
    );

    expect(event).toEqual({
      action: 'DELETED',
      objectNameSingular: 'dealLineItem',
      recordId: 'opp-1',
      properties: { before: record },
    });
  });

  it('falls back to eventName when objectMetadata is absent', () => {
    const event = mapWebhookToRecordEvent(payload({ objectMetadata: undefined }));

    expect(event.objectNameSingular).toBe('opportunity');
  });

  it('ignores objects the board does not read', () => {
    expect(
      mapWebhookToRecordEvent(
        payload({ eventName: 'note.updated', objectMetadata: { id: 'm', nameSingular: 'note' } }),
      ),
    ).toBeNull();
  });

  it('ignores metadata webhooks and malformed bodies', () => {
    expect(
      mapWebhookToRecordEvent({ eventName: 'metadata.view.updated', event: { name: 'view' } }),
    ).toBeNull();
    expect(mapWebhookToRecordEvent(payload({ record: {} }))).toBeNull();
    expect(mapWebhookToRecordEvent(payload({ eventName: 'opportunity.restored' }))).toBeNull();
    expect(mapWebhookToRecordEvent(payload({ eventName: undefined }))).toBeNull();
    expect(mapWebhookToRecordEvent(null)).toBeNull();
  });
});
