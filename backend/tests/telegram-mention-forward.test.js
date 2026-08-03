import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { Api } from 'telegram';
import {
  normalizePeerChatId,
  shouldForwardMention,
  buildMentionContext,
  forwardMentionMessage,
  initMentionForwarding,
} from '../src/telegram/userbot/mention-forward.js';
import {
  getMentionForwardSettings,
  setMentionForwardSettings,
} from '../src/telegram/settings.js';

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

describe('mention forward settings', () => {
  it('returns empty settings by default', () => {
    const db = memDb();
    expect(getMentionForwardSettings(db)).toEqual({ chatId: '', topicId: null });
  });

  it('round-trips chatId + topicId', () => {
    const db = memDb();
    setMentionForwardSettings(db, { chatId: '-1003582108958', topicId: 42 });
    expect(getMentionForwardSettings(db)).toEqual({ chatId: '-1003582108958', topicId: 42 });
  });

  it('rejects invalid topicId', () => {
    const db = memDb();
    expect(() => setMentionForwardSettings(db, { chatId: '-1', topicId: 'abc' })).toThrow(
      /positive integer/,
    );
  });

  it('clears settings when chatId is empty', () => {
    const db = memDb();
    setMentionForwardSettings(db, { chatId: '-1', topicId: 5 });
    setMentionForwardSettings(db, { chatId: '', topicId: null });
    expect(getMentionForwardSettings(db)).toEqual({ chatId: '', topicId: null });
  });
});

describe('normalizePeerChatId', () => {
  it('maps PeerChannel to -100…', () => {
    expect(normalizePeerChatId({ channelId: 3582108958n })).toBe('-1003582108958');
  });

  it('maps PeerChat to -…', () => {
    expect(normalizePeerChatId({ chatId: 5490992591n })).toBe('-5490992591');
  });

  it('returns null for PeerUser and missing peer', () => {
    expect(normalizePeerChatId({ userId: 123n })).toBe(null);
    expect(normalizePeerChatId(undefined)).toBe(null);
  });
});

describe('shouldForwardMention', () => {
  const settings = { chatId: '-1003582108958', topicId: 42 };

  it('accepts a mention from another group', () => {
    expect(
      shouldForwardMention({
        message: { mentioned: true },
        sourceChatId: '-5490992591',
        settings,
      }),
    ).toEqual({ ok: true });
  });

  it('rejects when not configured', () => {
    const result = shouldForwardMention({
      message: { mentioned: true },
      sourceChatId: '-5490992591',
      settings: { chatId: '', topicId: null },
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not configured/);
  });

  it('rejects non-mentions', () => {
    const result = shouldForwardMention({
      message: { mentioned: false },
      sourceChatId: '-5490992591',
      settings,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects DMs (no group chat id)', () => {
    const result = shouldForwardMention({
      message: { mentioned: true },
      sourceChatId: null,
      settings,
    });
    expect(result.ok).toBe(false);
  });

  it('rejects mentions inside the target chat', () => {
    const result = shouldForwardMention({
      message: { mentioned: true },
      sourceChatId: settings.chatId,
      settings,
    });
    expect(result.ok).toBe(false);
  });
});

describe('buildMentionContext', () => {
  it('includes chat title, name, and username', () => {
    expect(
      buildMentionContext({ chatTitle: 'Заказ 1', senderName: 'Иван', senderUsername: 'ivan' }),
    ).toBe('🔔 Упоминание в «Заказ 1» от Иван @ivan');
  });

  it('degrades gracefully without title or sender', () => {
    expect(buildMentionContext({})).toBe('🔔 Упоминание в чате');
  });
});

describe('forwardMentionMessage', () => {
  function setup() {
    const db = memDb();
    setMentionForwardSettings(db, { chatId: '-1003582108958', topicId: 42 });
    db.prepare(
      `INSERT INTO telegram_chats (chat_id, title, type, source, last_seen_at)
       VALUES ('-5490992591', 'TEST - БРЕНД', 'group', 'userbot', datetime('now'))`,
    ).run();
    const client = {
      sendMessage: vi.fn(async () => ({})),
      invoke: vi.fn(async () => ({})),
    };
    return { db, client };
  }

  it('sends context line and forwards into the topic', async () => {
    const { db, client } = setup();
    const message = {
      id: 777,
      mentioned: true,
      peerId: { chatId: 5490992591n },
      getSender: async () => ({ firstName: 'Иван', username: 'ivan' }),
    };

    const result = await forwardMentionMessage({
      client,
      db,
      message,
      deps: { randomId: () => 1n },
    });

    expect(result).toEqual({ forwarded: true, sourceChatId: '-5490992591' });
    expect(client.sendMessage).toHaveBeenCalledWith('-1003582108958', {
      message: '🔔 Упоминание в «TEST - БРЕНД» от Иван @ivan',
      replyTo: 42,
    });
    const request = client.invoke.mock.calls[0][0];
    expect(request).toBeInstanceOf(Api.messages.ForwardMessages);
    expect(request.fromPeer).toEqual(message.peerId);
    expect(request.id).toEqual([777]);
    expect(request.toPeer).toBe('-1003582108958');
    expect(request.topMsgId).toBe(42);
  });

  it('skips when settings are not configured', async () => {
    const db = memDb();
    const client = { sendMessage: vi.fn(), invoke: vi.fn() };
    const result = await forwardMentionMessage({
      client,
      db,
      message: { id: 1, mentioned: true, peerId: { chatId: 1n } },
    });
    expect(result.skipped).toBe(true);
    expect(client.sendMessage).not.toHaveBeenCalled();
    expect(client.invoke).not.toHaveBeenCalled();
  });

  it('skips non-mentions', async () => {
    const { db, client } = setup();
    const result = await forwardMentionMessage({
      client,
      db,
      message: { id: 1, mentioned: false, peerId: { chatId: 5490992591n } },
    });
    expect(result.skipped).toBe(true);
    expect(client.invoke).not.toHaveBeenCalled();
  });

  it('forwards even when getSender fails', async () => {
    const { db, client } = setup();
    const result = await forwardMentionMessage({
      client,
      db,
      message: {
        id: 5,
        mentioned: true,
        peerId: { chatId: 5490992591n },
        getSender: async () => {
          throw new Error('boom');
        },
      },
      deps: { randomId: () => 1n },
    });
    expect(result.forwarded).toBe(true);
    expect(client.sendMessage).toHaveBeenCalledWith('-1003582108958', {
      message: '🔔 Упоминание в «TEST - БРЕНД»',
      replyTo: 42,
    });
  });
});

describe('initMentionForwarding', () => {
  it('attaches a NewMessage handler once per client', () => {
    const hooks = [];
    const client = { addEventHandler: vi.fn() };
    initMentionForwarding({ onClientReady: (fn) => hooks.push(fn) });

    expect(hooks).toHaveLength(1);
    hooks[0](client);
    hooks[0](client);
    expect(client.addEventHandler).toHaveBeenCalledTimes(1);
  });
});
