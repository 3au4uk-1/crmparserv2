import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb } from './connection.js';
import { bookingDealKey, resolveBookingNumber } from '../services/deal-keys.js';
import {
  migratePodryadBannerToTipRules,
  seedDefaultTipRules,
} from '../services/tip-rules.js';

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
        data_source = 'calendar'
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
  db.exec(`CREATE INDEX IF NOT EXISTS idx_deal_items_twenty_id ON deal_items(twenty_id);`);
}

function pickDealToKeep(deals) {
  const score = (d) => {
    let s = 0;
    if (d.twenty_id) s += 100;
    if (d.approval_status === 'approved' || d.approval_status === 'synced') s += 10;
    return s;
  };
  return deals.sort((a, b) => score(b) - score(a) || a.id - b.id)[0];
}

/** Merge duplicate deals per booking and normalize deal_key to booking#N. */
export function migrateBookingCentricDealKeys(db) {
  const deals = db.prepare('SELECT * FROM deals').all();
  const byBooking = new Map();

  for (const deal of deals) {
    const booking = resolveBookingNumber(deal);
    if (!booking) continue;
    if (!byBooking.has(booking)) byBooking.set(booking, []);
    byBooking.get(booking).push(deal);
  }

  const tx = db.transaction(() => {
    for (const [booking, group] of byBooking) {
      const targetKey = bookingDealKey(booking);
      const winner = pickDealToKeep(group);

      for (const loser of group.filter((d) => d.id !== winner.id)) {
        if (!winner.twenty_id && loser.twenty_id) {
          db.prepare(`
            UPDATE deals SET twenty_id = ?, approval_status = COALESCE(approval_status, ?)
            WHERE id = ?
          `).run(loser.twenty_id, loser.approval_status, winner.id);
          winner.twenty_id = loser.twenty_id;
        }
        db.prepare('UPDATE deal_items SET deal_id = ? WHERE deal_id = ?').run(winner.id, loser.id);
        db.prepare('DELETE FROM deals WHERE id = ?').run(loser.id);
      }

      db.prepare(`
        UPDATE deals SET deal_key = ?, tony_order_id = COALESCE(tony_order_id, ?)
        WHERE id = ?
      `).run(targetKey, booking, winner.id);
    }
  });
  tx();
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

  db.exec(`
    CREATE TABLE IF NOT EXISTS restoration_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern TEXT NOT NULL,
      match_type TEXT NOT NULL CHECK (match_type IN ('exact', 'substring')),
      source_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (pattern, match_type)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS podryad_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern TEXT NOT NULL,
      match_type TEXT NOT NULL CHECK (match_type IN ('exact', 'substring')),
      source_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (pattern, match_type)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS banner_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern TEXT NOT NULL,
      match_type TEXT NOT NULL CHECK (match_type IN ('exact', 'substring')),
      source_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (pattern, match_type)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS tip_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern TEXT NOT NULL,
      match_type TEXT NOT NULL CHECK (match_type IN ('exact', 'substring')),
      tip TEXT NOT NULL,
      tip_detail TEXT,
      priority INTEGER NOT NULL DEFAULT 100,
      source_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS tip_rules_unique_pattern_tip_detail
    ON tip_rules (
      pattern,
      match_type,
      tip,
      IFNULL(tip_detail, '')
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS decor_blacklist_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern TEXT NOT NULL,
      match_type TEXT NOT NULL CHECK (match_type IN ('exact', 'substring')),
      source_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (pattern, match_type)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS mk_blacklist_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern TEXT NOT NULL,
      match_type TEXT NOT NULL CHECK (match_type IN ('exact', 'substring')),
      source_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (pattern, match_type)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS ne_nashe_branding_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern TEXT NOT NULL,
      match_type TEXT NOT NULL CHECK (match_type IN ('exact', 'substring')),
      source_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (pattern, match_type)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS ne_nashe_decor_mk_items (
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
  ensureColumn(db, 'deal_items', 'comment', 'TEXT');
  db.exec(`CREATE INDEX IF NOT EXISTS idx_deal_items_twenty_id ON deal_items(twenty_id);`);
  ensureColumn(db, 'deal_items', 'sum', 'REAL');
  ensureColumn(db, 'deal_items', 'quantity_num', 'REAL');
  ensureColumn(db, 'deal_items', 'amount_locked', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'deals', 'twenty_error', 'TEXT');
  ensureColumn(db, 'deals', 'tony_order_id', 'TEXT');
  ensureColumn(db, 'deals', 'arrival_time', 'TEXT');
  ensureColumn(db, 'deals', 'ready_time', 'TEXT');
  ensureColumn(db, 'deals', 'work_time', 'TEXT');
  ensureColumn(db, 'deals', 'dismantle_time', 'TEXT');
  ensureColumn(db, 'sync_runs', 'action', 'TEXT');
  ensureColumn(db, 'deals', 'twenty_stage', 'TEXT');
  ensureColumn(db, 'deals', 'calendar_miss_streak', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'deals', 'pre_cancel_opportunity_stage', 'TEXT');
  ensureColumn(db, 'deals', 'line_item_stage_snapshot_json', 'TEXT');
  ensureColumn(db, 'deals', 'payment_amount', 'REAL');
  ensureColumn(db, 'deals', 'payment_status', 'TEXT');
  ensureColumn(db, 'deals', 'payment_count', 'INTEGER');
  ensureColumn(db, 'deals', 'payment_hash', 'TEXT');

  db.prepare(
    "INSERT OR IGNORE INTO settings (key, value) VALUES ('opportunity_stage', 'NOVYY')"
  ).run();
  db.prepare(
    "UPDATE settings SET value = 'NOVYY' WHERE key = 'opportunity_stage' AND value IN ('NEW', 'Новый')"
  ).run();

  migrateDealIdentity(db);
  migrateBookingCentricDealKeys(db);

  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('tony_base_url', 'https://crm.apihide.com')").run();
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('tony_login', '')").run();
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('tony_password', '')").run();

  db.exec(`
    CREATE TABLE IF NOT EXISTS expense_sync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL DEFAULT 'queued',
      trigger TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      deals_targeted INTEGER DEFAULT 0,
      deals_updated INTEGER DEFAULT 0,
      deals_with_expenses INTEGER DEFAULT 0,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS expense_beznal_uploads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      storage_path TEXT NOT NULL,
      original_filename TEXT,
      uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS bulk_resync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL DEFAULT 'queued',
      trigger TEXT NOT NULL DEFAULT 'manual',
      started_at TEXT,
      finished_at TEXT,
      deals_total INTEGER DEFAULT 0,
      deals_done INTEGER DEFAULT 0,
      deals_updated INTEGER DEFAULT 0,
      deals_failed INTEGER DEFAULT 0,
      errors_json TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS restore_missing_twenty_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL DEFAULT 'queued',
      trigger TEXT NOT NULL DEFAULT 'manual',
      started_at TEXT,
      finished_at TEXT,
      deals_total INTEGER DEFAULT 0,
      deals_done INTEGER DEFAULT 0,
      deals_restored INTEGER DEFAULT 0,
      deals_skipped INTEGER DEFAULT 0,
      deals_failed INTEGER DEFAULT 0,
      errors_json TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  migratePodryadBannerToTipRules(db);
  seedDefaultTipRules(db);

  const expenseDefaults = [
    ['expense_sheet_field_team', '1cqOIF0MBJggXdUzJ_ll4GaW9jVcDmFPKyrsbWr3ofwk'],
    ['expense_sheet_printing', '1OYLaUJukGnjvx5qmdHAaKWuVaCTscDsdffzCTqy64pA'],
    ['expense_sheet_milling', '1fKlBKDQlOQgvqyEz-qVDWIE5oBKin40RSuRkWvrw-xA'],
    ['expense_sheet_logistics', '1MtGMGzsSS-0ci1HVwdjXcapQQrkaC6qOdI8MdH2mTFM'],
    ['expense_sheet_beznal', ''],
    ['expense_sync_schedule', '0 6 * * *'],
  ];
  for (const [key, value] of expenseDefaults) {
    db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(key, value);
  }

  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('decor_keywords', '[]')").run();
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('mk_keywords', '[]')").run();

  // Production freza queue spreadsheet — empty until cycle is wired; fill in Settings UI.
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('freza_sheet_id', '')").run();

  db.exec(`
    CREATE TABLE IF NOT EXISTS telegram_send_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event TEXT NOT NULL,
      line_item_id TEXT NOT NULL,
      opportunity_id TEXT,
      chat_id TEXT,
      sent_by TEXT,
      payload_hash TEXT,
      telegram_message_ids TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_telegram_send_log_event_line
     ON telegram_send_log(event, line_item_id);`,
  );

  db.exec(`
    CREATE TABLE IF NOT EXISTS telegram_chats (
      chat_id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT '',
      is_forum INTEGER NOT NULL DEFAULT 0,
      username TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      source TEXT NOT NULL,
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS telegram_topics (
      chat_id TEXT NOT NULL,
      thread_id INTEGER NOT NULL,
      name TEXT,
      source TEXT NOT NULL,
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (chat_id, thread_id)
    );
    CREATE TABLE IF NOT EXISTS telegram_auto_invite_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT,
      user_id TEXT,
      display_name TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS telegram_auto_invite_runs (
      chat_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT,
      detail_json TEXT
    );
  `);

  const telegramDefaults = [
    ['telegram_bot_token', ''],
    ['telegram_chat_map', '{"okleyka.send":""}'],
    ['telegram_webhook_secret', ''],
  ];
  const upsertSetting = db.prepare(
    `INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)`,
  );
  for (const [key, value] of telegramDefaults) upsertSetting.run(key, value);

  console.log('Database migrated successfully');
}
