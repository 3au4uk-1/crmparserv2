import Database from 'better-sqlite3';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { parseDigestCommand } from '../src/telegram/digest/commands.js';

const runDigestForDayMock = vi.fn();
const callTelegramMock = vi.fn();
const getTelegramBotTokenMock = vi.fn();

vi.mock('../src/telegram/digest/run.js', () => ({
  runDigestForDay: (...args) => runDigestForDayMock(...args),
}));

vi.mock('../src/telegram/api-client.js', () => ({
  callTelegram: (...args) => callTelegramMock(...args),
}));

vi.mock('../src/telegram/settings.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getTelegramBotToken: (...args) => getTelegramBotTokenMock(...args),
  };
});

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
    runDigestForDayMock.mockResolvedValue({ ok: true });
    vi.resetModules();
    ({ processTelegramUpdate } = await import('../src/telegram/inbound.js'));
  });

  it('invokes runDigestForDay for /завтра', async () => {
    processTelegramUpdate(testDb, {
      message: {
        chat: { id: -100, title: 'Ops', type: 'supergroup' },
        text: '/завтра',
      },
    });
    await vi.waitFor(() => {
      expect(runDigestForDayMock).toHaveBeenCalledWith({
        db: testDb,
        offsetDays: 1,
      });
    });
  });

  it('invokes runDigestForDay for /послезавтра without invoke thread override', async () => {
    processTelegramUpdate(testDb, {
      message: {
        chat: { id: -100, title: 'Forum', type: 'supergroup', is_forum: true },
        message_thread_id: 42,
        text: '/послезавтра@MyBot',
      },
    });
    await vi.waitFor(() => {
      expect(runDigestForDayMock).toHaveBeenCalledWith({
        db: testDb,
        offsetDays: 2,
      });
    });
  });

  it('sends error message on failure', async () => {
    runDigestForDayMock.mockRejectedValue(new Error('fetch failed'));
    getTelegramBotTokenMock.mockReturnValue('tok');
    callTelegramMock.mockResolvedValue({});

    processTelegramUpdate(testDb, {
      message: {
        chat: { id: -100, title: 'Ops', type: 'supergroup' },
        text: '/завтра',
      },
    });

    await vi.waitFor(() => {
      expect(callTelegramMock).toHaveBeenCalledWith('tok', 'sendMessage', {
        chat_id: '-100',
        text: 'не удалось загрузить',
      });
    });
  });

  it('sends error message when runDigestForDay returns ok:false (no token)', async () => {
    runDigestForDayMock.mockResolvedValue({ ok: false, skipped: true, error: 'no bot token' });
    getTelegramBotTokenMock.mockReturnValue('tok');
    callTelegramMock.mockResolvedValue({});

    processTelegramUpdate(testDb, {
      message: {
        chat: { id: -100, title: 'Ops', type: 'supergroup' },
        text: '/завтра',
      },
    });

    await vi.waitFor(() => {
      expect(callTelegramMock).toHaveBeenCalledWith('tok', 'sendMessage', {
        chat_id: '-100',
        text: 'не удалось загрузить',
      });
    });
  });

  it('does not send error when runDigestForDay succeeds with ok:true', async () => {
    runDigestForDayMock.mockResolvedValue({ ok: true, skipped: true });

    processTelegramUpdate(testDb, {
      message: {
        chat: { id: -100, title: 'Ops', type: 'supergroup' },
        text: '/завтра',
      },
    });

    await vi.waitFor(() => {
      expect(runDigestForDayMock).toHaveBeenCalled();
    });
    expect(callTelegramMock).not.toHaveBeenCalled();
  });

  it('does not invoke run for unrelated messages', () => {
    processTelegramUpdate(testDb, {
      message: {
        chat: { id: -100, title: 'Ops', type: 'supergroup' },
        text: 'hello',
      },
    });
    expect(runDigestForDayMock).not.toHaveBeenCalled();
  });
});
