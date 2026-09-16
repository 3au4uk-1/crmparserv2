import Database from 'better-sqlite3';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { pollOnce } from '../src/telegram/polling.js';
import { handleWorkRequestInbound } from '../src/telegram/work-requests/handle-inbound.js';
import { setWorkRequestSlots } from '../src/telegram/work-requests/slots.js';

let testDb;

vi.mock('../src/db/connection.js', () => ({
  getDb: () => testDb,
}));

function openDb({ token = '123:abc' } = {}) {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);`);
  if (token) {
    db.prepare(`INSERT INTO settings (key, value) VALUES ('telegram_bot_token', ?)`).run(token);
  }
  return db;
}

function openWorkRequestDb() {
  const db = openDb();
  db.exec(`
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
  setWorkRequestSlots(db, [
    { chatId: '-1001', threadId: 12, companyLabel: 'Маяк', topicRole: 'QUOTE' },
  ]);
  return db;
}

describe('telegram polling', () => {
  beforeEach(() => {
    testDb = openDb();
  });

  it('is idle without bot token', async () => {
    testDb = openDb({ token: null });
    const call = vi.fn();
    const state = { offset: 0, webhookCleared: false };
    const result = await pollOnce(testDb, state, { callTelegram: call });
    expect(result.idle).toBe(true);
    expect(call).not.toHaveBeenCalled();
  });

  it('deletes webhook once, then long-polls getUpdates', async () => {
    const call = vi.fn().mockImplementation(async (token, method) => {
      if (method === 'deleteWebhook') return true;
      return [];
    });
    const state = { offset: 0, webhookCleared: false };

    await pollOnce(testDb, state, { callTelegram: call });
    await pollOnce(testDb, state, { callTelegram: call });

    const deleteCalls = call.mock.calls.filter(([, method]) => method === 'deleteWebhook');
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0][2]).toEqual({ drop_pending_updates: false });

    const updateCalls = call.mock.calls.filter(([, method]) => method === 'getUpdates');
    expect(updateCalls).toHaveLength(2);
    expect(updateCalls[0][2]).toMatchObject({
      offset: 0,
      timeout: 30,
      allowed_updates: ['message', 'channel_post', 'my_chat_member'],
    });
  });

  it('processes updates and advances offset past failures', async () => {
    const updates = [
      { update_id: 10, message: { chat: { id: -1, type: 'group', title: 'A' } } },
      { update_id: 11, my_chat_member: { chat: { id: -2, type: 'group' } } },
    ];
    const call = vi.fn().mockImplementation(async (token, method) =>
      method === 'getUpdates' ? updates : true,
    );
    const processed = [];
    const process = vi.fn(async (db, update) => {
      await Promise.resolve();
      processed.push(update.update_id);
      if (update.update_id === 10) throw new Error('boom');
    });
    const state = { offset: 0, webhookCleared: true };

    await pollOnce(testDb, state, { callTelegram: call, processTelegramUpdate: process });

    expect(processed).toEqual([10, 11]);
    expect(state.offset).toBe(12);
  });

  it('ingests album siblings concurrently as one request with both attachments', async () => {
    vi.useFakeTimers();
    try {
      const db = openWorkRequestDb();
      const updates = [
        {
          update_id: 10,
          message: {
            message_id: 20,
            message_thread_id: 12,
            media_group_id: 'poll-album',
            chat: { id: -1001 },
            caption: '@intake_bot\nЧто посчитать: альбом',
            caption_entities: [{ type: 'mention', offset: 0, length: 11 }],
            photo: [{ file_id: 'one', file_unique_id: 'u1', file_size: 10 }],
            from: { id: 7, first_name: 'М', is_bot: false },
          },
        },
        {
          update_id: 11,
          message: {
            message_id: 21,
            message_thread_id: 12,
            media_group_id: 'poll-album',
            chat: { id: -1001 },
            photo: [{ file_id: 'two', file_unique_id: 'u2', file_size: 10 }],
            from: { id: 7, first_name: 'М', is_bot: false },
          },
        },
      ];
      const call = vi.fn(async (token, method) => (method === 'getUpdates' ? updates : true));
      const createTelegramRequest = vi.fn().mockResolvedValue('tw-album');
      const uploadRequestFile = vi.fn(({ filename }) =>
        Promise.resolve({ fileId: `uploaded-${filename}` }));
      const handlerDeps = {
        token: '123:abc',
        getBotUsername: async () => 'intake_bot',
        callTelegram: vi.fn().mockResolvedValue({ message_id: 99 }),
        gql: vi.fn(),
        matchOpportunity: vi.fn().mockResolvedValue(null),
        createTelegramRequest,
        downloadTelegramFile: vi.fn(({ fileId }) => Promise.resolve({
          buffer: Buffer.from(fileId),
          filename: `${fileId}.jpg`,
          contentType: 'image/jpeg',
          fileSize: 10,
        })),
        uploadRequestFile,
      };
      const polling = pollOnce(db, { offset: 0, webhookCleared: true }, {
        callTelegram: call,
        processTelegramUpdate: (database, update) =>
          handleWorkRequestInbound({ db: database, update, deps: handlerDeps }),
      });

      await vi.advanceTimersByTimeAsync(1000);
      await vi.advanceTimersByTimeAsync(1000);
      await polling;

      expect(createTelegramRequest).toHaveBeenCalledTimes(1);
      expect(uploadRequestFile).toHaveBeenCalledTimes(2);
      expect(createTelegramRequest).toHaveBeenCalledWith(
        handlerDeps.gql,
        expect.objectContaining({
          requestFiles: [
            expect.objectContaining({ fileId: 'uploaded-photo-u1.jpg' }),
            expect.objectContaining({ fileId: 'uploaded-photo-u2.jpg' }),
          ],
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});
