import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tonyHtml = fs.readFileSync(path.join(__dirname, 'fixtures/tony-order-169120.html'), 'utf-8');

vi.mock('../src/services/tony-auth.js', () => ({
  tonyLogin: vi.fn().mockResolvedValue(undefined),
  getTonyConfig: () => ({
    baseUrl: 'https://tony.test',
    login: 'u',
    password: 'p',
  }),
}));

vi.mock('../src/services/twenty-lookup.js', () => ({
  findTwentyOpportunityIdByBooking: vi.fn().mockResolvedValue(null),
}));

vi.mock('../src/services/tony-client.js', () => ({
  fetchTonyOrderHtml: vi.fn(),
}));

vi.mock('../src/services/twenty-sync.js', () => ({
  syncDealToTwenty: vi.fn().mockResolvedValue({ twentyId: 'opp-new', action: 'created' }),
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
import { importDealByBooking } from '../src/services/import-by-booking.js';

describe('importDealByBooking', () => {
  beforeEach(() => {
    initDb();
    migrate();
    const db = getDb();
    db.prepare('DELETE FROM deal_items').run();
    db.prepare('DELETE FROM deals').run();
    db.prepare(
      `INSERT INTO settings (key, value) VALUES ('keywords', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(JSON.stringify(['брендинг', 'баннер', 'печать', 'наклейка', 'логотип']));
    vi.mocked(fetchTonyOrderHtml).mockReset();
    vi.mocked(fetchTonyOrderHtml).mockResolvedValue(tonyHtml);
  });

  it('imports a Tony-only deal and syncs to Twenty', async () => {
    const result = await importDealByBooking('169120');
    expect(result).toEqual({
      ok: true,
      opportunityId: 'opp-new',
      dealId: expect.any(Number),
    });

    const db = getDb();
    const deal = db.prepare('SELECT * FROM deals WHERE tony_order_id = ?').get('169120');
    expect(deal).toBeTruthy();
    expect(deal.deal_key).toBe('import#169120');
    expect(deal.data_source).toBe('tony');
  });

  it('returns existing opportunity when deal already synced', async () => {
    const db = getDb();
    db.prepare(`
      INSERT INTO deals (crm_event_id, deal_key, data_source, title, tony_order_id, twenty_id, approval_status)
      VALUES ('e1', 'e1#169120', 'tony', 'Deal', '169120', 'opp-existing', 'synced')
    `).run();

    const result = await importDealByBooking('169120');
    expect(result).toEqual({
      ok: true,
      opportunityId: 'opp-existing',
      dealId: expect.any(Number),
    });
    expect(fetchTonyOrderHtml).not.toHaveBeenCalled();
  });

  it('throws when Tony has no order for booking', async () => {
    vi.mocked(fetchTonyOrderHtml).mockResolvedValue(null);
    await expect(importDealByBooking('999999')).rejects.toThrow('Бронь не найдена');
  });
});
