import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { config } from '../../config.js';
import { resolveSession } from './session-store.js';

/** @type {Promise<import('telegram').TelegramClient> | undefined} */
let clientPromise;

/**
 * @param {{ telegramApiId?: string | number, telegramApiHash?: string }} cfg
 */
export function isApiConfigured(cfg = config) {
  return Boolean(cfg.telegramApiId && cfg.telegramApiHash);
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {{ telegramApiId?: string | number, telegramApiHash?: string, telegramUserSession?: string }} [cfg]
 */
export function isUserbotConfigured(db, cfg = config) {
  return isApiConfigured(cfg) && Boolean(resolveSession(db, cfg.telegramUserSession));
}

/**
 * @param {import('better-sqlite3').Database} db
 */
export async function getUserbotClient(db) {
  if (!isUserbotConfigured(db)) {
    throw Object.assign(new Error('userbot not configured'), { status: 503 });
  }
  if (!clientPromise) {
    const sessionString = resolveSession(db);
    const session = new StringSession(sessionString);
    const client = new TelegramClient(
      session,
      Number(config.telegramApiId),
      config.telegramApiHash,
      { connectionRetries: 3 },
    );
    clientPromise = client.connect().then(() => client);
  }
  return clientPromise;
}

export function resetUserbotClient() {
  if (clientPromise) {
    clientPromise
      .then((client) => client.disconnect?.())
      .catch(() => {});
    clientPromise = undefined;
  }
}
