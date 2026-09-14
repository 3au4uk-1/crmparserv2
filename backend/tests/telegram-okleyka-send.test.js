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
    CREATE TABLE IF NOT EXISTS telegram_okleyka_outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      line_item_id TEXT NOT NULL,
      opportunity_id TEXT,
      text TEXT NOT NULL,
      file_urls_json TEXT NOT NULL DEFAULT '[]',
      sent_by TEXT,
      force INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      error TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT,
      sending_started_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_telegram_okleyka_outbox_open
      ON telegram_okleyka_outbox(line_item_id)
      WHERE status IN ('pending', 'sending');
  `);
  db.prepare(
    `INSERT INTO settings VALUES ('telegram_chat_map', ?)`,
  ).run(JSON.stringify({ 'okleyka.send': '-1001' }));
  return db;
}

function sendDeps(overrides = {}) {
  return {
    sendOkleykaToTelegram: vi.fn(async () => ({ messageIds: [7] })),
    patchOkleykaTelegramFields: vi.fn(),
    createWrapOkleykaTask: vi.fn(),
    isUserbotConfigured: () => true,
    getUserbotClient: vi.fn(async () => ({ id: 'client' })),
    kickOkleykaDrain: vi.fn().mockResolvedValue(),
    ...overrides,
  };
}

describe('handleOkleykaSend', () => {
  beforeEach(() => clearHooksForTests());

  it('returns alreadySent without calling telegram or kicking drain when log exists', async () => {
    const db = memoryDb();
    db.prepare(
      `INSERT INTO telegram_send_log (event, line_item_id, chat_id, telegram_message_ids)
       VALUES ('okleyka.send', 'li-1', '-1001', '[1]')`,
    ).run();
    const deps = sendDeps();
    const result = await handleOkleykaSend(
      db,
      {
        event: 'okleyka.send',
        lineItemId: 'li-1',
        text: 'x',
        fileUrls: [],
        force: false,
      },
      deps,
    );
    expect(result.alreadySent).toBe(true);
    expect(deps.sendOkleykaToTelegram).not.toHaveBeenCalled();
    expect(deps.createWrapOkleykaTask).not.toHaveBeenCalled();
    expect(deps.getUserbotClient).not.toHaveBeenCalled();
    expect(deps.kickOkleykaDrain).not.toHaveBeenCalled();
    expect(
      db.prepare(`SELECT COUNT(*) AS n FROM telegram_okleyka_outbox`).get().n,
    ).toBe(0);
  });

  it('enqueues a pending job and kicks drain without sending telegram', async () => {
    const db = memoryDb();
    const deps = sendDeps();
    const result = await handleOkleykaSend(
      db,
      {
        event: 'okleyka.send',
        lineItemId: 'li-2',
        opportunityId: 'opp-2',
        text: 'Заказ: t',
        fileUrls: ['https://cdn.example.com/a.jpg'],
        sentBy: { name: 'Ann' },
        force: false,
      },
      deps,
    );
    expect(result).toEqual({
      ok: true,
      queued: true,
      jobId: result.jobId,
      status: 'pending',
    });
    expect(result.jobId).toEqual(expect.any(Number));
    expect(deps.sendOkleykaToTelegram).not.toHaveBeenCalled();
    expect(deps.createWrapOkleykaTask).not.toHaveBeenCalled();
    expect(deps.patchOkleykaTelegramFields).not.toHaveBeenCalled();
    expect(deps.getUserbotClient).not.toHaveBeenCalled();
    expect(deps.kickOkleykaDrain).toHaveBeenCalledOnce();
    expect(deps.kickOkleykaDrain).toHaveBeenCalledWith(db);

    const row = db
      .prepare(`SELECT * FROM telegram_okleyka_outbox WHERE id = ?`)
      .get(result.jobId);
    expect(row).toMatchObject({
      line_item_id: 'li-2',
      opportunity_id: 'opp-2',
      text: 'Заказ: t',
      sent_by: 'Ann',
      force: 0,
      status: 'pending',
    });
    expect(JSON.parse(row.file_urls_json)).toEqual(['https://cdn.example.com/a.jpg']);
  });

  it('enqueues with force even when send log exists', async () => {
    const db = memoryDb();
    db.prepare(
      `INSERT INTO telegram_send_log (event, line_item_id, chat_id, telegram_message_ids)
       VALUES ('okleyka.send', 'li-force', '-1001', '[1]')`,
    ).run();
    const deps = sendDeps();
    const result = await handleOkleykaSend(
      db,
      {
        event: 'okleyka.send',
        lineItemId: 'li-force',
        text: 'again',
        fileUrls: [],
        force: true,
      },
      deps,
    );
    expect(result.queued).toBe(true);
    expect(result.status).toBe('pending');
    expect(deps.sendOkleykaToTelegram).not.toHaveBeenCalled();
    expect(deps.kickOkleykaDrain).toHaveBeenCalledOnce();
    const row = db
      .prepare(`SELECT force FROM telegram_okleyka_outbox WHERE id = ?`)
      .get(result.jobId);
    expect(row.force).toBe(1);
  });

  it('returns 503 when userbot is not configured', async () => {
    const db = memoryDb();
    const deps = sendDeps({ isUserbotConfigured: () => false });
    await expect(
      handleOkleykaSend(
        db,
        {
          event: 'okleyka.send',
          lineItemId: 'li-503',
          text: 'x',
          fileUrls: [],
        },
        deps,
      ),
    ).rejects.toMatchObject({
      status: 503,
      message: 'Telegram не настроен (нужен user-bot и чат оклейки)',
    });
    expect(deps.kickOkleykaDrain).not.toHaveBeenCalled();
  });

  it('returns 503 when okleyka chat is missing', async () => {
    const db = memoryDb();
    db.prepare(`UPDATE settings SET value = ? WHERE key = 'telegram_chat_map'`).run(
      JSON.stringify({ 'okleyka.send': '' }),
    );
    const deps = sendDeps();
    await expect(
      handleOkleykaSend(
        db,
        {
          event: 'okleyka.send',
          lineItemId: 'li-no-chat',
          text: 'x',
          fileUrls: [],
        },
        deps,
      ),
    ).rejects.toMatchObject({ status: 503 });
    expect(deps.kickOkleykaDrain).not.toHaveBeenCalled();
    expect(deps.sendOkleykaToTelegram).not.toHaveBeenCalled();
  });

  it('rejects invalid event with 400', async () => {
    const db = memoryDb();
    await expect(
      handleOkleykaSend(db, { event: 'other', lineItemId: 'li-1', text: 'x' }, sendDeps()),
    ).rejects.toMatchObject({ status: 400, message: 'Unsupported event: other' });
  });

  it('rejects missing lineItemId with 400', async () => {
    const db = memoryDb();
    await expect(
      handleOkleykaSend(db, { event: 'okleyka.send', text: 'x' }, sendDeps()),
    ).rejects.toMatchObject({ status: 400, message: 'lineItemId required' });
  });

  it('rejects missing text with 400', async () => {
    const db = memoryDb();
    await expect(
      handleOkleykaSend(db, { event: 'okleyka.send', lineItemId: 'li-1' }, sendDeps()),
    ).rejects.toMatchObject({ status: 400, message: 'text required' });
  });
});
