import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const state = vi.hoisted(() => ({ enabled: true, journal: null }));

vi.mock('../src/config.js', () => ({
  config: {
    twentyWebhookSecret: 'webhook-secret',
    dbPath: ':memory:',
  },
}));

vi.mock('../src/services/twenty-events/index.js', () => ({
  isTwentyEventsEnabled: () => state.enabled,
  getEventJournal: () => state.journal,
}));

import { createEventJournal } from '../src/services/twenty-events/journal.js';
import { signTwentyWebhookPayload } from '../src/services/twenty-events/webhook-signature.js';
import twentyWebhookRouter from '../src/routes/twenty-webhook.js';

const createApp = () => {
  const app = express();
  app.use(
    express.json({
      verify: (req, res, buf) => {
        req.rawBody = buf.toString('utf8');
      },
    }),
  );
  app.use('/api/twenty-webhook', twentyWebhookRouter);
  return app;
};

const record = { id: 'opp-1', stage: 'PROIZVODSTVO' };

const body = (overrides = {}) => ({
  eventName: 'opportunity.updated',
  workspaceId: 'ws-1',
  webhookId: 'wh-1',
  eventDate: '2026-08-07T12:00:00.000Z',
  objectMetadata: { id: 'meta-1', nameSingular: 'opportunity' },
  record,
  updatedFields: ['stage'],
  ...overrides,
});

const send = (payload, { signed = true } = {}) => {
  const rawBody = JSON.stringify(payload);
  const timestamp = String(Date.now());
  const signature = signed
    ? signTwentyWebhookPayload(rawBody, timestamp, 'webhook-secret')
    : 'f'.repeat(64);

  return request(createApp())
    .post('/api/twenty-webhook')
    .set('Content-Type', 'application/json')
    .set('x-twenty-webhook-timestamp', timestamp)
    .set('x-twenty-webhook-signature', signature)
    .send(rawBody);
};

describe('POST /api/twenty-webhook', () => {
  beforeEach(() => {
    state.enabled = true;
    state.journal = createEventJournal();
  });

  it('journals a correctly signed record event', async () => {
    const response = await send(body());

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(state.journal.read({ since: 0, epoch: state.journal.epoch }).events).toEqual([
      {
        action: 'UPDATED',
        objectNameSingular: 'opportunity',
        recordId: 'opp-1',
        properties: { updatedFields: ['stage'], after: record },
      },
    ]);
  });

  it('rejects an invalid signature without journalling', async () => {
    const response = await send(body(), { signed: false });

    expect(response.status).toBe(401);
    expect(state.journal.cursor).toBe(0);
  });

  it('acknowledges payloads it deliberately ignores', async () => {
    const response = await send(
      body({ eventName: 'note.updated', objectMetadata: { id: 'm', nameSingular: 'note' } }),
    );

    expect(response.status).toBe(200);
    expect(response.body.ignored).toBeDefined();
    expect(state.journal.cursor).toBe(0);
  });

  it('acknowledges deliveries while the feature is off', async () => {
    state.enabled = false;

    const response = await send(body());

    expect(response.status).toBe(200);
    expect(response.body.ignored).toBeDefined();
    expect(state.journal.cursor).toBe(0);
  });

  it('acknowledges deliveries before the journal exists', async () => {
    state.journal = null;

    const response = await send(body());

    expect(response.status).toBe(200);
    expect(response.body.ignored).toBeDefined();
  });
});
