import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

let testDbPath;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tonyHtml = fs.readFileSync(path.join(__dirname, 'fixtures/tony-order-169120.html'), 'utf-8');

vi.mock('../src/services/tony-auth.js', () => ({
  tonyLogin: vi.fn().mockResolvedValue(undefined),
  getTonyConfig: () => ({ baseUrl: 'https://tony.test', login: 'u', password: 'p' }),
}));

vi.mock('../src/services/tony-client.js', () => ({
  fetchTonyOrderHtml: vi.fn(),
}));

vi.mock('../src/services/twenty-sync.js', () => ({
  resyncDealIfSynced: vi.fn().mockResolvedValue({ action: 'updated', twentyId: 'opp-1' }),
}));

vi.mock('../src/services/calendar-deal-metadata.js', () => ({
  refreshDealCalendarMetadata: vi.fn().mockImplementation(async (dealId) => {
    const { getDb } = await import('../src/db/connection.js');
    return getDb().prepare('SELECT * FROM deals WHERE id = ?').get(dealId);
  }),
}));

vi.mock('../src/services/classifier.js', () => ({
  classifyItems: vi.fn(async (items) =>
    items.map((item) => ({
      ...item,
      classification: 'keyword_match',
      classification_confidence: 1,
    })),
  ),
}));

import { getDb, initDb } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { fetchTonyOrderHtml } from '../src/services/tony-client.js';
import { resyncDealIfSynced } from '../src/services/twenty-sync.js';
import { refreshDealCalendarMetadata } from '../src/services/calendar-deal-metadata.js';
import { attachTonyBooking } from '../src/services/attach-tony-booking.js';
import { bookingDealKey } from '../src/services/deal-keys.js';

describe('attachTonyBooking', () => {
  beforeEach(() => {
    testDbPath = path.join(os.tmpdir(), `attach-tony-${Date.now()}-${Math.random()}.db`);
    process.env.DB_PATH = testDbPath;
    initDb();
    migrate();
    const db = getDb();
    db.prepare('DELETE FROM deal_items').run();
    db.prepare('DELETE FROM deals').run();
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('keywords', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(JSON.stringify(['брендинг', 'баннер', 'печать']));
    vi.mocked(fetchTonyOrderHtml).mockResolvedValue(tonyHtml);
    vi.mocked(resyncDealIfSynced).mockClear();
  });

  afterEach(() => {
    try {
      getDb().close();
    } catch { /* not initialized */ }
    if (testDbPath && fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    delete process.env.DB_PATH;
  });

  it('attaches booking to calendar deal and preserves sync_override', async () => {
    const db = getDb();
    const dealInsert = db.prepare(`
      INSERT INTO deals (crm_event_id, deal_key, data_source, title, company_code, twenty_id, approval_status)
      VALUES ('evt1', 'evt1#cal', 'calendar', 'Calendar Event', 'ACME', 'opp-1', 'synced')
    `).run();
    const dealId = dealInsert.lastInsertRowid;
    db.prepare(`
      INSERT INTO deal_items (deal_id, name, price, quantity, classification, sync_override)
      VALUES (?, 'Old banner', 500, '1', 'keyword_match', 'include')
    `).run(dealId);

    const result = await attachTonyBooking(dealId, '169120');

    expect(result.bookingNumber).toBe('169120');
    const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(dealId);
    expect(deal.tony_order_id).toBe('169120');
    expect(deal.deal_key).toBe(bookingDealKey('169120'));
    expect(deal.data_source).toBe('tony');
    expect(deal.title).toBe('Calendar Event');
    expect(deal.company_code).toBe('ACME');
    expect(resyncDealIfSynced).toHaveBeenCalledWith(dealId);
    expect(refreshDealCalendarMetadata).toHaveBeenCalledWith(dealId);

    const items = db.prepare('SELECT * FROM deal_items WHERE deal_id = ?').all(dealId);
    expect(items.length).toBeGreaterThan(0);
  });

  it('throws 409 when booking owned by another deal', async () => {
    const db = getDb();
    db.prepare(`
      INSERT INTO deals (crm_event_id, deal_key, data_source, title, tony_order_id)
      VALUES ('evt2', 'booking#169120', 'tony', 'Other', '169120')
    `).run();
    const cal = db.prepare(`
      INSERT INTO deals (crm_event_id, deal_key, data_source, title)
      VALUES ('evt1', 'evt1#cal', 'calendar', 'Mine')
    `).run();

    await expect(attachTonyBooking(cal.lastInsertRowid, '169120')).rejects.toMatchObject({
      status: 409,
    });
  });
});
