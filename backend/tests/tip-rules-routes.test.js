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

vi.mock('../src/services/twenty-sync.js', () => ({
  buildSyncPreview: vi.fn(),
  resyncDealIfSynced: vi.fn().mockResolvedValue(null),
  syncDealToTwenty: vi.fn(),
}));

import { getDb, initDb } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import tipRulesRouter from '../src/routes/tip-rules.js';
import podryadRouter from '../src/routes/podryad.js';
import bannerRouter from '../src/routes/banner.js';
import dealsRouter from '../src/routes/deals.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/tip-rules', tipRulesRouter);
  app.use('/api/podryad', podryadRouter);
  app.use('/api/banner', bannerRouter);
  app.use('/api/deals', dealsRouter);
  return app;
}

describe('tip rules routes', () => {
  beforeEach(() => {
    initDb();
    migrate();
    getDb().prepare('DELETE FROM tip_rules').run();
    scheduleListChangeResyncMock.mockReset();
  });

  it('POST creates a tip rule and schedules a list-change resync', async () => {
    const res = await request(createApp())
      .post('/api/tip-rules')
      .send({
        pattern: '  Custom Banner  ',
        matchType: 'exact',
        tip: 'BANNERA',
        priority: 25,
        sourceName: 'Custom Banner',
      });

    expect(res.status).toBe(201);
    expect(res.body.item).toMatchObject({
      pattern: 'custom banner',
      matchType: 'exact',
      tip: 'BANNERA',
      priority: 25,
      sourceName: 'Custom Banner',
    });
    expect(scheduleListChangeResyncMock).toHaveBeenCalledOnce();
  });

  it('GET filters tip rules by tip', async () => {
    const db = getDb();
    db.prepare(`
      INSERT INTO tip_rules (pattern, match_type, tip, priority)
      VALUES ('podryad', 'exact', 'PODRYAD', 100),
             ('banner', 'exact', 'BANNERA', 100)
    `).run();

    const res = await request(createApp()).get('/api/tip-rules?tip=PODRYAD');

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({ pattern: 'podryad', tip: 'PODRYAD' });
  });

  it('DELETE returns 404 when the tip rule does not exist', async () => {
    const res = await request(createApp()).delete('/api/tip-rules/999');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Tip rule not found' });
    expect(scheduleListChangeResyncMock).not.toHaveBeenCalled();
  });

  it.each([
    ['/api/podryad', 'PODRYAD'],
    ['/api/banner', 'BANNERA'],
  ])('%s stores legacy entries as %s tip rules', async (path, tip) => {
    const createRes = await request(createApp())
      .post(path)
      .send({ pattern: `Legacy ${tip}`, matchType: 'exact', sourceName: tip });

    expect(createRes.status).toBe(201);
    expect(createRes.body.item).toMatchObject({ pattern: `legacy ${tip.toLowerCase()}`, tip });

    const listRes = await request(createApp()).get(path);
    expect(listRes.status).toBe(200);
    expect(listRes.body.items).toHaveLength(1);
    expect(listRes.body.items[0].tip).toBe(tip);
  });

  it.each([
    ['podryad', 'PODRYAD'],
    ['banner', 'BANNERA'],
  ])('deal item %s shortcut creates a %s tip rule', async (shortcut, tip) => {
    const db = getDb();
    const deal = db.prepare(`
      INSERT INTO deals (crm_event_id, deal_key, data_source, title)
      VALUES ('evt-tip', 'evt-tip#cal', 'calendar', 'Tip test')
    `).run();
    const item = db.prepare(`
      INSERT INTO deal_items (deal_id, name)
      VALUES (?, 'Shortcut Item')
    `).run(deal.lastInsertRowid);

    const res = await request(createApp())
      .post(`/api/deals/${deal.lastInsertRowid}/items/${item.lastInsertRowid}/${shortcut}`);

    expect(res.status).toBe(200);
    expect(db.prepare('SELECT pattern, tip FROM tip_rules').get()).toEqual({
      pattern: 'shortcut item',
      tip,
    });
  });
});
