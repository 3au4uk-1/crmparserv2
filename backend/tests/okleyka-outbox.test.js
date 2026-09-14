import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migrate } from '../src/db/migrate.js';
import {
  enqueueOkleykaJob,
  getOpenOkleykaJob,
  getOkleykaJobForLineItem,
  claimNextOkleykaJob,
  completeOkleykaJob,
  failOkleykaJob,
  retryOkleykaJob,
  recoverStaleOkleykaSending,
} from '../src/telegram/okleyka-outbox.js';

function dbWithOutbox() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)`);
  migrate(db);
  return db;
}

describe('okleyka-outbox', () => {
  it('coalesces pending jobs per line item', () => {
    const db = dbWithOutbox();
    const a = enqueueOkleykaJob(db, {
      lineItemId: 'li-1',
      text: 'first',
      fileUrls: [],
      force: false,
    });
    const b = enqueueOkleykaJob(db, {
      lineItemId: 'li-1',
      text: 'second',
      fileUrls: ['https://x'],
      force: true,
    });
    expect(b.id).toBe(a.id);
    expect(b.status).toBe('pending');
    const row = getOpenOkleykaJob(db, 'li-1');
    expect(row.text).toBe('second');
    expect(JSON.parse(row.file_urls_json)).toEqual(['https://x']);
    expect(row.force).toBe(1);
  });

  it('does not change payload while sending', () => {
    const db = dbWithOutbox();
    enqueueOkleykaJob(db, { lineItemId: 'li-1', text: 'a', fileUrls: [], force: false });
    const claimed = claimNextOkleykaJob(db);
    expect(claimed.status).toBe('sending');
    const again = enqueueOkleykaJob(db, { lineItemId: 'li-1', text: 'b', fileUrls: [], force: false });
    expect(again.id).toBe(claimed.id);
    expect(again.status).toBe('sending');
    expect(getOpenOkleykaJob(db, 'li-1').text).toBe('a');
  });

  it('requeues sending older than 120s', () => {
    const db = dbWithOutbox();
    enqueueOkleykaJob(db, { lineItemId: 'li-1', text: 'a', fileUrls: [], force: false });
    claimNextOkleykaJob(db);
    db.prepare(
      `UPDATE telegram_okleyka_outbox SET sending_started_at = datetime('now', '-3 minutes')`,
    ).run();
    expect(recoverStaleOkleykaSending(db)).toBe(1);
    expect(getOpenOkleykaJob(db, 'li-1').status).toBe('pending');
  });

  it('claim is FIFO and skips future next_attempt_at', () => {
    const db = dbWithOutbox();
    const first = enqueueOkleykaJob(db, { lineItemId: 'li-a', text: 'a', fileUrls: [], force: false });
    enqueueOkleykaJob(db, { lineItemId: 'li-b', text: 'b', fileUrls: [], force: false });
    completeOkleykaJob(db, first.id);
    // re-open first as pending in the future via retry helper in later task — for now:
    db.prepare(
      `INSERT INTO telegram_okleyka_outbox (line_item_id, text, status, next_attempt_at)
       VALUES ('li-c', 'c', 'pending', datetime('now', '+1 hour'))`,
    ).run();
    const next = claimNextOkleykaJob(db);
    expect(next.line_item_id).toBe('li-b');
  });

  it('getOkleykaJobForLineItem returns open job first', () => {
    const db = dbWithOutbox();
    enqueueOkleykaJob(db, { lineItemId: 'li-1', text: 'open', fileUrls: [], force: false });
    const row = getOkleykaJobForLineItem(db, 'li-1');
    expect(row.status).toBe('pending');
    expect(row.text).toBe('open');
  });

  it('getOkleykaJobForLineItem returns latest when no open job', () => {
    const db = dbWithOutbox();
    const first = enqueueOkleykaJob(db, { lineItemId: 'li-1', text: 'first', fileUrls: [], force: false });
    completeOkleykaJob(db, first.id);
    enqueueOkleykaJob(db, { lineItemId: 'li-1', text: 'second', fileUrls: [], force: false });
    const second = getOpenOkleykaJob(db, 'li-1');
    completeOkleykaJob(db, second.id);
    const row = getOkleykaJobForLineItem(db, 'li-1');
    expect(row.text).toBe('second');
    expect(row.status).toBe('sent');
  });

  it('failOkleykaJob marks job failed with error', () => {
    const db = dbWithOutbox();
    const job = enqueueOkleykaJob(db, { lineItemId: 'li-1', text: 'a', fileUrls: [], force: false });
    claimNextOkleykaJob(db);
    failOkleykaJob(db, job.id, 'network error');
    const row = getOkleykaJobForLineItem(db, 'li-1');
    expect(row.status).toBe('failed');
    expect(row.error).toBe('network error');
    expect(row.sending_started_at).toBeNull();
  });

  it('retryOkleykaJob requeues with delay and increments attempt_count', () => {
    const db = dbWithOutbox();
    const job = enqueueOkleykaJob(db, { lineItemId: 'li-1', text: 'a', fileUrls: [], force: false });
    claimNextOkleykaJob(db);
    failOkleykaJob(db, job.id, 'old error');
    retryOkleykaJob(db, job.id, { error: 'retry me', delaySeconds: 3600 });
    const row = getOkleykaJobForLineItem(db, 'li-1');
    expect(row.status).toBe('pending');
    expect(row.error).toBe('retry me');
    expect(row.attempt_count).toBe(1);
    expect(row.sending_started_at).toBeNull();
    expect(claimNextOkleykaJob(db)).toBeUndefined();
  });
});
