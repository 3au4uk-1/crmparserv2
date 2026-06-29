import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { bookingDealKey } from '../src/services/deal-keys.js';

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE deals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      crm_event_id TEXT NOT NULL,
      deal_key TEXT UNIQUE,
      data_source TEXT NOT NULL DEFAULT 'calendar',
      tony_order_id TEXT,
      title TEXT,
      twenty_id TEXT
    );
  `);
  return db;
}

describe('booking-centric deal identity', () => {
  let db;
  beforeEach(() => { db = createDb(); });
  afterEach(() => { db.close(); });

  it('two events with the same booking share one deal_key', () => {
    const key = bookingDealKey('173982');

    db.prepare(`
      INSERT INTO deals (crm_event_id, deal_key, data_source, title, tony_order_id)
      VALUES ('evt-a', ?, 'tony', 'АРТ // 173982 // ПРЕДОПЛАТА/Силакова', '173982')
    `).run(key);

    const existing = db.prepare('SELECT * FROM deals WHERE deal_key = ?').get(key);
    expect(existing).toBeTruthy();

    expect(() => db.prepare(`
      INSERT INTO deals (crm_event_id, deal_key, data_source, title, tony_order_id)
      VALUES ('evt-b', ?, 'tony', 'АРТ // 173982/Лоскутникова', '173982')
    `).run(key)).toThrow();

    db.prepare(`
      UPDATE deals SET title = ?, crm_event_id = ? WHERE deal_key = ?
    `).run('АРТ // 173982/Лоскутникова', 'evt-b', key);

    const count = db.prepare("SELECT COUNT(*) c FROM deals WHERE tony_order_id = '173982'").get().c;
    expect(count).toBe(1);
  });
});
