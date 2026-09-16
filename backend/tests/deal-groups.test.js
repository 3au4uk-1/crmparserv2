import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  pickCanonicalDeal,
  confirmDealGroup,
  unlinkDealFromGroup,
  dissolveDealGroup,
  computeParentMoney,
  planExpenseRollup,
  maybeAutoSwitchCanonical,
} from '../src/services/deal-groups.js';

function createDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE deals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      crm_event_id TEXT NOT NULL,
      title TEXT NOT NULL,
      payment_amount REAL,
      twenty_id TEXT
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
    CREATE TABLE deal_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      twenty_parent_id TEXT,
      name TEXT NOT NULL,
      name_locked INTEGER NOT NULL DEFAULT 0,
      canonical_deal_id INTEGER NOT NULL REFERENCES deals(id),
      canonical_bitrix_id TEXT NOT NULL,
      canonical_locked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE deal_group_members (
      group_id INTEGER NOT NULL REFERENCES deal_groups(id) ON DELETE CASCADE,
      deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      UNIQUE (deal_id)
    );
    CREATE TABLE deal_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      price REAL,
      quantity TEXT,
      sum REAL,
      quantity_num REAL,
      classification TEXT NOT NULL DEFAULT 'unclassified'
    );
  `);

  db.prepare(
    `INSERT INTO deals (crm_event_id, title, payment_amount) VALUES (?, ?, ?)`,
  ).run('evt1', 'ПРО/Для оплаты А7', 2189149);
  db.prepare(
    `INSERT INTO deals (crm_event_id, title, payment_amount) VALUES (?, ?, ?)`,
  ).run('evt2', 'ПРО/точка А7', 0);

  db.prepare(
    `INSERT INTO deal_bitrix_links (deal_id, bitrix_id, role, is_canonical) VALUES (1, '2049067', 'payment', 1)`,
  ).run();
  db.prepare(
    `INSERT INTO deal_bitrix_links (deal_id, bitrix_id, role, is_canonical) VALUES (2, '2050903', 'booking', 1)`,
  ).run();

  return db;
}

describe('deal-groups', () => {
  let db;
  beforeEach(() => { db = createDb(); });
  afterEach(() => db.close());

  it('picks the payment smeta as canonical', () => {
    expect(pickCanonicalDeal([
      { id: 1, payment_amount: 2189149, amountRub: 936900, bitrixIds: ['2049067'] },
      { id: 2, payment_amount: 0, amountRub: 22950, bitrixIds: ['2050903'] },
    ]).dealId).toBe(1);
  });

  it('refuses to auto-pick when two members have payments', () => {
    expect(pickCanonicalDeal([
      { id: 1, payment_amount: 10, amountRub: 1, bitrixIds: ['a'] },
      { id: 2, payment_amount: 20, amountRub: 2, bitrixIds: ['b'] },
    ]).needsManual).toBe(true);
  });

  it('sums revenue and keeps payments/expenses on canonical', () => {
    const money = computeParentMoney([
      { id: 1, amountRub: 936900, payment_amount: 2189149, rashodItogo: 34870 },
      { id: 2, amountRub: 22950, payment_amount: 0, rashodItogo: 9179 },
      { id: 3, amountRub: 46560, payment_amount: 0, rashodItogo: 2400 },
      { id: 4, amountRub: 22950, payment_amount: 0, rashodItogo: 0 },
    ], 1);
    expect(money.amount).toBe(1029360);
    expect(money.summaPostupleniy).toBe(2189149);
    expect(money.rashodItogo).toBe(34870);
  });

  it('rolls child expenses onto canonical once per bitrix id', () => {
    const plan = planExpenseRollup([
      { dealId: 1, bitrixId: '2049067', amounts: { printing: 34870 } },
      { dealId: 2, bitrixId: '2050903', amounts: { printing: 9179 } },
      { dealId: 2, bitrixId: '2050903', amounts: { printing: 9179 } },
    ], 1);
    expect(plan.amounts.printing).toBe(34870 + 9179);
  });

  it('auto-picks max-revenue deal when no payments and no canonicalDealId', () => {
    db.prepare('UPDATE deals SET payment_amount = 0 WHERE id IN (1, 2)').run();
    db.prepare(
      `INSERT INTO deal_items (deal_id, name, price, sum, classification) VALUES (1, 'small', 1000, 1000, 'banner')`,
    ).run();
    db.prepare(
      `INSERT INTO deal_items (deal_id, name, price, sum, classification) VALUES (2, 'large', 50000, 50000, 'banner')`,
    ).run();
    const group = confirmDealGroup(db, { dealIds: [1, 2] });
    expect(group.canonical_deal_id).toBe(2);
  });

  it('confirm then unlink dissolves a singleton group', () => {
    const group = confirmDealGroup(db, { dealIds: [1, 2], name: 'А7' });
    expect(group.id).toBeTruthy();
    unlinkDealFromGroup(db, 2);
    const after = unlinkDealFromGroup(db, 1);
    expect(after.dissolved).toBe(true);
    expect(db.prepare('SELECT COUNT(*) AS n FROM deal_groups').get().n).toBe(0);
  });

  it('does not auto-switch locked canonical when another smeta gets paid', () => {
    confirmDealGroup(db, { dealIds: [1, 2], canonicalDealId: 2, canonicalLocked: true });
    db.prepare('UPDATE deals SET payment_amount = 500 WHERE id = 1').run();
    expect(maybeAutoSwitchCanonical(db, 1)).toBe(false);
  });

  it('auto-switches unlocked canonical to the sole paid smeta', () => {
    db.prepare('UPDATE deals SET payment_amount = 0 WHERE id = 1').run();
    confirmDealGroup(db, { dealIds: [1, 2], canonicalDealId: 2, canonicalLocked: false });
    db.prepare('UPDATE deals SET payment_amount = 500 WHERE id = 1').run();
    expect(maybeAutoSwitchCanonical(db, 1)).toBe(true);
    const group = db.prepare(
      'SELECT canonical_deal_id, canonical_bitrix_id FROM deal_groups WHERE id = 1',
    ).get();
    expect(group.canonical_deal_id).toBe(1);
    expect(group.canonical_bitrix_id).toBe('2049067');
  });

  it('rejects deal already in another group', () => {
    confirmDealGroup(db, { dealIds: [1, 2], name: 'А7' });
    db.prepare(
      `INSERT INTO deals (crm_event_id, title, payment_amount) VALUES (?, ?, ?)`,
    ).run('evt3', 'ПРО/другая', 0);
    db.prepare(
      `INSERT INTO deal_bitrix_links (deal_id, bitrix_id, role, is_canonical) VALUES (3, '999', 'booking', 1)`,
    ).run();
    expect(() => confirmDealGroup(db, { dealIds: [2, 3], name: 'B' })).toThrow(
      expect.objectContaining({ code: 'ALREADY_GROUPED', dealId: 2, status: 409 }),
    );
  });

  it('defaults name from canonical title and dissolve removes members', () => {
    const group = confirmDealGroup(db, { dealIds: [1, 2], canonicalDealId: 1 });
    expect(group.name).toBe('ПРО/Для оплаты А7');
    expect(group.name_locked ?? group.nameLocked).toBeFalsy();
    dissolveDealGroup(db, group.id);
    expect(db.prepare('SELECT COUNT(*) AS n FROM deal_groups').get().n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM deal_group_members').get().n).toBe(0);
  });
});
