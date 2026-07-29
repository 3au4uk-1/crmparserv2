import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const scheduleListChangeResyncMock = vi.fn();

vi.mock('../src/config.js', () => ({
  config: {
    dbPath: ':memory:',
  },
}));

vi.mock('../src/services/list-change-resync.js', () => ({
  scheduleListChangeResync: (...args) => scheduleListChangeResyncMock(...args),
}));

import { getDb, initDb } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import neNasheBrandingRouter from '../src/routes/ne-nashe-branding.js';
import neNasheDecorMkRouter from '../src/routes/ne-nashe-decor-mk.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/ne-nashe-branding', neNasheBrandingRouter);
  app.use('/api/ne-nashe-decor-mk', neNasheDecorMkRouter);
  return app;
}

describe('ne-nashe list routes', () => {
  beforeEach(() => {
    initDb();
    migrate();
    getDb().prepare('DELETE FROM ne_nashe_branding_items').run();
    getDb().prepare('DELETE FROM ne_nashe_decor_mk_items').run();
    scheduleListChangeResyncMock.mockReset();
  });

  it('POST /api/ne-nashe-branding creates entry and schedules resync', async () => {
    const res = await request(createApp())
      .post('/api/ne-nashe-branding')
      .send({ pattern: 'Чужой брендинг', matchType: 'exact', sourceName: 'Чужой брендинг' });

    expect(res.status).toBe(201);
    expect(res.body.item).toMatchObject({
      pattern: 'чужой брендинг',
      matchType: 'exact',
      sourceName: 'Чужой брендинг',
    });
    expect(scheduleListChangeResyncMock).toHaveBeenCalledOnce();
  });

  it('GET /api/ne-nashe-branding returns items', async () => {
    const app = createApp();
    await request(app)
      .post('/api/ne-nashe-branding')
      .send({ pattern: 'тест', matchType: 'substring' });

    const res = await request(app).get('/api/ne-nashe-branding');

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].pattern).toBe('тест');
  });

  it('DELETE /api/ne-nashe-decor-mk removes entry and schedules resync', async () => {
    const app = createApp();
    const created = await request(app)
      .post('/api/ne-nashe-decor-mk')
      .send({ pattern: 'декор', matchType: 'exact' });

    scheduleListChangeResyncMock.mockReset();

    const res = await request(app).delete(`/api/ne-nashe-decor-mk/${created.body.item.id}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(scheduleListChangeResyncMock).toHaveBeenCalledOnce();

    const list = await request(app).get('/api/ne-nashe-decor-mk');
    expect(list.body.items).toEqual([]);
  });
});
