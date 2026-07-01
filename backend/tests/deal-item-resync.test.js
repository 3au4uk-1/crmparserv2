import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const resyncDealIfSyncedMock = vi.fn();

vi.mock('../src/services/twenty-sync.js', () => ({
  syncDealToTwenty: vi.fn(),
  buildSyncPreview: vi.fn(),
  resyncDealIfSynced: (...args) => resyncDealIfSyncedMock(...args),
}));

vi.mock('../src/services/blacklist.js', () => ({
  loadBlacklist: () => [],
  createBlacklistEntry: vi.fn(() => ({ id: 1, pattern: 'test', matchType: 'exact' })),
}));

vi.mock('../src/services/restoration.js', () => ({
  loadRestorationList: () => [],
  createRestorationEntry: vi.fn(() => ({ id: 1, pattern: 'test', matchType: 'exact' })),
}));

import { getDb, initDb } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import dealsRouter from '../src/routes/deals.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/deals', dealsRouter);
  return app;
}

describe('deal item mutations auto-resync', () => {
  let dealId;
  let itemId;

  beforeEach(() => {
    initDb();
    migrate();
    const db = getDb();
    db.prepare('DELETE FROM deal_items').run();
    db.prepare('DELETE FROM deals').run();
    resyncDealIfSyncedMock.mockReset();
    resyncDealIfSyncedMock.mockResolvedValue({ action: 'updated', twentyId: 'opp-1' });

    const r = db.prepare(`
      INSERT INTO deals (crm_event_id, deal_key, data_source, title, twenty_id, approval_status)
      VALUES ('evt1', 'evt1#cal', 'calendar', 'Test', 'opp-1', 'synced')
    `).run();
    dealId = r.lastInsertRowid;
    const ir = db.prepare(`
      INSERT INTO deal_items (deal_id, name, price, quantity, classification)
      VALUES (?, 'Banner', 1000, '1', 'keyword_match')
    `).run(dealId);
    itemId = ir.lastInsertRowid;
  });

  it('PATCH sync-override triggers resyncDealIfSynced', async () => {
    const res = await request(createApp())
      .patch(`/deals/${dealId}/items/${itemId}/sync-override`)
      .send({ syncOverride: 'exclude' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      sync: { action: 'updated', twentyId: 'opp-1' },
    });
    expect(resyncDealIfSyncedMock).toHaveBeenCalledWith(dealId);
  });
});
