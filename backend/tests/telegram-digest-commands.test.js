import Database from 'better-sqlite3';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { parseDigestCommand } from '../src/telegram/digest/commands.js';

const runDigestForDayMock = vi.fn();

vi.mock('../src/telegram/digest/run.js', () => ({
  runDigestForDay: (...args) => runDigestForDayMock(...args),
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

describe('parseDigestCommand', () => {
  it('parses tomorrow', () => {
    expect(parseDigestCommand('/завтра')).toBe(1);
    expect(parseDigestCommand('/завтра@MyBot')).toBe(1);
  });

  it('parses day after', () => {
    expect(parseDigestCommand('/послезавтра')).toBe(2);
    expect(parseDigestCommand('/послезавтра@MyBot')).toBe(2);
  });

  it('ignores other', () => {
    expect(parseDigestCommand('hello')).toBeNull();
    expect(parseDigestCommand('/start')).toBeNull();
  });
});

describe('processTelegramUpdate digest commands', () => {
  let processTelegramUpdate;
  let testDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    testDb = openDb();
    vi.resetModules();
    ({ processTelegramUpdate } = await import('../src/telegram/inbound.js'));
  });

  it('does not invoke runDigestForDay for /завтра', () => {
    processTelegramUpdate(testDb, {
      message: {
        chat: { id: -100, title: 'Ops', type: 'supergroup' },
        text: '/завтра',
      },
    });
    expect(runDigestForDayMock).not.toHaveBeenCalled();
  });

  it('does not invoke runDigestForDay for /послезавтра in topic', () => {
    processTelegramUpdate(testDb, {
      message: {
        chat: { id: -100, title: 'Forum', type: 'supergroup', is_forum: true },
        message_thread_id: 42,
        text: '/послезавтра@MyBot',
      },
    });
    expect(runDigestForDayMock).not.toHaveBeenCalled();
  });

  it('does not invoke runDigestForDay for unrelated messages', () => {
    processTelegramUpdate(testDb, {
      message: {
        chat: { id: -100, title: 'Ops', type: 'supergroup' },
        text: 'hello',
      },
    });
    expect(runDigestForDayMock).not.toHaveBeenCalled();
  });
});
