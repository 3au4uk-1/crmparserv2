import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearHooksForTests } from '../src/telegram/hooks.js';
import { handleOkleykaSend } from '../src/telegram/handle-okleyka-send.js';

function memoryDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE telegram_send_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event TEXT NOT NULL,
      line_item_id TEXT NOT NULL,
      opportunity_id TEXT,
      chat_id TEXT,
      sent_by TEXT,
      payload_hash TEXT,
      telegram_message_ids TEXT,
      load_date TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  db.prepare(
    `INSERT INTO settings VALUES ('telegram_chat_map', ?)`,
  ).run(JSON.stringify({ 'okleyka.send': '-1001' }));
  return db;
}

describe('handleOkleykaSend', () => {
  beforeEach(() => clearHooksForTests());

  it('returns alreadySent without calling telegram when log exists', async () => {
    const db = memoryDb();
    db.prepare(
      `INSERT INTO telegram_send_log (event, line_item_id, chat_id, telegram_message_ids)
       VALUES ('okleyka.send', 'li-1', '-1001', '[1]')`,
    ).run();
    const send = vi.fn();
    const patch = vi.fn();
    const result = await handleOkleykaSend(
      db,
      {
        event: 'okleyka.send',
        lineItemId: 'li-1',
        text: 'x',
        fileUrls: [],
        force: false,
      },
      {
        sendOkleykaToTelegram: send,
        patchOkleykaTelegramFields: patch,
        isUserbotConfigured: () => true,
        getUserbotClient: async () => ({}),
      },
    );
    expect(result.alreadySent).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it('sends, logs, and patches on success', async () => {
    const db = memoryDb();
    const send = vi.fn(async () => ({ messageIds: [7] }));
    const patch = vi.fn(async () => {});
    const result = await handleOkleykaSend(
      db,
      {
        event: 'okleyka.send',
        lineItemId: 'li-2',
        opportunityId: 'opp-2',
        text: 'Заказ: t',
        fileUrls: [],
        sentBy: { name: 'Ann' },
        force: false,
      },
      {
        sendOkleykaToTelegram: send,
        patchOkleykaTelegramFields: patch,
        isUserbotConfigured: () => true,
        getUserbotClient: async () => ({ id: 'client' }),
      },
    );
    expect(result.ok).toBe(true);
    expect(result.messageIds).toEqual([7]);
    expect(send).toHaveBeenCalledOnce();
    expect(patch).toHaveBeenCalledOnce();
  });

  it('passes threadId from destination to send', async () => {
    const db = memoryDb();
    db.prepare(`UPDATE settings SET value = ? WHERE key = 'telegram_chat_map'`).run(
      JSON.stringify({ 'okleyka.send': { chatId: '-1001', threadId: 42 } }),
    );
    const send = vi.fn(async () => ({ messageIds: [7] }));
    const patch = vi.fn(async () => {});
    await handleOkleykaSend(
      db,
      {
        event: 'okleyka.send',
        lineItemId: 'li-3',
        text: 'Заказ: t',
        fileUrls: [],
        force: false,
      },
      {
        sendOkleykaToTelegram: send,
        patchOkleykaTelegramFields: patch,
        isUserbotConfigured: () => true,
        getUserbotClient: async () => ({ id: 'client' }),
      },
    );
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      chatId: '-1001',
      threadId: 42,
      client: { id: 'client' },
    }));
  });
});
