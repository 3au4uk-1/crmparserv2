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
      twenty_id TEXT
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
    expect(map['Баннер']).toEqual({ sync_override: 'exclude', twenty_id: 'li-1' });
    expect(map['Кейтеринг']).toBeUndefined();
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
