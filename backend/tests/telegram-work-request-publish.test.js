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

function donePayload(after = {}, updatedFields = ['stage'], eventName = 'telegramRequest.updated') {
  return {
    eventName,
    objectMetadata: { nameSingular: 'telegramRequest' },
    record: { id: 'tw-1', stage: 'DONE', replyText: 'Готово', ...after },
    updatedFields,
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

  it('sends a new reply and stores its id when the accepted message is missing', async () => {
    const db = dbWithLink();
    const link = getWorkRequestLinkByTwentyId(db, 'tw-1');
    updateWorkRequestLink(db, link.id, { botMessageId: null });
    const callTelegram = vi.fn().mockResolvedValue({ message_id: 123 });

    await publishWorkRequestReply({
      db,
      token: 'token',
      link: getWorkRequestLinkByTwentyId(db, 'tw-1'),
      replyText: 'Готово',
      mention: false,
      callTelegram,
    });

    expect(callTelegram).toHaveBeenCalledWith('token', 'sendMessage', {
      chat_id: '-1001',
      message_thread_id: 12,
      reply_to_message_id: 11,
      text: 'Готово',
      parse_mode: 'HTML',
    });
    expect(getWorkRequestLinkByTwentyId(db, 'tw-1')).toEqual(expect.objectContaining({
      botMessageId: 123,
      lastPublishedText: 'Готово',
    }));
  });
});

