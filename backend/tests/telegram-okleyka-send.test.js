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
        createWrapOkleykaTask: vi.fn().mockResolvedValue({ id: 't1' }),
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
        createWrapOkleykaTask: vi.fn().mockResolvedValue({ id: 't1' }),
      },
    );
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      chatId: '-1001',
      threadId: 42,
      client: { id: 'client' },
    }));
  });

  it('creates wrap task after telegram success with text and fileUrls', async () => {
    const db = memoryDb();
    const send = vi.fn(async () => ({ messageIds: [7] }));
    const patch = vi.fn(async () => {});
    const createWrap = vi.fn().mockResolvedValue({ id: 't1' });
    const result = await handleOkleykaSend(
      db,
      {
        event: 'okleyka.send',
        lineItemId: 'li-wrap',
        opportunityId: 'opp-wrap',
        text: 'Заказ: wrap',
        fileUrls: ['https://cdn.example.com/a.jpg'],
        force: false,
      },
      {
        sendOkleykaToTelegram: send,
        patchOkleykaTelegramFields: patch,
        isUserbotConfigured: () => true,
        getUserbotClient: async () => ({}),
        createWrapOkleykaTask: createWrap,
      },
    );
    expect(result.ok).toBe(true);
    expect(createWrap).toHaveBeenCalledWith({
      lineItemId: 'li-wrap',
      opportunityId: 'opp-wrap',
      text: 'Заказ: wrap',
      fileUrls: ['https://cdn.example.com/a.jpg'],
      force: false,
    });
  });

  it('keeps telegram ok when wrap task throws and sets wrap_task_failed warning', async () => {
    const db = memoryDb();
    const send = vi.fn(async () => ({ messageIds: [7] }));
    const patch = vi.fn(async () => {});
    const createWrap = vi.fn().mockRejectedValue(new Error('twenty down'));
    const result = await handleOkleykaSend(
      db,
      {
        event: 'okleyka.send',
        lineItemId: 'li-wrap-fail',
        opportunityId: 'opp-wrap',
        text: 'Заказ: wrap',
        fileUrls: [],
        force: false,
      },
      {
        sendOkleykaToTelegram: send,
        patchOkleykaTelegramFields: patch,
        isUserbotConfigured: () => true,
        getUserbotClient: async () => ({}),
        createWrapOkleykaTask: createWrap,
      },
    );
    expect(result.ok).toBe(true);
    expect(result.warning).toBeTruthy();
    expect(result.warning).toContain('wrap_task_failed');
  });

  it('does not create wrap task when alreadySent', async () => {
    const db = memoryDb();
    db.prepare(
      `INSERT INTO telegram_send_log (event, line_item_id, chat_id, telegram_message_ids)
       VALUES ('okleyka.send', 'li-1', '-1001', '[1]')`,
    ).run();
    const send = vi.fn();
    const patch = vi.fn();
    const createWrap = vi.fn();
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
        createWrapOkleykaTask: createWrap,
      },
    );
    expect(result.alreadySent).toBe(true);
    expect(createWrap).not.toHaveBeenCalled();
  });

  it('does not create wrap task when telegram send throws', async () => {
    const db = memoryDb();
    const send = vi.fn(async () => {
      throw new Error('telegram down');
    });
    const createWrap = vi.fn();
    await expect(
      handleOkleykaSend(
        db,
        {
          event: 'okleyka.send',
          lineItemId: 'li-throw',
          text: 'x',
          fileUrls: [],
          force: false,
        },
        {
          sendOkleykaToTelegram: send,
          patchOkleykaTelegramFields: vi.fn(),
          isUserbotConfigured: () => true,
          getUserbotClient: async () => ({}),
          createWrapOkleykaTask: createWrap,
        },
      ),
    ).rejects.toThrow('telegram down');
    expect(createWrap).not.toHaveBeenCalled();
  });

  it('appends wrap_task_failed when CRM patch already warned', async () => {
    const db = memoryDb();
    const send = vi.fn(async () => ({ messageIds: [7] }));
    const patch = vi.fn(async () => {
      throw new Error('crm down');
    });
    const createWrap = vi.fn().mockRejectedValue(new Error('twenty down'));
    const result = await handleOkleykaSend(
      db,
      {
        event: 'okleyka.send',
        lineItemId: 'li-both',
        text: 'x',
        fileUrls: [],
        force: false,
      },
      {
        sendOkleykaToTelegram: send,
        patchOkleykaTelegramFields: patch,
        isUserbotConfigured: () => true,
        getUserbotClient: async () => ({}),
        createWrapOkleykaTask: createWrap,
      },
    );
    expect(result.ok).toBe(true);
    expect(result.warning).toBe('crm_patch_failed,wrap_task_failed');
  });
});
