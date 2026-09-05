import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { handleWorkRequestInbound } from '../src/telegram/work-requests/handle-inbound.js';
import { setWorkRequestSlots } from '../src/telegram/work-requests/slots.js';

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
    CREATE UNIQUE INDEX idx_twr_album ON telegram_work_requests(chat_id, media_group_id)
      WHERE media_group_id IS NOT NULL AND media_group_id != '';
    INSERT INTO settings (key, value) VALUES ('telegram_work_request_slots', '[]');
  `);
  return db;
}

function seedQuoteSlot(db) {
  setWorkRequestSlots(db, [
    { chatId: '-1001', threadId: 12, companyLabel: 'Маяк', topicRole: 'QUOTE' },
  ]);
  return db;
}

function message(text, overrides = {}) {
  return {
    message_id: 11,
    message_thread_id: 12,
    chat: { id: -1001 },
    text,
    entities: [{ type: 'mention', offset: 0, length: 11 }],
    from: { id: 7, username: 'manager', first_name: 'Мария', is_bot: false },
    ...overrides,
  };
}

function deps(overrides = {}) {
  return {
    token: 'bot-token',
    getBotUsername: async () => 'intake_bot',
    callTelegram: vi.fn().mockResolvedValue({ message_id: 99 }),
    gql: vi.fn(),
    matchOpportunity: vi.fn().mockResolvedValue(null),
    createTelegramRequest: vi.fn().mockResolvedValue('tw-1'),
    ...overrides,
  };
}

describe('handleWorkRequestInbound', () => {
  it('refuses an incomplete quote without creating a Twenty record', async () => {
    const testDeps = deps();
    const result = await handleWorkRequestInbound({
      db: seedQuoteSlot(openMigrated()),
      update: { message: message('@intake_bot') },
      deps: testDeps,
    });

    expect(result).toEqual({ handled: true, action: 'refused' });
    expect(testDeps.createTelegramRequest).not.toHaveBeenCalled();
    expect(testDeps.callTelegram).toHaveBeenCalledWith(
      'bot-token',
      'sendMessage',
      expect.objectContaining({
        chat_id: '-1001',
        message_thread_id: 12,
        reply_to_message_id: 11,
        text: expect.stringContaining('напиши новое'),
      }),
    );
  });

  it('creates a linked Twenty request and replies accepted', async () => {
    const db = seedQuoteSlot(openMigrated());
    const testDeps = deps();
    const result = await handleWorkRequestInbound({
      db,
      update: { message: message('@intake_bot\nЧто посчитать: брендинг 1') },
      deps: testDeps,
    });

    expect(result).toEqual({ handled: true, action: 'accepted' });
    expect(testDeps.createTelegramRequest).toHaveBeenCalledWith(
      testDeps.gql,
      expect.objectContaining({
        name: 'Запрос #1',
        requestNumber: 1,
        stage: 'NEW',
        kind: 'QUOTE',
        company: 'Маяк',
        brief: 'брендинг 1',
        requesterName: 'Мария',
        requesterUsername: 'manager',
        telegramMessageUrl: 'https://t.me/c/1/11',
      }),
    );
    expect(db.prepare('SELECT twenty_id, bot_message_id FROM telegram_work_requests').get())
      .toEqual({ twenty_id: 'tw-1', bot_message_id: 99 });
  });

  it('removes the unfinished link and replies when Twenty creation fails', async () => {
    const db = seedQuoteSlot(openMigrated());
    const testDeps = deps({
      createTelegramRequest: vi.fn().mockRejectedValue(new Error('Twenty unavailable')),
    });

    const result = await handleWorkRequestInbound({
      db,
      update: { message: message('@intake_bot\nЧто посчитать: брендинг 1') },
      deps: testDeps,
    });

    expect(result).toEqual({ handled: true, action: 'create_failed' });
    expect(db.prepare('SELECT COUNT(*) AS count FROM telegram_work_requests').get().count).toBe(0);
    expect(testDeps.callTelegram).toHaveBeenLastCalledWith(
      'bot-token',
      'sendMessage',
      expect.objectContaining({ text: expect.stringContaining('Не удалось взять в работу') }),
    );
  });

  it('collects every file in an album when only one message contains the mention', async () => {
    vi.useFakeTimers();
    try {
      const db = seedQuoteSlot(openMigrated());
      const downloadTelegramFile = vi.fn(({ fileId }) => Promise.resolve({
        buffer: Buffer.from(fileId),
        filename: `${fileId}.jpg`,
        contentType: 'image/jpeg',
        fileSize: 10,
      }));
      const uploadRequestFile = vi.fn(({ filename }) => Promise.resolve({
        fileId: `uploaded-${filename}`,
      }));
      const testDeps = deps({ downloadTelegramFile, uploadRequestFile });
      const common = {
        media_group_id: 'album-1',
        text: undefined,
        photo: [{ file_size: 10 }],
      };
      const first = message(undefined, {
        ...common,
        caption: '@intake_bot\nЧто посчитать: два фото',
        caption_entities: [{ type: 'mention', offset: 0, length: 11 }],
        photo: [{ file_id: 'photo-1', file_unique_id: 'unique-1', file_size: 10 }],
      });
      const second = message(undefined, {
        ...common,
        message_id: 12,
        entities: undefined,
        photo: [{ file_id: 'photo-2', file_unique_id: 'unique-2', file_size: 10 }],
      });

      const results = [
        handleWorkRequestInbound({ db, update: { message: first }, deps: testDeps }),
        handleWorkRequestInbound({ db, update: { message: second }, deps: testDeps }),
      ];
      await vi.advanceTimersByTimeAsync(1000);

      expect((await Promise.all(results)).map((result) => result.action).sort())
        .toEqual(['accepted', 'duplicate']);
      expect(downloadTelegramFile).toHaveBeenCalledTimes(2);
      expect(testDeps.createTelegramRequest).toHaveBeenCalledWith(
        testDeps.gql,
        expect.objectContaining({
          requestFiles: [
            expect.objectContaining({ fileId: 'uploaded-photo-unique-1.jpg' }),
            expect.objectContaining({ fileId: 'uploaded-photo-unique-2.jpg' }),
          ],
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('parses the lowest message id in an album instead of the mention-bearing item', async () => {
    vi.useFakeTimers();
    try {
      const db = seedQuoteSlot(openMigrated());
      const testDeps = deps();
      const mentioned = message(undefined, {
        message_id: 12,
        media_group_id: 'album-form-order',
        text: undefined,
        caption: '@intake_bot',
        caption_entities: [{ type: 'mention', offset: 0, length: 11 }],
      });
      const form = message(undefined, {
        message_id: 11,
        media_group_id: 'album-form-order',
        text: undefined,
        entities: undefined,
        caption: 'Что посчитать: форма из первого сообщения',
        caption_entities: undefined,
      });

      const results = [
        handleWorkRequestInbound({ db, update: { message: mentioned }, deps: testDeps }),
        handleWorkRequestInbound({ db, update: { message: form }, deps: testDeps }),
      ];
      await vi.advanceTimersByTimeAsync(1000);

      expect((await Promise.all(results)).map((result) => result.action).sort())
        .toEqual(['accepted', 'duplicate']);
      expect(testDeps.createTelegramRequest).toHaveBeenCalledWith(
        testDeps.gql,
        expect.objectContaining({ brief: 'форма из первого сообщения' }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets only the newly inserted handler create Twenty for overlapping delivery', async () => {
    const db = seedQuoteSlot(openMigrated());
    const testDeps = deps();
    const update = { message: message('@intake_bot\nЧто посчитать: один запрос') };

    const results = await Promise.all([
      handleWorkRequestInbound({ db, update, deps: testDeps }),
      handleWorkRequestInbound({ db, update, deps: testDeps }),
    ]);

    expect(results.map((result) => result.action).sort()).toEqual(['accepted', 'duplicate']);
    expect(testDeps.createTelegramRequest).toHaveBeenCalledTimes(1);
    expect(testDeps.callTelegram).toHaveBeenCalledTimes(1);
  });

  it('ignores bot messages, unconfigured topics, and mentions of another bot', async () => {
    const db = seedQuoteSlot(openMigrated());
    const testDeps = deps();

    await expect(handleWorkRequestInbound({
      db,
      update: { edited_message: message('@intake_bot\nЧто посчитать: x') },
      deps: testDeps,
    })).resolves.toEqual({ handled: false });
    await expect(handleWorkRequestInbound({
      db,
      update: { message: message('@intake_bot\nЧто посчитать: x', { message_thread_id: 99 }) },
      deps: testDeps,
    })).resolves.toEqual({ handled: false });
    await expect(handleWorkRequestInbound({
      db,
      update: { message: message('@other_bot\nЧто посчитать: x') },
      deps: testDeps,
    })).resolves.toEqual({ handled: false });
  });
});
