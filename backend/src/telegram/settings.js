export function getTelegramBotToken(db) {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'telegram_bot_token'`).get();
  return (row?.value ?? '').trim();
}

export function normalizeOkleykaDestination(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'string') {
    const chatId = raw.trim();
    return chatId ? { chatId, threadId: null } : null;
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const chatId = String(raw.chatId ?? '').trim();
    if (!chatId) return null;
    let threadId = null;
    if (raw.threadId != null && raw.threadId !== '') {
      const n = Number(raw.threadId);
      if (Number.isInteger(n) && n > 0) threadId = n;
    }
    return { chatId, threadId };
  }
  return null;
}

export function getTelegramDestination(db, event) {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'telegram_chat_map'`).get();
  if (!row?.value) return null;
  try {
    const map = JSON.parse(row.value);
    return normalizeOkleykaDestination(map?.[event]);
  } catch {
    return null;
  }
}

export function getTelegramChatId(db, event) {
  return getTelegramDestination(db, event)?.chatId ?? '';
}

/**
 * Mention forwarding target: chat + forum topic. Disabled until both are set.
 * @returns {{ chatId: string, topicId: number | null }}
 */
export function getMentionForwardSettings(db) {
  const row = db
    .prepare(`SELECT value FROM settings WHERE key = 'telegram_mention_forward'`)
    .get();
  if (!row?.value) return { chatId: '', topicId: null };
  try {
    const parsed = JSON.parse(row.value);
    const chatId = String(parsed?.chatId ?? '').trim();
    let topicId = null;
    if (parsed?.topicId != null && parsed.topicId !== '') {
      const n = Number(parsed.topicId);
      if (Number.isInteger(n) && n > 0) topicId = n;
    }
    return { chatId, topicId };
  } catch {
    return { chatId: '', topicId: null };
  }
}

/** @param {{ chatId?: string, topicId?: number | string | null }} value */
export function setMentionForwardSettings(db, value = {}) {
  const chatId = String(value.chatId ?? '').trim();
  let topicId = null;
  if (value.topicId != null && value.topicId !== '') {
    const n = Number(value.topicId);
    if (!Number.isInteger(n) || n <= 0) {
      throw Object.assign(new Error('topicId must be a positive integer'), { status: 400 });
    }
    topicId = n;
  }
  db.prepare(
    `INSERT OR REPLACE INTO settings (key, value) VALUES ('telegram_mention_forward', ?)`,
  ).run(JSON.stringify({ chatId, topicId }));
  return { chatId, topicId };
}

const CHAT_DESTINATION_KEYS = new Set(['okleyka.send', 'digest.morning']);

function applyDestinationPatch(result, key, raw) {
  if (raw == null || raw === '') {
    result[key] = '';
    return;
  }
  const normalized = normalizeOkleykaDestination(raw);
  if (normalized) {
    const entry = { chatId: normalized.chatId };
    if (normalized.threadId != null) {
      entry.threadId = normalized.threadId;
    }
    result[key] = entry;
  }
}

export function mergeChatMapEntry(existing, incoming) {
  const result = { ...existing };
  for (const [key, raw] of Object.entries(incoming)) {
    if (CHAT_DESTINATION_KEYS.has(key)) {
      applyDestinationPatch(result, key, raw);
    } else {
      result[key] = raw;
    }
  }
  return result;
}
