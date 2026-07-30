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

export function mergeChatMapEntry(existing, incoming) {
  const result = { ...existing };
  for (const [key, raw] of Object.entries(incoming)) {
    if (key === 'okleyka.send') {
      const normalized = normalizeOkleykaDestination(raw);
      if (normalized) {
        const entry = { chatId: normalized.chatId };
        if (normalized.threadId != null) {
          entry.threadId = normalized.threadId;
        }
        result[key] = entry;
      }
    } else {
      result[key] = raw;
    }
  }
  return result;
}
