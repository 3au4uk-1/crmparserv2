import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const handleOkleykaSendMock = vi.fn();
const queueBannerPodryadCatchUpMock = vi.fn();

vi.mock('../src/config.js', () => ({
  config: {
    twentyAppApiSecret: 'test-secret',
    dbPath: ':memory:',
  },
}));

vi.mock('../src/telegram/handle-okleyka-send.js', () => ({
  handleOkleykaSend: (...args) => handleOkleykaSendMock(...args),
}));

vi.mock('../src/telegram/banner-podryad/run.js', () => ({
  queueBannerPodryadCatchUp: (...args) => queueBannerPodryadCatchUpMock(...args),
}));

import { initDb } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import twentyRouter from '../src/routes/twenty.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/twenty', twentyRouter);
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ error: err.message });
  });
  return app;
}

describe('POST /twenty/telegram/events', () => {
  beforeEach(() => {
    initDb();
    migrate();
    handleOkleykaSendMock.mockReset();
    queueBannerPodryadCatchUpMock.mockReset();
    handleOkleykaSendMock.mockResolvedValue({ ok: true });
  });

  it('returns 400 for an unknown event', async () => {
    const res = await request(createApp())
      .post('/api/twenty/telegram/events')
      .set('Authorization', 'Bearer test-secret')
      .send({ event: 'not.a.real.event', lineItemId: 'li-1' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unsupported event/);
    expect(handleOkleykaSendMock).not.toHaveBeenCalled();
    expect(queueBannerPodryadCatchUpMock).not.toHaveBeenCalled();
  });

  it('still handles okleyka.send', async () => {
    const payload = { event: 'okleyka.send', lineItemId: 'li-1', text: 'hi', fileUrls: [] };
    const res = await request(createApp())
      .post('/api/twenty/telegram/events')
      .set('Authorization', 'Bearer test-secret')
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(handleOkleykaSendMock).toHaveBeenCalledOnce();
    expect(handleOkleykaSendMock.mock.calls[0][1]).toMatchObject(payload);
    expect(queueBannerPodryadCatchUpMock).not.toHaveBeenCalled();
  });

  it('queues banner_podryad.catchup by lineItemId', async () => {
    const res = await request(createApp())
      .post('/api/twenty/telegram/events')
      .set('Authorization', 'Bearer test-secret')
      .send({
        event: 'banner_podryad.catchup',
        lineItemId: 'li-9',
        opportunityId: 'opp-9',
        loadDate: '2026-08-25',
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, queued: true });
    expect(queueBannerPodryadCatchUpMock).toHaveBeenCalledOnce();
    expect(queueBannerPodryadCatchUpMock.mock.calls[0][0]).toEqual(['li-9']);
    expect(handleOkleykaSendMock).not.toHaveBeenCalled();
  });
});
