import Database from 'better-sqlite3';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  listTelegramChats,
  listTelegramTopics,
} from '../src/telegram/chat-store.js';
import { clearHooksForTests, registerHook } from '../src/telegram/hooks.js';

let testDb;

vi.mock('../src/db/connection.js', () => ({
  getDb: () => testDb,
}));

function openDb() {
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

function mockRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

describe('processTelegramUpdate', () => {
  let processTelegramUpdate;

  beforeEach(async () => {
    testDb = openDb();
    clearHooksForTests();
    ({ processTelegramUpdate } = await import('../src/telegram/inbound.js'));
  });

  it('my_chat_member member → active chat', async () => {
    await processTelegramUpdate(testDb, {
      my_chat_member: {
        chat: { id: -100, title: 'Ops', type: 'supergroup', is_forum: true },
        new_chat_member: { status: 'member' },
      },
    });
    const chats = listTelegramChats(testDb, { activeOnly: false });
    expect(chats).toHaveLength(1);
    expect(chats[0].chat_id).toBe('-100');
    expect(chats[0].title).toBe('Ops');
    expect(chats[0].active).toBe(1);
    expect(chats[0].source).toBe('webhook');
  });

  it('my_chat_member left → active=0', async () => {
    await processTelegramUpdate(testDb, {
      my_chat_member: {
        chat: { id: -100, title: 'Ops', type: 'supergroup' },
        new_chat_member: { status: 'left' },
      },
    });
    const chats = listTelegramChats(testDb, { activeOnly: false });
    expect(chats).toHaveLength(1);
    expect(chats[0].active).toBe(0);
  });

  it('message with forum_topic_created → topic with name', async () => {
    await processTelegramUpdate(testDb, {
      message: {
        chat: { id: -100, title: 'Forum', type: 'supergroup', is_forum: true },
        message_thread_id: 42,
        forum_topic_created: { name: 'General' },
      },
    });
    const topics = listTelegramTopics(testDb, '-100');
    expect(topics).toHaveLength(1);
    expect(topics[0].thread_id).toBe(42);
    expect(topics[0].name).toBe('General');
    expect(topics[0].source).toBe('webhook');
  });

  it('message with is_topic_message + message_thread_id → topic (name may be null)', async () => {
    await processTelegramUpdate(testDb, {
      message: {
        chat: { id: -100, title: 'Forum', type: 'supergroup', is_forum: true },
        message_thread_id: 7,
        is_topic_message: true,
        text: 'hello',
      },
    });
    const topics = listTelegramTopics(testDb, '-100');
    expect(topics).toHaveLength(1);
    expect(topics[0].thread_id).toBe(7);
    expect(topics[0].name).toBeNull();
  });

  it('emits telegram.inbound after discovery upserts', async () => {
    const hook = vi.fn(() => {
      expect(listTelegramChats(testDb, { activeOnly: false })).toHaveLength(1);
    });
    registerHook('telegram.inbound', hook);
    const update = {
      message: { chat: { id: -100, title: 'Ops', type: 'supergroup' }, text: 'hello' },
    };

    await processTelegramUpdate(testDb, update);

    expect(hook).toHaveBeenCalledWith({ db: testDb, update });
  });
});

describe('handleTelegramWebhook', () => {
  let handleTelegramWebhook;

  beforeEach(async () => {
    testDb = openDb();
    clearHooksForTests();
    vi.resetModules();
    ({ handleTelegramWebhook } = await import('../src/telegram/inbound.js'));
  });

  it('rejects wrong secret when configured', async () => {
    testDb.prepare(`INSERT INTO settings (key, value) VALUES ('telegram_webhook_secret', 's3cr3t')`).run();
    const req = {
      body: {},
      get: (h) => (h === 'X-Telegram-Bot-Api-Secret-Token' ? 'wrong' : undefined),
    };
    const res = mockRes();
    await handleTelegramWebhook(req, res);
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ ok: false, error: 'invalid secret' });
  });

  it('accepts valid secret and returns ok', async () => {
    testDb.prepare(`INSERT INTO settings (key, value) VALUES ('telegram_webhook_secret', 's3cr3t')`).run();
    const req = {
      body: {
        my_chat_member: {
          chat: { id: -100, title: 'Ops', type: 'supergroup' },
          new_chat_member: { status: 'member' },
        },
      },
      get: (h) => (h === 'X-Telegram-Bot-Api-Secret-Token' ? 's3cr3t' : undefined),
    };
    const res = mockRes();
    await handleTelegramWebhook(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(listTelegramChats(testDb, { activeOnly: false })).toHaveLength(1);
  });
});
