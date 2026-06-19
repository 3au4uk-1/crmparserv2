import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from './connection.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function ensureColumn(db, table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function hasUniqueIndexOnCrmEventId(db) {
  const indexes = db.prepare(`PRAGMA index_list(deals)`).all();
  for (const idx of indexes) {
    if (idx.origin === 'u') {
      const cols = db.prepare(`PRAGMA index_info(${idx.name})`).all();
      if (cols.length === 1 && cols[0].name === 'crm_event_id') return true;
    }
  }
  return false;
}

export function migrateDealIdentity(db) {
  ensureColumn(db, 'deals', 'deal_key', 'TEXT');
  ensureColumn(db, 'deals', 'data_source', "TEXT NOT NULL DEFAULT 'calendar'");
  ensureColumn(db, 'deals', 'load_date', 'TEXT');
  ensureColumn(db, 'deals', 'load_time', 'TEXT');

  db.prepare(`
    UPDATE deals
    SET deal_key = crm_event_id || '#' || COALESCE(NULLIF(tony_order_id, ''), 'cal'),
        data_source = CASE WHEN COALESCE(NULLIF(tony_order_id, ''), '') = '' THEN 'calendar' ELSE 'tony' END
    WHERE deal_key IS NULL
  `).run();

  if (hasUniqueIndexOnCrmEventId(db)) {
    const cols = db.prepare(`PRAGMA table_info(deals)`).all().map((c) => c.name);
    const colList = cols.join(', ');
    db.exec('PRAGMA foreign_keys=OFF;');
    db.exec('PRAGMA legacy_alter_table=ON;');
    const tx = db.transaction(() => {
      db.exec(`ALTER TABLE deals RENAME TO deals_old;`);
      const createSql = db
        .prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='deals_old'`)
        .get().sql
        .replace(/deals_old/, 'deals')
        .replace(/crm_event_id\s+TEXT\s+NOT\s+NULL\s+UNIQUE/i, 'crm_event_id TEXT NOT NULL');
      db.exec(createSql);
      db.exec(`INSERT INTO deals (${colList}) SELECT ${colList} FROM deals_old;`);
      db.exec(`DROP TABLE deals_old;`);
      const fkViolations = db.prepare('PRAGMA foreign_key_check').all();
      if (fkViolations.length > 0) {
        throw new Error('migrateDealIdentity: foreign key violations after rebuild: ' + JSON.stringify(fkViolations));
      }
    });
    tx();
    db.exec('PRAGMA legacy_alter_table=OFF;');
    db.exec('PRAGMA foreign_keys=ON;');
  }

  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_deals_deal_key ON deals(deal_key);`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_deals_crm_event_id ON deals(crm_event_id);`);
}

export function migrate() {
  const db = getDb();
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
  db.exec(schema);

  db.exec(`
    CREATE TABLE IF NOT EXISTS blacklist_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern TEXT NOT NULL,
      match_type TEXT NOT NULL CHECK (match_type IN ('exact', 'substring')),
      source_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (pattern, match_type)
    );
  `);

  ensureColumn(db, 'deal_items', 'sync_override', 'TEXT');
  ensureColumn(db, 'deal_items', 'twenty_id', 'TEXT');
  ensureColumn(db, 'deals', 'twenty_error', 'TEXT');
  ensureColumn(db, 'deals', 'tony_order_id', 'TEXT');
  ensureColumn(db, 'deals', 'arrival_time', 'TEXT');
  ensureColumn(db, 'deals', 'ready_time', 'TEXT');
  ensureColumn(db, 'deals', 'work_time', 'TEXT');
  ensureColumn(db, 'deals', 'dismantle_time', 'TEXT');
  ensureColumn(db, 'sync_runs', 'action', 'TEXT');
  ensureColumn(db, 'deals', 'twenty_stage', 'TEXT');

  db.prepare(
    "INSERT OR IGNORE INTO settings (key, value) VALUES ('opportunity_stage', 'NOVYY')"
  ).run();
  db.prepare(
    "UPDATE settings SET value = 'NOVYY' WHERE key = 'opportunity_stage' AND value IN ('NEW', 'Новый')"
  ).run();

  migrateDealIdentity(db);

  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('tony_base_url', 'https://crm.apihide.com')").run();
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('tony_login', '')").run();
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('tony_password', '')").run();

  console.log('Database migrated successfully');
}
