import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
  getTeamAppMirrorSettings,
  setTeamAppMirrorSettings,
} from '../src/telegram/team-app-mirror-settings.js';

function memDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE telegram_chats (
      chat_id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT '',
      is_forum INTEGER NOT NULL DEFAULT 0,
      username TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      source TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );
  `);
  return db;
}

describe('team app mirror settings', () => {
  it('returns empty settings by default', () => {
    const db = memDb();
    expect(getTeamAppMirrorSettings(db)).toEqual({ chatId: '', topicId: null });
  });

  it('round-trips chatId + topicId', () => {
    const db = memDb();
    setTeamAppMirrorSettings(db, { chatId: '-1003582108958', topicId: 42 });
    expect(getTeamAppMirrorSettings(db)).toEqual({ chatId: '-1003582108958', topicId: 42 });
  });

  it('stores under team_app_chat_mirror', () => {
    const db = memDb();
    setTeamAppMirrorSettings(db, { chatId: '-1001', topicId: 7 });
    const row = db.prepare(`SELECT value FROM settings WHERE key = 'team_app_chat_mirror'`).get();
    expect(JSON.parse(row.value)).toEqual({ chatId: '-1001', topicId: 7 });
  });

  it('rejects invalid topicId', () => {
    const db = memDb();
    expect(() => setTeamAppMirrorSettings(db, { chatId: '-1', topicId: 'abc' })).toThrow(
      /positive integer/,
    );
  });

  it('clears settings when chatId is empty', () => {
    const db = memDb();
    setTeamAppMirrorSettings(db, { chatId: '-1', topicId: 5 });
    setTeamAppMirrorSettings(db, { chatId: '', topicId: null });
    expect(getTeamAppMirrorSettings(db)).toEqual({ chatId: '', topicId: null });
  });
});
