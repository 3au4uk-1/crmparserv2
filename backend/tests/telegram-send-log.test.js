import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  getTelegramBotToken,
  getTelegramChatId,
  getTelegramDestination,
} from '../src/telegram/settings.js';
import { findLastSend, findSendForLoadDate, insertSendLog } from '../src/telegram/send-log.js';

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
    CREATE INDEX idx_telegram_send_log_event_line
      ON telegram_send_log(event, line_item_id);
    CREATE UNIQUE INDEX idx_telegram_send_log_event_line_load
      ON telegram_send_log(event, line_item_id, load_date)
      WHERE load_date IS NOT NULL;
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

  it('reads destination with legacy string map entry', () => {
    expect(getTelegramDestination(db, 'okleyka.send')).toEqual({
      chatId: '-100123',
      threadId: null,
    });
    expect(getTelegramDestination(db, 'other')).toBeNull();
  });

  it('reads destination with threadId from object map entry', () => {
    db.prepare(`UPDATE settings SET value = ? WHERE key = 'telegram_chat_map'`).run(
      JSON.stringify({ 'okleyka.send': { chatId: '-100123', threadId: 42 } }),
    );
    expect(getTelegramDestination(db, 'okleyka.send')).toEqual({
      chatId: '-100123',
      threadId: 42,
    });
    expect(getTelegramChatId(db, 'okleyka.send')).toBe('-100123');
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

  it('finds send by event, line item and load_date', () => {
    expect(
      findSendForLoadDate(db, 'banner_podryad.evening', 'li-1', '2026-08-25'),
    ).toBeUndefined();
    insertSendLog(db, {
      event: 'banner_podryad.evening',
      lineItemId: 'li-1',
      opportunityId: 'opp-1',
      chatId: '-100123',
      sentBy: 'cron',
      payloadHash: 'hash',
      telegramMessageIds: [9],
      loadDate: '2026-08-25',
    });
    const row = findSendForLoadDate(db, 'banner_podryad.evening', 'li-1', '2026-08-25');
    expect(row.load_date).toBe('2026-08-25');
    expect(row.line_item_id).toBe('li-1');
    expect(
      findSendForLoadDate(db, 'banner_podryad.evening', 'li-1', '2026-08-26'),
    ).toBeUndefined();
  });

  it('enforces unique event+line_item+load_date when load_date is set', () => {
    const payload = {
      event: 'banner_podryad.evening',
      lineItemId: 'li-2',
      loadDate: '2026-08-25',
    };
    insertSendLog(db, payload);
    expect(() => insertSendLog(db, payload)).toThrow();
    expect(() =>
      insertSendLog(db, { ...payload, loadDate: '2026-08-26' }),
    ).not.toThrow();
  });
});
