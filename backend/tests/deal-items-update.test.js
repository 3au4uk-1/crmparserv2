import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  buildOverrideMap,
  replaceDealItemsPreservingOverrides,
} from '../src/services/deal-items-update.js';

function createTestDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE deals (id INTEGER PRIMARY KEY, title TEXT);
    CREATE TABLE deal_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      price REAL,
      quantity TEXT,
      discount REAL,
      classification TEXT NOT NULL DEFAULT 'unclassified',
      classification_confidence REAL,
      comment TEXT,
      sum REAL,
      quantity_num REAL,
      sync_override TEXT,
      twenty_id TEXT,
      amount_locked INTEGER NOT NULL DEFAULT 0
    );
    INSERT INTO deals (id, title) VALUES (1, 'Test');
  `);
  return db;
}

describe('deal-items-update', () => {
  let db;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it('buildOverrideMap keeps sync_override and twenty_id by name', () => {
    const map = buildOverrideMap([
      { name: 'Баннер', sync_override: 'exclude', twenty_id: 'li-1' },
      { name: 'Кейтеринг', sync_override: null, twenty_id: null },
    ]);
    expect(map['Баннер#0']).toEqual({
      sync_override: 'exclude',
      twenty_id: 'li-1',
      amount_locked: 0,
      sum: undefined,
      price: undefined,
    });
    expect(map['Баннер']).toBeUndefined();
    expect(map['Кейтеринг']).toBeUndefined();
  });

  it('buildOverrideMap keeps distinct twenty_id for duplicate names', () => {
    const map = buildOverrideMap([
      { name: 'Макет', sync_override: null, twenty_id: 'li-a', amount_locked: 0 },
      { name: 'Макет', sync_override: null, twenty_id: 'li-b', amount_locked: 1, sum: 10000, price: 10000 },
    ]);
    expect(map['Макет#0'].twenty_id).toBe('li-a');
    expect(map['Макет#1'].twenty_id).toBe('li-b');
    expect(map['Макет#1'].amount_locked).toBe(1);
    expect(map['Макет']).toBeUndefined();
  });

  it('restores overrides for matching names after replace', () => {
    db.prepare(`
      INSERT INTO deal_items (deal_id, name, price, classification, sync_override, twenty_id)
      VALUES (1, 'Баннер', 100, 'keyword_match', 'exclude', 'li-old')
    `).run();

    const existing = db.prepare('SELECT * FROM deal_items WHERE deal_id = 1').all();
    const overrideMap = buildOverrideMap(existing);

    replaceDealItemsPreservingOverrides(db, 1, [
      { name: 'Баннер', price: 200, quantity: null, discount: null, classification: 'keyword_match', classification_confidence: 1 },
      { name: 'Наклейки', price: 50, quantity: null, discount: null, classification: 'llm_confirmed', classification_confidence: 0.9 },
    ], overrideMap);

    const items = db.prepare('SELECT * FROM deal_items WHERE deal_id = 1 ORDER BY name').all();
    expect(items).toHaveLength(2);

    const banner = items.find((i) => i.name === 'Баннер');
    expect(banner.price).toBe(200);
    expect(banner.sync_override).toBe('exclude');
    expect(banner.twenty_id).toBe('li-old');

    const stickers = items.find((i) => i.name === 'Наклейки');
    expect(stickers.sync_override).toBeNull();
    expect(stickers.twenty_id).toBeNull();
  });

  it('buildOverrideMap keeps amount_locked sum and price by name', () => {
    const map = buildOverrideMap([
      {
        name: 'Баннер',
        sync_override: null,
        twenty_id: 'li-locked',
        amount_locked: 1,
        sum: 7500,
        price: 7500,
      },
    ]);
    expect(map['Баннер#0']).toEqual({
      sync_override: null,
      twenty_id: 'li-locked',
      amount_locked: 1,
      sum: 7500,
      price: 7500,
    });
  });

  it('replace restores different twenty_id onto duplicate names in order', () => {
    db.prepare(`
      INSERT INTO deal_items (deal_id, name, price, classification, twenty_id)
      VALUES
        (1, 'Макет', 100, 'keyword_match', 'li-a'),
        (1, 'Макет', 200, 'keyword_match', 'li-b')
    `).run();
    const existing = db.prepare('SELECT * FROM deal_items WHERE deal_id = 1 ORDER BY id').all();
    const overrideMap = buildOverrideMap(existing);
    replaceDealItemsPreservingOverrides(db, 1, [
      { name: 'Макет', price: 111, quantity: null, discount: null, classification: 'keyword_match', classification_confidence: 1 },
      { name: 'Макет', price: 222, quantity: null, discount: null, classification: 'keyword_match', classification_confidence: 1 },
    ], overrideMap);
    const items = db.prepare('SELECT * FROM deal_items WHERE deal_id = 1 ORDER BY id').all();
    expect(items.map((i) => i.twenty_id)).toEqual(['li-a', 'li-b']);
  });

  it('preserves locked sum and price after replace with different Tony prices', () => {
    db.prepare(`
      INSERT INTO deal_items (deal_id, name, price, sum, classification, twenty_id, amount_locked)
      VALUES (1, 'Баннер', 7500, 7500, 'keyword_match', 'li-locked', 1)
    `).run();

    const existing = db.prepare('SELECT * FROM deal_items WHERE deal_id = 1').all();
    const overrideMap = buildOverrideMap(existing);

    replaceDealItemsPreservingOverrides(db, 1, [
      {
        name: 'Баннер',
        price: 10000,
        quantity: '1',
        discount: null,
        classification: 'keyword_match',
        classification_confidence: 1,
        sum: 10000,
        quantity_num: 1,
      },
    ], overrideMap);

    const banner = db.prepare('SELECT * FROM deal_items WHERE deal_id = 1').get();
    expect(banner.amount_locked).toBe(1);
    expect(banner.sum).toBe(7500);
    expect(banner.price).toBe(7500);
    expect(banner.twenty_id).toBe('li-locked');
  });

  it('persists Tony item comment, sum, and quantity_num', () => {
    replaceDealItemsPreservingOverrides(db, 1, [
      {
        name: 'Навигационные наклейки',
        price: 2640,
        quantity: '9',
        discount: 0,
        classification: 'keyword_match',
        classification_confidence: 1,
        comment: '+ монтаж',
        sum: 23760,
        quantity_num: 9,
      },
    ], {});

    const item = db.prepare('SELECT * FROM deal_items WHERE deal_id = 1').get();
    expect(item.comment).toBe('+ монтаж');
    expect(item.sum).toBe(23760);
    expect(item.quantity_num).toBe(9);
  });
});
