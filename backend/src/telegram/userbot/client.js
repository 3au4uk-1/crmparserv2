import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { config } from '../../config.js';
import { getGramjsProxy } from '../proxy.js';
import { resolveSession } from './session-store.js';

/** @type {Promise<import('telegram').TelegramClient> | undefined} */
let clientPromise;

/** @type {Array<(client: import('telegram').TelegramClient) => void>} */
const readyHooks = [];

/**
 * Runs fn after every client connect, including re-creation after re-login.
 * @param {(client: import('telegram').TelegramClient) => void} fn
 */
export function onUserbotClientReady(fn) {
  readyHooks.push(fn);
}

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
      { connectionRetries: 3, ...(getGramjsProxy() ? { proxy: getGramjsProxy(), useWSS: false } : {}) },
    );
    clientPromise = client.connect().then(() => {
      for (const fn of readyHooks) {
        try {
          fn(client);
        } catch (err) {
          console.error('[telegram] userbot ready hook error:', err.message);
        }
      }
      return client;
    });
  }
  return clientPromise;
}

export function peekUserbotClientPromise() {
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
