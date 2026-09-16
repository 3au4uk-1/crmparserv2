import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { attachEventBitrixLink, useCalendarFallbackForTonyOrder } from '../src/services/parser.js';
import { listDealBitrixLinks } from '../src/services/deal-bitrix-links.js';

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE deals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      crm_lead_id TEXT,
      payment_amount REAL
    );
    CREATE TABLE deal_bitrix_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      bitrix_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('payment', 'booking', 'other')),
      is_canonical INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (deal_id, bitrix_id)
    );
  `);
  db.prepare('INSERT INTO deals (crm_lead_id, payment_amount) VALUES (NULL, 0)').run();
  return db;
}

describe('attachEventBitrixLink', () => {
  let db;
  beforeEach(() => { db = createDb(); });
  afterEach(() => db.close());

  it('keeps both Bitrix ids on one booking deal', () => {
    attachEventBitrixLink(db, 1, { leadId: '2050903', title: 'точка', paymentAmount: 0 });
    attachEventBitrixLink(db, 1, { leadId: '2049067', title: 'Для оплаты', paymentAmount: 10 });
    expect(listDealBitrixLinks(db, 1).map((l) => l.bitrixId).sort()).toEqual(['2049067', '2050903']);
  });
});

describe('useCalendarFallbackForTonyOrder', () => {
  it('is true when Tony order has empty items', () => {
    expect(useCalendarFallbackForTonyOrder({ items: [] })).toBe(true);
  });

  it('is true when order is missing', () => {
    expect(useCalendarFallbackForTonyOrder(undefined)).toBe(true);
  });

  it('is false when order has items', () => {
    expect(useCalendarFallbackForTonyOrder({ items: [{ name: 'x' }] })).toBe(false);
  });
});
