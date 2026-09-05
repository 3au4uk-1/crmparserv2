import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
  getWorkRequestSlots,
  setWorkRequestSlots,
  findSlot,
} from '../src/telegram/work-requests/slots.js';
import {
  insertWorkRequestLink,
} from '../src/telegram/work-requests/store.js';

function openMigrated() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE telegram_work_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_number INTEGER NOT NULL UNIQUE,
      twenty_id TEXT UNIQUE,
      chat_id TEXT NOT NULL,
      thread_id INTEGER NOT NULL,
      source_message_id INTEGER NOT NULL,
      bot_message_id INTEGER,
      media_group_id TEXT,
      requester_user_id TEXT,
      requester_username TEXT,
      requester_name TEXT,
      last_published_text TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (chat_id, source_message_id)
    );
    INSERT INTO settings (key, value) VALUES ('telegram_work_request_slots', '[]');
  `);
  return db;
}

describe('work request slots', () => {
  it('starts empty and finds a saved slot', () => {
    const db = openMigrated();
    expect(getWorkRequestSlots(db)).toEqual([]);
    const slots = setWorkRequestSlots(db, [
      { chatId: '-1001', threadId: 12, companyLabel: 'Маяк', topicRole: 'QUOTE' },
    ]);
    expect(findSlot(db, '-1001', 12)?.topicRole).toBe('QUOTE');
    expect(slots).toHaveLength(1);
  });

  it('rejects bad topicRole', () => {
    const db = openMigrated();
    expect(() =>
      setWorkRequestSlots(db, [{ chatId: '-1', threadId: 1, companyLabel: 'X', topicRole: 'NOPE' }]),
    ).toThrow(/topicRole/);
  });
});

describe('work request store', () => {
  it('allocates incrementing numbers and is idempotent on the same message', () => {
    const db = openMigrated();
    const first = insertWorkRequestLink(db, {
      chatId: '-1001',
      threadId: 12,
      sourceMessageId: 77,
      requesterUserId: '5',
    });
    const again = insertWorkRequestLink(db, {
      chatId: '-1001',
      threadId: 12,
      sourceMessageId: 77,
      requesterUserId: '5',
    });
    expect(first.requestNumber).toBe(1);
    expect(first.created).toBe(true);
    expect(again.id).toBe(first.id);
    expect(again.requestNumber).toBe(1);
    expect(again.created).toBe(false);
    const second = insertWorkRequestLink(db, {
      chatId: '-1001',
      threadId: 12,
      sourceMessageId: 78,
    });
    expect(second.requestNumber).toBe(2);
  });
});