describe('handleTelegramRequestRecordEvent', () => {
  it('reports no_link for a DONE record without a link row', async () => {
    const db = dbWithLink();
    db.prepare('DELETE FROM telegram_work_requests').run();
    const updateTelegramRequest = vi.fn();
    const publish = vi.fn();

    const result = await handleTelegramRequestRecordEvent({
      db,
      payload: donePayload(),
      deps: { updateTelegramRequest, publishWorkRequestReply: publish },
    });

    expect(result.action).toBe('no_link');
    expect(updateTelegramRequest).toHaveBeenCalledWith('tw-1', {
      publishError: 'нет связки с чатом',
    });
    expect(publish).not.toHaveBeenCalled();
  });

  it('ignores an IN_PROGRESS record without a link or a Twenty write', async () => {
    const db = dbWithLink();
    db.prepare('DELETE FROM telegram_work_requests').run();
    const updateTelegramRequest = vi.fn();
    const publish = vi.fn();

    const result = await handleTelegramRequestRecordEvent({
      db,
      payload: {
        record: { id: 'tw-1', stage: 'IN_PROGRESS', replyText: 'Черновик' },
        properties: { before: { stage: 'NEW' } },
      },
      deps: { updateTelegramRequest, publishWorkRequestReply: publish },
    });

    expect(result.action).toBe('ignore');
    expect(updateTelegramRequest).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('reverts an unpublished DONE card without replyText to NEW', async () => {
    const updateTelegramRequest = vi.fn();
    const publish = vi.fn();
    const result = await handleTelegramRequestRecordEvent({
      db: dbWithLink(),
      payload: donePayload({ replyText: '' }, ['stage']),
      deps: { updateTelegramRequest, publishWorkRequestReply: publish },
    });

    expect(result.action).toBe('reverted');
    expect(publish).not.toHaveBeenCalled();
    expect(updateTelegramRequest).toHaveBeenCalledWith('tw-1', {
      stage: 'NEW',
      publishError: 'Сначала заполни «Ответ в чат»',
    });
  });

  it('reverts a previously published DONE card without replyText to IN_PROGRESS', async () => {
    const updateTelegramRequest = vi.fn();
    const result = await handleTelegramRequestRecordEvent({
      db: dbWithLink({ lastPublishedText: 'Старый ответ' }),
      payload: donePayload({ replyText: '' }, ['replyText']),
      deps: { updateTelegramRequest, publishWorkRequestReply: vi.fn() },
    });

    expect(result.action).toBe('reverted');
    expect(updateTelegramRequest).toHaveBeenCalledWith('tw-1', {
      stage: 'IN_PROGRESS',
      publishError: 'Сначала заполни «Ответ в чат»',
    });
  });

  it('publishes and mentions on the first transition to DONE', async () => {
    const publish = vi.fn().mockResolvedValue({});
    const updateTelegramRequest = vi.fn();
    const result = await handleTelegramRequestRecordEvent({
      db: dbWithLink(),
      payload: donePayload({ publishError: 'Старая ошибка' }, ['stage']),
      deps: { publishWorkRequestReply: publish, updateTelegramRequest },
    });

    expect(result.action).toBe('published');
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      replyText: 'Готово',
      mention: true,
    }));
    expect(updateTelegramRequest).toHaveBeenCalledWith('tw-1', { publishError: '' });
  });

  it('publishes a never-published DONE card when updatedFields is empty', async () => {
    const publish = vi.fn().mockResolvedValue({});
    const updateTelegramRequest = vi.fn();
    const result = await handleTelegramRequestRecordEvent({
      db: dbWithLink(),
      payload: donePayload({ publishError: '', republishRequested: false }, []),
      deps: { publishWorkRequestReply: publish, updateTelegramRequest },
    });

    expect(result.action).toBe('published');
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ mention: true }));
    expect(updateTelegramRequest).not.toHaveBeenCalled();
  });

  it('ignores an empty updatedFields echo after a failed publish', async () => {
    const publish = vi.fn();
    const updateTelegramRequest = vi.fn();
    const result = await handleTelegramRequestRecordEvent({
      db: dbWithLink(),
      payload: donePayload(
        { publishError: 'Telegram 400', republishRequested: false },
        [],
      ),
      deps: { publishWorkRequestReply: publish, updateTelegramRequest },
    });

    expect(result.action).toBe('ignore');
    expect(publish).not.toHaveBeenCalled();
    expect(updateTelegramRequest).not.toHaveBeenCalled();
  });

    it('does not rewrite no_link error when a later field changes', async () => {
    const db = dbWithLink();
    db.prepare('DELETE FROM telegram_work_requests').run();
    const publish = vi.fn();
    const updateTelegramRequest = vi.fn();
    const result = await handleTelegramRequestRecordEvent({
      db,
      payload: donePayload(
        { publishError: 'нет связки с чатом', republishRequested: false },
        ['positionName'],
      ),
      deps: { publishWorkRequestReply: publish, updateTelegramRequest },
    });

    expect(result.action).toBe('ignore');
    expect(publish).not.toHaveBeenCalled();
    expect(updateTelegramRequest).not.toHaveBeenCalled();
  });

  it('ignores an empty updatedFields echo after writing a missing-link error', async () => {
    const db = dbWithLink();
    db.prepare('DELETE FROM telegram_work_requests').run();
    const publish = vi.fn();
    const updateTelegramRequest = vi.fn();
    const result = await handleTelegramRequestRecordEvent({
      db,
      payload: donePayload(
        { publishError: 'нет связки с чатом', republishRequested: false },
        [],
      ),
      deps: { publishWorkRequestReply: publish, updateTelegramRequest },
    });

    expect(result.action).toBe('ignore');
    expect(publish).not.toHaveBeenCalled();
    expect(updateTelegramRequest).not.toHaveBeenCalled();
  });

  it('does not publish identical DONE text again', async () => {
    const publish = vi.fn();
    const result = await handleTelegramRequestRecordEvent({
      db: dbWithLink({ lastPublishedText: 'Готово' }),
      payload: donePayload({ republishRequested: false }, ['positionName']),
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
        ['republishRequested'],
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

  it('ignores the webhook caused by clearing republish fields', async () => {
    const publish = vi.fn();
    const updateTelegramRequest = vi.fn();
    const result = await handleTelegramRequestRecordEvent({
      db: dbWithLink({ lastPublishedText: 'Готово' }),
      payload: donePayload(
        { republishRequested: false, publishError: '' },
        ['republishRequested', 'publishError'],
      ),
      deps: { publishWorkRequestReply: publish, updateTelegramRequest },
    });

    expect(result.action).toBe('ignore');
    expect(publish).not.toHaveBeenCalled();
    expect(updateTelegramRequest).not.toHaveBeenCalled();
  });

  it('ignores a publishError-only update on a DONE card', async () => {
    const publish = vi.fn();
    const updateTelegramRequest = vi.fn();
    const result = await handleTelegramRequestRecordEvent({
      db: dbWithLink(),
      payload: donePayload({ publishError: 'Telegram unavailable' }, ['publishError']),
      deps: { publishWorkRequestReply: publish, updateTelegramRequest },
    });

    expect(result.action).toBe('ignore');
    expect(publish).not.toHaveBeenCalled();
    expect(updateTelegramRequest).not.toHaveBeenCalled();
  });

  it('ignores deleted events even when the record is DONE', async () => {
    const publish = vi.fn();
    const updateTelegramRequest = vi.fn();
    const result = await handleTelegramRequestRecordEvent({
      db: dbWithLink(),
      payload: donePayload({}, [], 'telegramRequest.deleted'),
      deps: { publishWorkRequestReply: publish, updateTelegramRequest },
    });

    expect(result.action).toBe('ignore');
    expect(publish).not.toHaveBeenCalled();
    expect(updateTelegramRequest).not.toHaveBeenCalled();
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
