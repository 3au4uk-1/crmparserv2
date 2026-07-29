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
import { resetPatternListsCacheForTests } from '../src/services/pattern-lists-cache.js';
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
    resetPatternListsCacheForTests();
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
      known: true,
      blacklisted: false,
      restorationMatch: false,
      pattern: 'Banner',
      dealTwentyId: 'opp-1',
    });
  });

  it('GET list-status returns neutral status for unknown line item', async () => {
    const res = await request(createApp())
      .get('/api/twenty/line-items/li-missing/list-status')
      .set('Authorization', 'Bearer test-secret');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      known: false,
      blacklisted: false,
      restorationMatch: false,
      neNasheBrandingMatch: false,
      neNasheDecorMkMatch: false,
      podryadMatch: false,
      bannerMatch: false,
    });
  });

  it('GET list-status returns ne-nashe flags when matched', async () => {
    const db = getDb();
    db.prepare(`
      INSERT INTO ne_nashe_branding_items (pattern, match_type, source_name)
      VALUES ('banner', 'exact', 'Banner')
    `).run();
    resetPatternListsCacheForTests();

    const res = await request(createApp())
      .get('/api/twenty/line-items/li-1/list-status')
      .set('Authorization', 'Bearer test-secret');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      known: true,
      neNasheBrandingMatch: true,
      neNasheDecorMkMatch: false,
    });
  });

  it('POST line-items amount locks sum and syncs deal', async () => {
    const res = await request(createApp())
      .post('/api/twenty/line-items/li-1/amount')
      .set('Authorization', 'Bearer test-secret')
      .send({ amountRub: 15000 });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      amountRub: 15000,
      opportunityAmountRub: 15000,
      dealId: 1,
      sync: { action: 'updated', twentyId: 'opp-1' },
    });
    expect(syncDealToTwentyMock).toHaveBeenCalledWith(1, { ignoreLineItemStageProtection: true });

    const db = getDb();
    const row = db.prepare('SELECT amount_locked, sum FROM deal_items WHERE twenty_id = ?').get('li-1');
    expect(row.amount_locked).toBe(1);
    expect(row.sum).toBe(15000);
  });

  it('POST line-items amount returns 404 for unknown id', async () => {
    const res = await request(createApp())
      .post('/api/twenty/line-items/li-missing/amount')
      .set('Authorization', 'Bearer test-secret')
      .send({ amountRub: 1000 });

    expect(res.status).toBe(404);
    expect(res.body.error).toContain('Line item not found');
    expect(syncDealToTwentyMock).not.toHaveBeenCalled();
  });

  it('POST line-items amount returns 400 for restoration item', async () => {
    const db = getDb();
    db.prepare(`
      INSERT INTO restoration_items (pattern, match_type, source_name)
      VALUES ('banner', 'exact', 'Banner')
    `).run();
    resetPatternListsCacheForTests();

    const res = await request(createApp())
      .post('/api/twenty/line-items/li-1/amount')
      .set('Authorization', 'Bearer test-secret')
      .send({ amountRub: 15000 });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('restoration');
    expect(syncDealToTwentyMock).not.toHaveBeenCalled();
  });

  it('POST add-to-list accepts ne_nashe_branding', async () => {
    const res = await request(createApp())
      .post('/api/twenty/line-items/li-1/add-to-list')
      .set('Authorization', 'Bearer test-secret')
      .send({ list: 'ne_nashe_branding' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const db = getDb();
    expect(db.prepare('SELECT COUNT(*) AS c FROM ne_nashe_branding_items').get().c).toBe(1);
  });

  it('POST add-to-list accepts ne_nashe_decor_mk', async () => {
    const res = await request(createApp())
      .post('/api/twenty/line-items/li-1/add-to-list')
      .set('Authorization', 'Bearer test-secret')
      .send({ list: 'ne_nashe_decor_mk' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const db = getDb();
    expect(db.prepare('SELECT COUNT(*) AS c FROM ne_nashe_decor_mk_items').get().c).toBe(1);
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

  it('POST line-items sync upserts manual row', async () => {
    const res = await request(createApp())
      .post('/api/twenty/line-items/li-manual/sync')
      .set('Authorization', 'Bearer test-secret')
      .send({
        opportunityId: 'opp-1',
        name: 'Баннер',
        kolichestvo: 2,
        amountMicros: 1_500_000_000,
        currencyCode: 'RUB',
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, dealItemId: expect.any(Number) });
    const db = getDb();
    const row = db.prepare('SELECT * FROM deal_items WHERE twenty_id = ?').get('li-manual');
    expect(row.classification).toBe('manual_twenty');
    expect(row.sync_override).toBe('include');
    expect(row.name).toBe('Баннер');
    expect(row.quantity_num).toBe(2);
    expect(row.sum).toBe(1500);
  });

  it('POST line-items archive sets exclude', async () => {
    const res = await request(createApp())
      .post('/api/twenty/line-items/li-1/archive')
      .set('Authorization', 'Bearer test-secret');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    const db = getDb();
    const row = db.prepare('SELECT sync_override FROM deal_items WHERE twenty_id = ?').get('li-1');
    expect(row.sync_override).toBe('exclude');
  });
});
