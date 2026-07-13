import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const syncDealToTwentyMock = vi.fn();
const scheduleListChangeResyncMock = vi.fn();

vi.mock('../src/config.js', () => ({
  config: {
    twentyAppApiSecret: 'test-secret',
    dbPath: ':memory:',
  },
}));

vi.mock('../src/services/twenty-sync.js', () => ({
  syncDealToTwenty: (...args) => syncDealToTwentyMock(...args),
}));

vi.mock('../src/services/list-change-resync.js', () => ({
  scheduleListChangeResync: (...args) => scheduleListChangeResyncMock(...args),
}));

import { getDb, initDb } from '../src/db/connection.js';
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

describe('twenty routes', () => {
  beforeEach(() => {
    initDb();
    migrate();
    const db = getDb();
    db.prepare('DELETE FROM deal_items').run();
    db.prepare('DELETE FROM deals').run();
    syncDealToTwentyMock.mockReset();
    scheduleListChangeResyncMock.mockReset();
    syncDealToTwentyMock.mockResolvedValue({ action: 'updated', twentyId: 'opp-1' });

    const dealResult = db.prepare(`
      INSERT INTO deals (crm_event_id, deal_key, data_source, title, twenty_id, approval_status)
      VALUES ('evt1', 'evt1#cal', 'calendar', 'Test', 'opp-1', 'synced')
    `).run();

    db.prepare(`
      INSERT INTO deal_items (deal_id, name, price, quantity, classification, twenty_id)
      VALUES (?, 'Banner', 1000, '1', 'keyword_match', 'li-1')
    `).run(dealResult.lastInsertRowid);
  });

  it('returns 401 without bearer token', async () => {
    const res = await request(createApp()).get('/api/twenty/line-items/li-1/list-status');
    expect(res.status).toBe(401);
  });

  it('GET list-status returns flags', async () => {
    const res = await request(createApp())
      .get('/api/twenty/line-items/li-1/list-status')
      .set('Authorization', 'Bearer test-secret');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      blacklisted: false,
      restorationMatch: false,
      pattern: 'Banner',
      dealTwentyId: 'opp-1',
    });
  });

  it('POST add-to-list creates entry and resyncs deal', async () => {
    const res = await request(createApp())
      .post('/api/twenty/line-items/li-1/add-to-list')
      .set('Authorization', 'Bearer test-secret')
      .send({ list: 'restoration' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.sync).toBeUndefined();
    expect(scheduleListChangeResyncMock).toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(syncDealToTwentyMock).toHaveBeenCalledWith(1, { ignoreLineItemStageProtection: true });
    const db = getDb();
    expect(db.prepare('SELECT COUNT(*) AS c FROM restoration_items').get().c).toBe(1);
  });

  it('POST opportunity resync by twenty id', async () => {
    const res = await request(createApp())
      .post('/api/twenty/opportunities/opp-1/resync')
      .set('Authorization', 'Bearer test-secret');

    expect(res.status).toBe(200);
    expect(syncDealToTwentyMock).toHaveBeenCalledWith(1, { ignoreLineItemStageProtection: true });
  });
});
