import { config } from '../config.js';
import { getDb } from '../db/connection.js';
import { getTelegramBotToken } from './settings.js';
import { callTelegram } from './api-client.js';
import { processTelegramUpdate } from './inbound.js';

const ALLOWED_UPDATES = ['message', 'channel_post', 'my_chat_member'];
const POLL_TIMEOUT_SEC = 30;
const NO_TOKEN_RETRY_MS = 15000;
const ERROR_RETRY_MS = 5000;

let running = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * One getUpdates iteration. Exported for tests.
 * @param {import('better-sqlite3').Database} db
 * @param {{ offset: number, webhookCleared: boolean }} state mutated in place
 */
export async function pollOnce(db, state, deps = {}) {
  const call = deps.callTelegram ?? callTelegram;
  const process = deps.processTelegramUpdate ?? processTelegramUpdate;

  const token = getTelegramBotToken(db);
  if (!token) {
    return { idle: true };
  }

  if (!state.webhookCleared) {
    // getUpdates conflicts with an active webhook; keep pending updates.
    await call(token, 'deleteWebhook', { drop_pending_updates: false });
    state.webhookCleared = true;
    console.log('[telegram] polling mode: webhook removed');
  }

  const updates = await call(token, 'getUpdates', {
    offset: state.offset,
    timeout: POLL_TIMEOUT_SEC,
    allowed_updates: ALLOWED_UPDATES,
  });

  for (const update of updates) {
    state.offset = update.update_id + 1;
    try {
      process(db, update);
    } catch (err) {
      console.error('[telegram] polling update error:', err.message);
    }
  }
  return { idle: false };
}

async function pollLoop() {
  const state = { offset: 0, webhookCleared: false };
  for (;;) {
    try {
      const result = await pollOnce(getDb(), state);
      if (result.idle) {
        await sleep(NO_TOKEN_RETRY_MS);
      }
    } catch (err) {
      console.error('[telegram] polling error:', err.message);
      await sleep(ERROR_RETRY_MS);
    }
  }
}

/** Start long polling when TELEGRAM_POLLING is enabled (webhook unreachable, e.g. blocked inbound). */
export function initTelegramPolling() {
  if (!config.telegramPolling) {
    return;
  }
  if (running) {
    return;
  }
  running = true;
  console.log('[telegram] long polling enabled (TELEGRAM_POLLING)');
  pollLoop();
}
