import { findLastSend } from './send-log.js';

export function enqueueOkleykaJob(db, input) {
  const { lineItemId, opportunityId, text, fileUrls, sentBy, force } = input;

  const open = db
    .prepare(
      `SELECT id, status FROM telegram_okleyka_outbox
       WHERE line_item_id = ? AND status IN ('pending', 'sending')
       LIMIT 1`,
    )
    .get(lineItemId);

  if (open) {
    if (open.status === 'sending') {
      return { id: open.id, status: open.status };
    }

    db.prepare(
      `UPDATE telegram_okleyka_outbox SET
         opportunity_id = ?,
         text = ?,
         file_urls_json = ?,
         sent_by = ?,
         force = ?,
         next_attempt_at = datetime('now'),
         updated_at = datetime('now')
       WHERE id = ?`,
    ).run(
      opportunityId ?? null,
      text,
      JSON.stringify(fileUrls ?? []),
      sentBy ?? null,
      force ? 1 : 0,
      open.id,
    );

    return { id: open.id, status: 'pending' };
  }

  const info = db
    .prepare(
      `INSERT INTO telegram_okleyka_outbox
         (line_item_id, opportunity_id, text, file_urls_json, sent_by, force, status, next_attempt_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', datetime('now'))`,
    )
    .run(
      lineItemId,
      opportunityId ?? null,
      text,
      JSON.stringify(fileUrls ?? []),
      sentBy ?? null,
      force ? 1 : 0,
    );

  return { id: Number(info.lastInsertRowid), status: 'pending' };
}

export function getOpenOkleykaJob(db, lineItemId) {
  return db
    .prepare(
      `SELECT * FROM telegram_okleyka_outbox
       WHERE line_item_id = ? AND status IN ('pending', 'sending')
       LIMIT 1`,
    )
    .get(lineItemId);
}

export function getOkleykaJobForLineItem(db, lineItemId) {
  const open = getOpenOkleykaJob(db, lineItemId);
  if (open) return open;

  return db
    .prepare(
      `SELECT * FROM telegram_okleyka_outbox
       WHERE line_item_id = ?
       ORDER BY id DESC
       LIMIT 1`,
    )
    .get(lineItemId);
}

export function getOkleykaJobStatus(db, lineItemId) {
  const row = getOkleykaJobForLineItem(db, lineItemId);
  const job = row
    ? {
        id: row.id,
        status: row.status,
        error: row.error ?? null,
        updatedAt: row.updated_at,
      }
    : null;

  const lastSend = findLastSend(db, 'okleyka.send', lineItemId);
  return {
    job,
    alreadySent: Boolean(lastSend),
    lastSentAt: lastSend?.created_at ?? null,
  };
}

export function claimNextOkleykaJob(db) {
  const row = db
    .prepare(
      `SELECT * FROM telegram_okleyka_outbox
       WHERE status = 'pending'
         AND (next_attempt_at IS NULL OR datetime(next_attempt_at) <= datetime('now'))
       ORDER BY id ASC
       LIMIT 1`,
    )
    .get();

  if (!row) return undefined;

  db.prepare(
    `UPDATE telegram_okleyka_outbox SET
       status = 'sending',
       sending_started_at = datetime('now'),
       updated_at = datetime('now')
     WHERE id = ?`,
  ).run(row.id);

  return db.prepare(`SELECT * FROM telegram_okleyka_outbox WHERE id = ?`).get(row.id);
}

export function completeOkleykaJob(db, id, { warning } = {}) {
  db.prepare(
    `UPDATE telegram_okleyka_outbox SET
       status = 'sent',
       sending_started_at = NULL,
       error = COALESCE(?, error),
       updated_at = datetime('now')
     WHERE id = ?`,
  ).run(warning ?? null, id);
}

export function failOkleykaJob(db, id, error) {
  db.prepare(
    `UPDATE telegram_okleyka_outbox SET
       status = 'failed',
       error = ?,
       sending_started_at = NULL,
       updated_at = datetime('now')
     WHERE id = ?`,
  ).run(error ?? null, id);
}

export function retryOkleykaJob(db, id, { error, delaySeconds }) {
  db.prepare(
    `UPDATE telegram_okleyka_outbox SET
       status = 'pending',
       error = ?,
       attempt_count = attempt_count + 1,
       next_attempt_at = datetime('now', '+' || ? || ' seconds'),
       sending_started_at = NULL,
       updated_at = datetime('now')
     WHERE id = ?`,
  ).run(error ?? null, delaySeconds, id);
}

export function recoverStaleOkleykaSending(db, { olderThanSeconds = 120 } = {}) {
  const info = db
    .prepare(
      `UPDATE telegram_okleyka_outbox SET
         status = 'pending',
         sending_started_at = NULL,
         updated_at = datetime('now')
       WHERE status = 'sending'
         AND datetime(sending_started_at) <= datetime('now', '-' || ? || ' seconds')`,
    )
    .run(olderThanSeconds);

  return info.changes;
}
