export function upsertTelegramChat(db, {
  chatId,
  title,
  type,
  isForum,
  username,
  active,
  source,
}) {
  db.prepare(`
    INSERT INTO telegram_chats
      (chat_id, title, type, is_forum, username, active, source, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(chat_id) DO UPDATE SET
      title = excluded.title,
      type = excluded.type,
      is_forum = excluded.is_forum,
      username = excluded.username,
      active = excluded.active,
      source = excluded.source,
      last_seen_at = datetime('now')
  `).run(
    chatId,
    title ?? '',
    type ?? '',
    isForum ? 1 : 0,
    username ?? null,
    active ? 1 : 0,
    source,
  );
}

export function upsertTelegramTopic(db, { chatId, threadId, name, source }) {
  db.prepare(`
    INSERT INTO telegram_topics
      (chat_id, thread_id, name, source, last_seen_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(chat_id, thread_id) DO UPDATE SET
      name = CASE
        WHEN excluded.name IS NOT NULL AND excluded.name != '' THEN excluded.name
        ELSE telegram_topics.name
      END,
      source = excluded.source,
      last_seen_at = datetime('now')
  `).run(chatId, threadId, name ?? null, source);
}

export function listTelegramChats(db, { activeOnly = true } = {}) {
  if (activeOnly) {
    return db.prepare(
      `SELECT * FROM telegram_chats WHERE active = 1`,
    ).all();
  }
  return db.prepare(`SELECT * FROM telegram_chats`).all();
}

export function listTelegramTopics(db, chatId) {
  return db.prepare(
    `SELECT * FROM telegram_topics WHERE chat_id = ?`,
  ).all(chatId);
}

export function upsertBotChat(db, {
  chatId,
  title,
  type,
  isForum,
  username,
  active,
  source = 'bot',
}) {
  db.prepare(`
    INSERT INTO telegram_bot_chats
      (chat_id, title, type, is_forum, username, active, source, last_seen_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(chat_id) DO UPDATE SET
      title = excluded.title,
      type = excluded.type,
      is_forum = excluded.is_forum,
      username = excluded.username,
      active = excluded.active,
      source = excluded.source,
      last_seen_at = datetime('now')
  `).run(
    chatId,
    title ?? '',
    type ?? '',
    isForum ? 1 : 0,
    username ?? null,
    active ? 1 : 0,
    source,
  );
}

export function upsertBotTopic(db, { chatId, threadId, name, source = 'bot' }) {
  db.prepare(`
    INSERT INTO telegram_bot_topics
      (chat_id, thread_id, name, source, last_seen_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(chat_id, thread_id) DO UPDATE SET
      name = CASE
        WHEN excluded.name IS NOT NULL AND excluded.name != '' THEN excluded.name
        ELSE telegram_bot_topics.name
      END,
      source = excluded.source,
      last_seen_at = datetime('now')
  `).run(chatId, threadId, name ?? null, source);
}

export function listBotChats(db, { activeOnly = true } = {}) {
  if (activeOnly) {
    return db.prepare(`SELECT * FROM telegram_bot_chats WHERE active = 1`).all();
  }
  return db.prepare(`SELECT * FROM telegram_bot_chats`).all();
}

export function listBotTopics(db, chatId) {
  return db.prepare(`SELECT * FROM telegram_bot_topics WHERE chat_id = ?`).all(chatId);
}
