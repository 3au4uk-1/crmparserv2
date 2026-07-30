import Database from 'better-sqlite3';
import { describe, expect, it, beforeEach } from 'vitest';
import {
  upsertTelegramChat,
  upsertTelegramTopic,
  listTelegramChats,
  listTelegramTopics,
} from '../src/telegram/chat-store.js';

function openDb() {
  const db = new Database(':memory:');
  db.exec(`
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
    CREATE TABLE telegram_topics (
      chat_id TEXT NOT NULL,
      thread_id INTEGER NOT NULL,
      name TEXT,
      source TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      PRIMARY KEY (chat_id, thread_id)
    );
  `);
  return db;
}

describe('telegram chat-store', () => {
  let db;
  beforeEach(() => { db = openDb(); });

  it('upserts chat and lists active only', () => {
    upsertTelegramChat(db, {
      chatId: '-100', title: 'A', type: 'supergroup', isForum: true,
      username: null, active: true, source: 'webhook',
    });
    upsertTelegramChat(db, {
      chatId: '-200', title: 'B', type: 'group', isForum: false,
      username: null, active: false, source: 'manual',
    });
    expect(listTelegramChats(db, { activeOnly: true })).toHaveLength(1);
    expect(listTelegramChats(db, { activeOnly: false })).toHaveLength(2);
  });

  it('upserts topics per chat', () => {
    upsertTelegramChat(db, {
      chatId: '-100', title: 'A', type: 'supergroup', isForum: true,
      username: null, active: true, source: 'webhook',
    });
    upsertTelegramTopic(db, { chatId: '-100', threadId: 3, name: 'Ops', source: 'webhook' });
    upsertTelegramTopic(db, { chatId: '-100', threadId: 3, name: 'Ops2', source: 'webhook' });
    const topics = listTelegramTopics(db, '-100');
    expect(topics).toHaveLength(1);
    expect(topics[0].name).toBe('Ops2');
  });

  it('preserves existing topic name when upsert sends empty or null name', () => {
    upsertTelegramChat(db, {
      chatId: '-100', title: 'A', type: 'supergroup', isForum: true,
      username: null, active: true, source: 'webhook',
    });
    upsertTelegramTopic(db, { chatId: '-100', threadId: 3, name: 'Ops', source: 'webhook' });
    upsertTelegramTopic(db, { chatId: '-100', threadId: 3, name: '', source: 'webhook' });
    let topics = listTelegramTopics(db, '-100');
    expect(topics).toHaveLength(1);
    expect(topics[0].name).toBe('Ops');

    upsertTelegramTopic(db, { chatId: '-100', threadId: 3, name: null, source: 'webhook' });
    topics = listTelegramTopics(db, '-100');
    expect(topics[0].name).toBe('Ops');
  });
});
