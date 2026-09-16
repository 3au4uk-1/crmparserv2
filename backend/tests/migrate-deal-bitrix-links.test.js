import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';

let migrateDb;

vi.mock('../src/db/connection.js', () => ({
  getDb: () => migrateDb,
  initDb: () => migrateDb,
}));

import { migrate } from '../src/db/migrate.js';

describe('migrate deal_bitrix_links', () => {
  let db;
  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    migrateDb = db;
    db.exec(`
      CREATE TABLE deals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        crm_event_id TEXT NOT NULL,
        title TEXT NOT NULL,
        crm_lead_id TEXT
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
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO deals (crm_event_id, title, crm_lead_id)
      VALUES ('evt1', 'Test deal', '2050903');
    `);
  });
  afterEach(() => { db.close(); });

  it('backfills deal_bitrix_links from deals.crm_lead_id', () => {
    migrate();
    const rows = db.prepare(
      'SELECT bitrix_id, is_canonical FROM deal_bitrix_links',
    ).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ bitrix_id: '2050903', is_canonical: 1 });
  });
});
