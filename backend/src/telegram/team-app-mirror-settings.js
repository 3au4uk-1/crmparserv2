/**
 * Team App chat mirror target: chat + forum topic. Disabled until both are set.
 * @returns {{ chatId: string, topicId: number | null }}
 */
export function getTeamAppMirrorSettings(db) {
  const row = db
    .prepare(`SELECT value FROM settings WHERE key = 'team_app_chat_mirror'`)
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
export function setTeamAppMirrorSettings(db, value = {}) {
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
    `INSERT OR REPLACE INTO settings (key, value) VALUES ('team_app_chat_mirror', ?)`,
  ).run(JSON.stringify({ chatId, topicId }));
  return { chatId, topicId };
}
