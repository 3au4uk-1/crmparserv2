import { config } from '../../config.js';

export const SETTINGS_KEY_USER_SESSION = 'telegram_user_session';

/**
 * @param {import('better-sqlite3').Database} db
 * @returns {string}
 */
export function getDbUserSession(db) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(SETTINGS_KEY_USER_SESSION);
  return (row?.value ?? '').trim();
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} session
 */
export function setDbUserSession(db, session) {
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(
    SETTINGS_KEY_USER_SESSION,
    session,
  );
}

/**
 * @param {import('better-sqlite3').Database} db
 */
export function clearDbUserSession(db) {
  db.prepare('DELETE FROM settings WHERE key = ?').run(SETTINGS_KEY_USER_SESSION);
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} [envSession]
 * @returns {string}
 */
export function resolveSession(db, envSession = config.telegramUserSession) {
  const dbSession = getDbUserSession(db);
  if (dbSession) {
    return dbSession;
  }
  return (envSession ?? '').trim();
}
