import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { findSlot, setWorkRequestSlots } from '../src/telegram/work-requests/slots.js';

function openDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    INSERT INTO settings (key, value) VALUES ('telegram_work_request_slots', '[]');
  `);
  return db;
}

describe('findSlot', () => {
  it('matches a message from -100… when the saved slot used the short t.me/c id', () => {
    const db = openDb();
    setWorkRequestSlots(db, [
      { chatId: '555000555', threadId: 4, companyLabel: 'Маяк', topicRole: 'QUOTE' },
    ]);

    expect(findSlot(db, '-100555000555', 4)).toEqual({
      chatId: '-100555000555',
      threadId: 4,
      companyLabel: 'Маяк',
      topicRole: 'QUOTE',
    });
  });
});
