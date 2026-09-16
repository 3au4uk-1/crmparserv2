import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { loadTargetDeals } from '../src/services/expense-sync.js';

function createDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE deals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      twenty_id TEXT,
      crm_lead_id TEXT
    );
    CREATE TABLE deal_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      twenty_parent_id TEXT,
      name TEXT NOT NULL,
      name_locked INTEGER NOT NULL DEFAULT 0,
      canonical_deal_id INTEGER NOT NULL REFERENCES deals(id),
      canonical_bitrix_id TEXT NOT NULL,
      canonical_locked INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE deal_group_members (
      group_id INTEGER NOT NULL REFERENCES deal_groups(id) ON DELETE CASCADE,
      deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      UNIQUE (deal_id)
    );
  `);
  return db;
}

describe('loadTargetDeals with deal groups', () => {
  let db;
  beforeEach(() => { db = createDb(); });
  afterEach(() => db.close());

  it('returns one row with canonical twenty_id for grouped members', () => {
    db.prepare('INSERT INTO deals (twenty_id, crm_lead_id) VALUES (?, ?)').run('tw-canon', '2049067');
    db.prepare('INSERT INTO deals (twenty_id, crm_lead_id) VALUES (?, ?)').run('tw-child', '2050903');
    db.prepare(`
      INSERT INTO deal_groups (name, canonical_deal_id, canonical_bitrix_id)
      VALUES ('А7', 1, '2049067')
    `).run();
    db.prepare('INSERT INTO deal_group_members (group_id, deal_id) VALUES (1, 1)').run();
    db.prepare('INSERT INTO deal_group_members (group_id, deal_id) VALUES (1, 2)').run();

    const rows = loadTargetDeals(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      twenty_id: 'tw-canon',
      crm_lead_id: '2049067',
    });
  });

  it('still returns ungrouped synced deals', () => {
    db.prepare('INSERT INTO deals (twenty_id, crm_lead_id) VALUES (?, ?)').run('tw-solo', '111');
    db.prepare('INSERT INTO deals (twenty_id, crm_lead_id) VALUES (?, ?)').run('tw-canon', '2049067');
    db.prepare('INSERT INTO deals (twenty_id, crm_lead_id) VALUES (?, ?)').run('tw-child', '2050903');
    db.prepare(`
      INSERT INTO deal_groups (name, canonical_deal_id, canonical_bitrix_id)
      VALUES ('А7', 2, '2049067')
    `).run();
    db.prepare('INSERT INTO deal_group_members (group_id, deal_id) VALUES (1, 2)').run();
    db.prepare('INSERT INTO deal_group_members (group_id, deal_id) VALUES (1, 3)').run();

    const rows = loadTargetDeals(db);
    expect(rows).toHaveLength(2);
    const ids = rows.map((r) => r.twenty_id).sort();
    expect(ids).toEqual(['tw-canon', 'tw-solo']);
  });
});
