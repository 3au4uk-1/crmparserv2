import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

const fetchEventsMock = vi.fn();

vi.mock('../src/services/auth.js', () => ({
  authenticate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/services/parser.js', () => ({
  fetchEvents: (...args) => fetchEventsMock(...args),
}));

import { getDb, initDb } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { refreshDealCalendarMetadata } from '../src/services/calendar-deal-metadata.js';

let testDbPath;

describe('refreshDealCalendarMetadata', () => {
  beforeEach(() => {
    testDbPath = path.join(os.tmpdir(), `cal-meta-${Date.now()}-${Math.random()}.db`);
    process.env.DB_PATH = testDbPath;
    initDb();
    migrate();
    const db = getDb();
    db.prepare('DELETE FROM deals').run();
    fetchEventsMock.mockReset();
  });

  afterEach(() => {
    try {
      getDb().close();
    } catch { /* not initialized */ }
    if (testDbPath && fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    delete process.env.DB_PATH;
  });

  it('updates title from calendar event', async () => {
    const db = getDb();
    const insert = db.prepare(`
      INSERT INTO deals (crm_event_id, deal_key, data_source, title, start_date)
      VALUES ('evt-42', 'evt-42#cal', 'calendar', 'Old title', '2026-07-10T00:00:00+03:00')
    `).run();
    const dealId = insert.lastInsertRowid;

    fetchEventsMock.mockResolvedValue([
      {
        id: 'evt-42',
        original_id: 'evt-42',
        title: 'ПРО 10.07 Иванов / Клиент',
        leadid: '99',
        start: '2026-07-10T00:00:00+03:00',
      },
    ]);

    const updated = await refreshDealCalendarMetadata(dealId);
    expect(updated.title).toBe('ПРО 10.07 Иванов / Клиент');
    expect(updated.crm_lead_id).toBe('99');
  });

  it('skips import deals', async () => {
    const db = getDb();
    const insert = db.prepare(`
      INSERT INTO deals (crm_event_id, deal_key, data_source, title)
      VALUES ('import', 'booking#1', 'tony', 'Бронь №1')
    `).run();

    const updated = await refreshDealCalendarMetadata(insert.lastInsertRowid);
    expect(updated.title).toBe('Бронь №1');
    expect(fetchEventsMock).not.toHaveBeenCalled();
  });
});
