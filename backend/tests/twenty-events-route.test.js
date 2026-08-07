import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const state = vi.hoisted(() => ({ enabled: true, journal: null }));

vi.mock('../src/config.js', () => ({
  config: {
    twentyAppApiSecret: 'test-secret',
    dbPath: ':memory:',
  },
}));

vi.mock('../src/services/twenty-events/index.js', () => ({
  isTwentyEventsEnabled: () => state.enabled,
  getEventJournal: () => state.journal,
}));

import { initDb } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { createEventJournal } from '../src/services/twenty-events/journal.js';
import twentyRouter from '../src/routes/twenty.js';

const createApp = () => {
  const app = express();
  app.use(express.json());
  app.use('/api/twenty', twentyRouter);
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ error: err.message });
  });
  return app;
};

const event = (recordId) => ({
  action: 'UPDATED',
  objectNameSingular: 'opportunity',
  recordId,
  properties: { updatedFields: ['stage'] },
});

describe('GET /api/twenty/events', () => {
  beforeEach(() => {
    initDb();
    migrate();
    state.enabled = true;
    state.journal = createEventJournal();
  });

  it('rejects requests without the shared secret', async () => {
    await request(createApp()).get('/api/twenty/events').expect(401);
  });

  it('returns the current cursor on a first poll', async () => {
    state.journal.append(event('a'));

    const response = await request(createApp())
      .get('/api/twenty/events')
      .set('Authorization', 'Bearer test-secret')
      .expect(200);

    expect(response.body).toEqual({
      epoch: state.journal.epoch,
      cursor: 1,
      reset: false,
      events: [],
    });
  });

  it('returns events newer than the cursor', async () => {
    state.journal.append(event('a'));
    state.journal.append(event('b'));

    const response = await request(createApp())
      .get('/api/twenty/events')
      .query({ since: '1', epoch: state.journal.epoch })
      .set('Authorization', 'Bearer test-secret')
      .expect(200);

    expect(response.body.events).toEqual([event('b')]);
    expect(response.body.cursor).toBe(2);
  });

  it('asks the client to reset on an epoch mismatch', async () => {
    state.journal.append(event('a'));

    const response = await request(createApp())
      .get('/api/twenty/events')
      .query({ since: '1', epoch: 'stale-epoch' })
      .set('Authorization', 'Bearer test-secret')
      .expect(200);

    expect(response.body.reset).toBe(true);
    expect(response.body.events).toEqual([]);
  });

  it('reports 503 when the journal is not ready', async () => {
    state.journal = null;

    const response = await request(createApp())
      .get('/api/twenty/events')
      .set('Authorization', 'Bearer test-secret')
      .expect(503);

    expect(response.body.error).toContain('not ready');
  });

  it('reports disabled when the kill switch is off', async () => {
    state.enabled = false;

    const response = await request(createApp())
      .get('/api/twenty/events')
      .set('Authorization', 'Bearer test-secret')
      .expect(200);

    expect(response.body).toEqual({ disabled: true });
  });
});
