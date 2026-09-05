import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';

import {
  buildDoneMessageHtml,
  publishWorkRequestReply,
} from '../src/telegram/work-requests/publish.js';
import { handleTelegramRequestRecordEvent } from '../src/telegram/work-requests/handle-twenty-update.js';
import {
  getWorkRequestLinkByTwentyId,
  insertWorkRequestLink,
  updateWorkRequestLink,
} from '../src/telegram/work-requests/store.js';

function dbWithLink({ lastPublishedText = null } = {}) {
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
  `);
  const link = insertWorkRequestLink(db, {
    chatId: '-1001',
    threadId: 12,
    sourceMessageId: 11,
    requesterUserId: '7',
    requesterUsername: 'ira',
    requesterName: 'Ира & Ко',
  });
  updateWorkRequestLink(db, link.id, {
    twentyId: 'tw-1',
    botMessageId: 99,
    lastPublishedText,
  });
  return db;
}

function donePayload(after, before = { stage: 'IN_PROGRESS' }) {
  const record = { id: 'tw-1', stage: 'DONE', replyText: 'Готово', ...after };
  return {
    eventName: 'telegramRequest.updated',
    objectMetadata: { nameSingular: 'telegramRequest' },
    record,
    properties: { before, after: record },
  };
}

describe('buildDoneMessageHtml', () => {
  it('mentions by user id and escapes Telegram HTML', () => {
    expect(buildDoneMessageHtml({
      replyText: 'Сумма < 10 & готово',
      requesterUserId: '7',
      requesterName: 'Ира & Ко',
      mention: true,
    })).toBe(
      '<a href="tg://user?id=7">Ира &amp; Ко</a>\n\nСумма &lt; 10 &amp; готово',
    );
  });

  it('omits mention when flag is off', () => {
    expect(buildDoneMessageHtml({
      replyText: 'Правка опечатки',
      requesterUsername: 'ira',
      mention: false,
    })).toBe('Правка опечатки');
  });
});

describe('publishWorkRequestReply', () => {
  it('edits the accepted message and stores the published text', async () => {
    const db = dbWithLink();
    const link = getWorkRequestLinkByTwentyId(db, 'tw-1');
    const callTelegram = vi.fn().mockResolvedValue({});

    await publishWorkRequestReply({
      db,
      token: 'token',
      link,
      replyText: 'Готово',
      mention: true,
      callTelegram,
    });

    expect(callTelegram).toHaveBeenCalledWith('token', 'editMessageText', {
      chat_id: '-1001',
      message_id: 99,
      text: '<a href="tg://user?id=7">Ира &amp; Ко</a>\n\nГотово',
      parse_mode: 'HTML',
    });
    expect(getWorkRequestLinkByTwentyId(db, 'tw-1').lastPublishedText).toBe('Готово');
  });
});

describe('handleTelegramRequestRecordEvent', () => {
  it('reverts DONE without replyText', async () => {
    const updateTelegramRequest = vi.fn();
    const publish = vi.fn();
    const result = await handleTelegramRequestRecordEvent({
      db: dbWithLink(),
      payload: donePayload({ replyText: '' }),
      deps: { updateTelegramRequest, publishWorkRequestReply: publish },
    });

    expect(result.action).toBe('reverted');
    expect(publish).not.toHaveBeenCalled();
    expect(updateTelegramRequest).toHaveBeenCalledWith('tw-1', {
      stage: 'IN_PROGRESS',
      publishError: 'Сначала заполни «Ответ в чат»',
    });
  });

  it('publishes and mentions on the first transition to DONE', async () => {
    const publish = vi.fn().mockResolvedValue({});
    const result = await handleTelegramRequestRecordEvent({
      db: dbWithLink(),
      payload: donePayload(),
      deps: { publishWorkRequestReply: publish, updateTelegramRequest: vi.fn() },
    });

    expect(result.action).toBe('published');
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      replyText: 'Готово',
      mention: true,
    }));
  });

  it('does not publish identical DONE text again', async () => {
    const publish = vi.fn();
    const result = await handleTelegramRequestRecordEvent({
      db: dbWithLink({ lastPublishedText: 'Готово' }),
      payload: donePayload(
        { republishRequested: false },
        { stage: 'DONE', replyText: 'Готово' },
      ),
      deps: { publishWorkRequestReply: publish, updateTelegramRequest: vi.fn() },
    });

    expect(result.action).toBe('noop');
    expect(publish).not.toHaveBeenCalled();
  });

  it('mentions on requested republish only when configured', async () => {
    const publish = vi.fn().mockResolvedValue({});
    const updateTelegramRequest = vi.fn();
    const result = await handleTelegramRequestRecordEvent({
      db: dbWithLink({ lastPublishedText: 'Старый ответ' }),
      payload: donePayload(
        { republishRequested: true, notifyOnRepublish: false },
        { stage: 'DONE', replyText: 'Старый ответ' },
      ),
      deps: { publishWorkRequestReply: publish, updateTelegramRequest },
    });

    expect(result.action).toBe('published');
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ mention: false }));
    expect(updateTelegramRequest).toHaveBeenCalledWith('tw-1', {
      republishRequested: false,
      publishError: '',
    });
  });

  it('ignores non-DONE stages without touching Telegram', async () => {
    const publish = vi.fn();
    const updateTelegramRequest = vi.fn();
    const result = await handleTelegramRequestRecordEvent({
      db: dbWithLink(),
      payload: {
        record: { id: 'tw-1', stage: 'IN_PROGRESS', replyText: 'Черновик' },
        properties: { before: { stage: 'NEW' } },
      },
      deps: { publishWorkRequestReply: publish, updateTelegramRequest },
    });

    expect(result.action).toBe('ignore');
    expect(publish).not.toHaveBeenCalled();
    expect(updateTelegramRequest).not.toHaveBeenCalled();
  });
});
