import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import { getTelegramBotToken, getTelegramChatId } from '../src/telegram/settings.js';
import { findLastSend, insertSendLog } from '../src/telegram/send-log.js';

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
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_telegram_send_log_event_line
      ON telegram_send_log(event, line_item_id);
  `);
  return db;
}

describe('telegram settings + send-log', () => {
  let db;
  beforeEach(() => {
    db = memoryDb();
    db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)`).run(
      'telegram_bot_token',
      'tok-1',
    );
    db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)`).run(
      'telegram_chat_map',
      JSON.stringify({ 'okleyka.send': '-100123' }),
    );
  });

  it('reads token and chat id', () => {
    expect(getTelegramBotToken(db)).toBe('tok-1');
    expect(getTelegramChatId(db, 'okleyka.send')).toBe('-100123');
    expect(getTelegramChatId(db, 'other')).toBe('');
  });

  it('tracks last send per event+lineItem', () => {
    expect(findLastSend(db, 'okleyka.send', 'li-1')).toBeUndefined();
    insertSendLog(db, {
      event: 'okleyka.send',
      lineItemId: 'li-1',
      opportunityId: 'opp-1',
      chatId: '-100123',
      sentBy: 'Ann',
      payloadHash: 'abc',
      telegramMessageIds: [1, 2],
    });
    const last = findLastSend(db, 'okleyka.send', 'li-1');
    expect(last.line_item_id).toBe('li-1');
    expect(JSON.parse(last.telegram_message_ids)).toEqual([1, 2]);
  });
});
