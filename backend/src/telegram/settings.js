export function getTelegramBotToken(db) {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'telegram_bot_token'`).get();
  return (row?.value ?? '').trim();
}

export function getTelegramChatId(db, event) {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'telegram_chat_map'`).get();
  if (!row?.value) return '';
  try {
    const map = JSON.parse(row.value);
    return String(map?.[event] ?? '').trim();
  } catch {
    return '';
  }
}
