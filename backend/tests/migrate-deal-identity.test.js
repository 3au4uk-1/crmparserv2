import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';

let migrateDb;

vi.mock('../src/db/connection.js', () => ({
  getDb: () => migrateDb,
  initDb: () => migrateDb,
}));

import { migrateDealIdentity, migrateBookingCentricDealKeys, migrate } from '../src/db/migrate.js';

function createLegacyDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE deals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      crm_event_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      tony_order_id TEXT
    );
    CREATE TABLE deal_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      name TEXT NOT NULL
    );
    CREATE TABLE sync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      status TEXT NOT NULL
    );
    INSERT INTO deals (crm_event_id, title, tony_order_id) VALUES ('evt1', 'A', '169120');
    INSERT INTO deals (crm_event_id, title, tony_order_id) VALUES ('evt2', 'B', NULL);
    INSERT INTO deal_items (deal_id, name) VALUES (1, 'banner');
    INSERT INTO sync_runs (deal_id, status) VALUES (1, 'ok');
  `);
  return db;
}

describe('migrateDealIdentity', () => {
  let db;
  beforeEach(() => { db = createLegacyDb(); });
  afterEach(() => { db.close(); });

  it('adds new columns and backfills deal_key/data_source', () => {
    migrateDealIdentity(db);
    const rows = db.prepare('SELECT crm_event_id, deal_key, data_source FROM deals ORDER BY crm_event_id').all();
    expect(rows[0]).toMatchObject({ crm_event_id: 'evt1', deal_key: 'evt1#169120', data_source: 'calendar' });
    expect(rows[1]).toMatchObject({ crm_event_id: 'evt2', deal_key: 'evt2#cal', data_source: 'calendar' });
  });

  it('drops the UNIQUE constraint on crm_event_id (allows two deals per event)', () => {
    migrateDealIdentity(db);
    db.prepare("INSERT INTO deals (crm_event_id, title, tony_order_id, deal_key, data_source) VALUES ('evt1', 'A2', '168973', 'evt1#168973', 'tony')").run();
    const count = db.prepare("SELECT COUNT(*) c FROM deals WHERE crm_event_id = 'evt1'").get().c;
    expect(count).toBe(2);
  });

  it('enforces uniqueness on deal_key', () => {
    migrateDealIdentity(db);
    expect(() =>
      db.prepare("INSERT INTO deals (crm_event_id, title, deal_key, data_source) VALUES ('evt1', 'dup', 'evt1#169120', 'tony')").run()
    ).toThrow();
  });

  it('is idempotent', () => {
    migrateDealIdentity(db);
    expect(() => migrateDealIdentity(db)).not.toThrow();
    const count = db.prepare('SELECT COUNT(*) c FROM deals').get().c;
    expect(count).toBe(2);
  });

  it('preserves child foreign keys to deals(id) and cascade behavior', () => {
    migrateDealIdentity(db);

    const itemsFk = db.prepare('PRAGMA foreign_key_list(deal_items)').all();
    const runsFk = db.prepare('PRAGMA foreign_key_list(sync_runs)').all();
    expect(itemsFk[0].table).toBe('deals');
    expect(runsFk[0].table).toBe('deals');

    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);

    db.prepare("DELETE FROM deals WHERE id = 1").run();
    expect(db.prepare('SELECT COUNT(*) c FROM deal_items').get().c).toBe(0);
    expect(db.prepare('SELECT COUNT(*) c FROM sync_runs').get().c).toBe(0);
  });
});

describe('migrateBookingCentricDealKeys', () => {
  let db;
  beforeEach(() => {
    db = createLegacyDb();
    migrateDealIdentity(db);
  });
  afterEach(() => { db.close(); });

  it('normalizes event-scoped booking keys to booking#N', () => {
    migrateBookingCentricDealKeys(db);
    const row = db.prepare("SELECT deal_key FROM deals WHERE crm_event_id = 'evt1'").get();
    expect(row.deal_key).toBe('booking#169120');
  });

  it('merges duplicate deals that share the same booking number', () => {
    db.exec('ALTER TABLE deals ADD COLUMN twenty_id TEXT');
    db.exec('ALTER TABLE deals ADD COLUMN approval_status TEXT DEFAULT "pending"');
    db.prepare(`
      INSERT INTO deals (crm_event_id, deal_key, data_source, title, tony_order_id, twenty_id, approval_status)
      VALUES ('evt3', 'evt3#169120', 'tony', 'Dup B', '169120', 'opp-b', 'synced')
    `).run();

    migrateBookingCentricDealKeys(db);

    const deals = db.prepare("SELECT * FROM deals WHERE tony_order_id = '169120'").all();
    expect(deals).toHaveLength(1);
    expect(deals[0].deal_key).toBe('booking#169120');
    expect(deals[0].twenty_id).toBe('opp-b');
    expect(db.prepare('SELECT COUNT(*) c FROM deal_items').get().c).toBe(1);
  });
});

describe('migrate', () => {
  let db;
  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrateDb = db;
  });
  afterEach(() => { db.close(); });

  it('adds comment, sum, quantity_num columns to deal_items', () => {
    migrate();
    const cols = db.prepare('PRAGMA table_info(deal_items)').all().map((c) => c.name);
    expect(cols).toContain('comment');
    expect(cols).toContain('sum');
    expect(cols).toContain('quantity_num');
  });

  it('migrates legacy DB without deal_key before indexes are created', () => {
    db.close();
    db = createLegacyDb();
    db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    migrateDb = db;
    expect(() => migrate()).not.toThrow();
    const dealCols = db.prepare('PRAGMA table_info(deals)').all().map((c) => c.name);
    expect(dealCols).toContain('deal_key');
    const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='deals'").all();
    expect(indexes.map((i) => i.name)).toContain('idx_deals_deal_key');
  });
});
