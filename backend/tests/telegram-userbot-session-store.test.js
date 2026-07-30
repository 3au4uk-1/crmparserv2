// backend/tests/telegram-userbot-session-store.test.js
import { describe, expect, it, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  getDbUserSession,
  setDbUserSession,
  clearDbUserSession,
  resolveSession,
} from '../src/telegram/userbot/session-store.js';
import {
  isApiConfigured,
  isUserbotConfigured,
  resetUserbotClient,
} from '../src/telegram/userbot/client.js';

function memDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  return db;
}

describe('session-store', () => {
  let db;
  beforeEach(() => { db = memDb(); });

  it('prefers DB session over env', () => {
    setDbUserSession(db, 'db-sess');
    expect(resolveSession(db, 'env-sess')).toBe('db-sess');
  });

  it('falls back to env when DB empty', () => {
    expect(resolveSession(db, 'env-sess')).toBe('env-sess');
    clearDbUserSession(db);
    expect(getDbUserSession(db)).toBe('');
  });
});

describe('isUserbotConfigured', () => {
  it('needs api + session', () => {
    const db = memDb();
    const cfg = { telegramApiId: '1', telegramApiHash: 'h', telegramUserSession: '' };
    expect(isApiConfigured(cfg)).toBe(true);
    expect(isUserbotConfigured(db, cfg)).toBe(false);
    setDbUserSession(db, 's');
    expect(isUserbotConfigured(db, cfg)).toBe(true);
  });
});
