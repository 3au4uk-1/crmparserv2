function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    requestNumber: row.request_number,
    twentyId: row.twenty_id,
    chatId: row.chat_id,
    threadId: row.thread_id,
    sourceMessageId: row.source_message_id,
    botMessageId: row.bot_message_id,
    mediaGroupId: row.media_group_id,
    requesterUserId: row.requester_user_id,
    requesterUsername: row.requester_username,
    requesterName: row.requester_name,
    lastPublishedText: row.last_published_text,
    createdAt: row.created_at,
  };
}

export function allocateRequestNumber(db) {
  const row = db
    .prepare(`SELECT MAX(request_number) AS max_num FROM telegram_work_requests`)
    .get();
  const maxNum = row?.max_num;
  return maxNum != null ? maxNum + 1 : 1;
}

export function insertWorkRequestLink(db, row) {
  const chatId = String(row.chatId ?? '').trim();
  const sourceMessageId = Number(row.sourceMessageId);

  const existing = db
    .prepare(
      `SELECT * FROM telegram_work_requests
       WHERE chat_id = ? AND source_message_id = ?`,
    )
    .get(chatId, sourceMessageId);
  if (existing) return mapRow(existing);

  const requestNumber = allocateRequestNumber(db);
  const info = db
    .prepare(
      `INSERT INTO telegram_work_requests
        (request_number, chat_id, thread_id, source_message_id,
         media_group_id, requester_user_id, requester_username, requester_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      requestNumber,
      chatId,
      Number(row.threadId),
      sourceMessageId,
      row.mediaGroupId ?? null,
      row.requesterUserId ?? null,
      row.requesterUsername ?? null,
      row.requesterName ?? null,
    );

  return mapRow(
    db.prepare(`SELECT * FROM telegram_work_requests WHERE id = ?`).get(info.lastInsertRowid),
  );
}

export function deleteWorkRequestLink(db, id) {
  const info = db
    .prepare(
      `DELETE FROM telegram_work_requests
       WHERE id = ? AND twenty_id IS NULL`,
    )
    .run(id);
  return info.changes > 0;
}

export function getWorkRequestLinkByTwentyId(db, twentyId) {
  return mapRow(
    db.prepare(`SELECT * FROM telegram_work_requests WHERE twenty_id = ?`).get(twentyId),
  );
}

export function getWorkRequestLinkByAlbum(db, chatId, mediaGroupId) {
  const groupId = String(mediaGroupId ?? '').trim();
  if (!groupId) return null;
  return mapRow(
    db
      .prepare(
        `SELECT * FROM telegram_work_requests
         WHERE chat_id = ? AND media_group_id = ?
           AND media_group_id IS NOT NULL AND media_group_id != ''`,
      )
      .get(String(chatId ?? '').trim(), groupId),
  );
}

export function updateWorkRequestLink(db, id, patch = {}) {
  const sets = [];
  const values = [];

  if (patch.botMessageId !== undefined) {
    sets.push('bot_message_id = ?');
    values.push(patch.botMessageId ?? null);
  }
  if (patch.twentyId !== undefined) {
    sets.push('twenty_id = ?');
    values.push(patch.twentyId ?? null);
  }
  if (patch.lastPublishedText !== undefined) {
    sets.push('last_published_text = ?');
    values.push(patch.lastPublishedText ?? null);
  }

  if (sets.length === 0) {
    return mapRow(db.prepare(`SELECT * FROM telegram_work_requests WHERE id = ?`).get(id));
  }

  values.push(id);
  db.prepare(
    `UPDATE telegram_work_requests SET ${sets.join(', ')} WHERE id = ?`,
  ).run(...values);

  return mapRow(db.prepare(`SELECT * FROM telegram_work_requests WHERE id = ?`).get(id));
}
