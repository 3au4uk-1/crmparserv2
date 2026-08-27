import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = path.join(__dirname, '../data/test-expense-migrate.db');

describe('expense tables migration', () => {
  beforeEach(() => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    process.env.DB_PATH = TEST_DB;
  });
  afterEach(async () => {
    try {
      const { getDb } = await import('../src/db/connection.js');
      getDb().close();
    } catch { /* db not initialized */ }
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    delete process.env.DB_PATH;
  });

  it('creates expense_sync_runs and expense_beznal_uploads', async () => {
    const { initDb, getDb } = await import('../src/db/connection.js');
    const { migrate } = await import('../src/db/migrate.js');
    initDb();
    migrate();
    const db = getDb();
    const runs = db.prepare("SELECT name FROM sqlite_master WHERE name='expense_sync_runs'").get();
    const uploads = db.prepare("SELECT name FROM sqlite_master WHERE name='expense_beznal_uploads'").get();
    expect(runs).toBeTruthy();
    expect(uploads).toBeTruthy();
  });

  it('moves default expense_sync_schedule off 06:00', async () => {
    const { initDb, getDb } = await import('../src/db/connection.js');
    const { migrate } = await import('../src/db/migrate.js');
    initDb();
    const db = getDb();
    db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    db.prepare("INSERT INTO settings (key, value) VALUES ('expense_sync_schedule', '0 6 * * *')").run();
    migrate();
    const row = db.prepare("SELECT value FROM settings WHERE key = 'expense_sync_schedule'").get();
    expect(row.value).toBe('30 7 * * *');
  });
});
