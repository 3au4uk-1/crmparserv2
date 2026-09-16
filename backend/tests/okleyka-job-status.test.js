import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migrate } from '../src/db/migrate.js';
import {
  enqueueOkleykaJob,
  completeOkleykaJob,
  getOkleykaJobStatus,
} from '../src/telegram/okleyka-outbox.js';
import { insertSendLog } from '../src/telegram/send-log.js';

function dbWithOutbox() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)`);
  migrate(db);
  return db;
}

describe('getOkleykaJobStatus', () => {
  it('returns null job when no outbox row exists', () => {
    const db = dbWithOutbox();
    expect(getOkleykaJobStatus(db, 'li-missing')).toEqual({
      job: null,
      alreadySent: false,
      lastSentAt: null,
    });
  });

  it('returns pending job from outbox', () => {
    const db = dbWithOutbox();
    const { id } = enqueueOkleykaJob(db, {
      lineItemId: 'li-1',
      text: 'hello',
      fileUrls: [],
      force: false,
    });
    const row = db.prepare(`SELECT updated_at FROM telegram_okleyka_outbox WHERE id = ?`).get(id);

    expect(getOkleykaJobStatus(db, 'li-1')).toEqual({
      job: {
        id,
        status: 'pending',
        error: null,
        updatedAt: row.updated_at,
      },
      alreadySent: false,
      lastSentAt: null,
    });
  });

  it('returns sent job and alreadySent from send_log', () => {
    const db = dbWithOutbox();
    const { id } = enqueueOkleykaJob(db, {
      lineItemId: 'li-1',
      text: 'done',
      fileUrls: [],
      force: false,
    });
    completeOkleykaJob(db, id);
    insertSendLog(db, {
      event: 'okleyka.send',
      lineItemId: 'li-1',
      opportunityId: 'opp-1',
      chatId: '-100123',
      sentBy: 'Ann',
      payloadHash: 'abc',
      telegramMessageIds: [1],
    });
    db.prepare(`UPDATE telegram_send_log SET created_at = ? WHERE line_item_id = ?`).run(
      '2026-09-14T12:00:00.000Z',
      'li-1',
    );
    const row = db.prepare(`SELECT updated_at FROM telegram_okleyka_outbox WHERE id = ?`).get(id);

    expect(getOkleykaJobStatus(db, 'li-1')).toEqual({
      job: {
        id,
        status: 'sent',
        error: null,
        updatedAt: row.updated_at,
      },
      alreadySent: true,
      lastSentAt: '2026-09-14T12:00:00.000Z',
    });
  });
});
