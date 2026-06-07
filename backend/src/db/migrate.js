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

export function migrate() {
  const db = getDb();
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
  db.exec(schema);

  ensureColumn(db, 'deal_items', 'sync_override', 'TEXT');
  ensureColumn(db, 'deal_items', 'twenty_id', 'TEXT');
  ensureColumn(db, 'deals', 'twenty_error', 'TEXT');
  ensureColumn(db, 'deals', 'tony_order_id', 'TEXT');
  ensureColumn(db, 'deals', 'arrival_time', 'TEXT');
  ensureColumn(db, 'deals', 'ready_time', 'TEXT');
  ensureColumn(db, 'deals', 'work_time', 'TEXT');
  ensureColumn(db, 'deals', 'dismantle_time', 'TEXT');

  console.log('Database migrated successfully');
}
