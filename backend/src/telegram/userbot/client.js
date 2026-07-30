import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { config } from '../../config.js';

/** @type {Promise<import('telegram').TelegramClient> | undefined} */
let clientPromise;

/**
 * @param {{ telegramApiId?: string | number, telegramApiHash?: string, telegramUserSession?: string }} cfg
 */
export function isUserbotConfigured(cfg = config) {
  return Boolean(cfg.telegramApiId && cfg.telegramApiHash && cfg.telegramUserSession);
}

export async function getUserbotClient() {
  if (!isUserbotConfigured()) {
    throw Object.assign(new Error('userbot not configured'), { status: 503 });
  }
  if (!clientPromise) {
    const session = new StringSession(config.telegramUserSession);
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
