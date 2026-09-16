import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  inferBitrixLinkRole,
  upsertDealBitrixLink,
  listDealBitrixLinks,
  mirrorCanonicalCrmLeadId,
  buildBitrixLinkInput,
} from '../src/services/deal-bitrix-links.js';

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
  db.prepare('INSERT INTO deals (crm_lead_id) VALUES (NULL)').run();
  return db;
}

describe('deal-bitrix-links', () => {
  let db;
  beforeEach(() => { db = createDb(); });
  afterEach(() => db.close());

  it('infers payment from title or amount', () => {
    expect(inferBitrixLinkRole({ eventTitle: 'ПРО/Для оплаты А7', paymentAmount: 0 })).toBe('payment');
    expect(inferBitrixLinkRole({ eventTitle: 'ПРО/точка', paymentAmount: 100 })).toBe('payment');
    expect(inferBitrixLinkRole({ eventTitle: 'ПРО/точка', paymentAmount: 0 })).toBe('booking');
  });

  it('appends a second Bitrix id without wiping the first', () => {
    upsertDealBitrixLink(db, { dealId: 1, bitrixId: '111', role: 'booking', isCanonical: true });
    upsertDealBitrixLink(db, { dealId: 1, bitrixId: '222', role: 'payment' });
    const links = listDealBitrixLinks(db, 1);
    expect(links.map((l) => l.bitrixId).sort()).toEqual(['111', '222']);
    expect(links.filter((l) => l.isCanonical)).toHaveLength(1);
  });

  it('mirrors canonical bitrix onto deals.crm_lead_id', () => {
    upsertDealBitrixLink(db, { dealId: 1, bitrixId: '111', role: 'booking', isCanonical: true });
    upsertDealBitrixLink(db, { dealId: 1, bitrixId: '222', role: 'payment' });
    mirrorCanonicalCrmLeadId(db, 1);
    expect(db.prepare('SELECT crm_lead_id FROM deals WHERE id = 1').get().crm_lead_id).toBe('111');
  });

  it('builds Twenty LINKS with secondary urls', () => {
    const input = buildBitrixLinkInput([
      { bitrixId: '111', isCanonical: true },
      { bitrixId: '222', isCanonical: false },
    ]);
    expect(input.primaryLinkLabel).toBe('Bitrix #111');
    expect(input.secondaryLinks).toEqual([
      { url: 'https://prointeractive.bitrix24.ru/crm/deal/details/222/?any', label: 'Bitrix #222' },
    ]);
  });
});
