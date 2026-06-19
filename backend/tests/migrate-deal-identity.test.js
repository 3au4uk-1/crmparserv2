import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrateDealIdentity } from '../src/db/migrate.js';

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
    expect(rows[0]).toMatchObject({ crm_event_id: 'evt1', deal_key: 'evt1#169120', data_source: 'tony' });
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
