import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../src/config.js', () => ({
  config: {
    appPassword: 'test-password',
    sessionSecret: 'test-session-secret',
    dbPath: ':memory:',
    publicBaseUrl: '',
  },
}));

import { initDb } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { appAuthMiddleware, createSessionToken } from '../src/middleware/app-auth.js';
import telegramRouter from '../src/routes/telegram.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', appAuthMiddleware);
  app.use('/api/telegram', telegramRouter);
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
  });
  return app;
}

function authorized(requestBuilder) {
  return requestBuilder.set('Authorization', `Bearer ${createSessionToken()}`);
}

describe('telegram work-request slot routes', () => {
  beforeEach(() => {
    initDb();
    migrate();
  });

  it('requires app authentication', async () => {
    const res = await request(createApp()).get('/api/telegram/work-request-slots');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });

  it('PUT stores slots and GET returns them', async () => {
    const slot = {
      chatId: '-1001',
      threadId: 3,
      companyLabel: 'Маяк',
      topicRole: 'REVIEW',
    };

    const put = await authorized(
      request(createApp()).put('/api/telegram/work-request-slots').send({ slots: [slot] }),
    );
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ slots: [slot] });

    const get = await authorized(
      request(createApp()).get('/api/telegram/work-request-slots'),
    );
    expect(get.status).toBe(200);
    expect(get.body).toEqual({ slots: [slot] });
  });

  it('drops rows with an empty chatId before validation', async () => {
    const validSlot = {
      chatId: '-1002',
      threadId: 5,
      companyLabel: 'Спектр',
      topicRole: 'DESIGN',
    };
    const put = await authorized(
      request(createApp())
        .put('/api/telegram/work-request-slots')
        .send({
          slots: [
            { chatId: '   ', threadId: '', companyLabel: '', topicRole: '' },
            validSlot,
          ],
        }),
    );

    expect(put.status).toBe(200);
    expect(put.body).toEqual({ slots: [validSlot] });

    const get = await authorized(
      request(createApp()).get('/api/telegram/work-request-slots'),
    );
    expect(get.status).toBe(200);
    expect(get.body).toEqual({ slots: [validSlot] });
  });

  it('rejects an invalid topicRole', async () => {
    const res = await authorized(
      request(createApp())
        .put('/api/telegram/work-request-slots')
        .send({
          slots: [
            { chatId: '-1001', threadId: 3, companyLabel: 'Маяк', topicRole: 'UNKNOWN' },
          ],
        }),
    );

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid topicRole' });
  });
});
