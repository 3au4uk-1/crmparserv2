import crypto from 'crypto';

export function hashOkleykaPayload(text, fileUrls) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ text: text ?? '', fileUrls: fileUrls ?? [] }))
    .digest('hex');
}

export function findLastSend(db, event, lineItemId) {
  return db
    .prepare(
      `SELECT * FROM telegram_send_log
       WHERE event = ? AND line_item_id = ?
       ORDER BY id DESC LIMIT 1`,
    )
    .get(event, lineItemId);
}

export function findSendForLoadDate(db, event, lineItemId, loadDate) {
  return db
    .prepare(
      `SELECT * FROM telegram_send_log
       WHERE event = ? AND line_item_id = ? AND load_date = ?
       ORDER BY id DESC LIMIT 1`,
    )
    .get(event, lineItemId, loadDate);
}

export function insertSendLog(db, {
  event,
  lineItemId,
  opportunityId,
  chatId,
  sentBy,
  payloadHash,
  telegramMessageIds,
  loadDate,
}) {
  const info = db
    .prepare(
      `INSERT INTO telegram_send_log
        (event, line_item_id, opportunity_id, chat_id, sent_by, payload_hash, telegram_message_ids, load_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      event,
      lineItemId,
      opportunityId ?? null,
      chatId ?? null,
      sentBy ?? null,
      payloadHash ?? null,
      JSON.stringify(telegramMessageIds ?? []),
      loadDate ?? null,
    );
  return Number(info.lastInsertRowid);
}
