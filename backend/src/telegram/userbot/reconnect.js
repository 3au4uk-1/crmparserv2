import {
  getUserbotClient as getUserbotClientDefault,
  peekUserbotClientPromise as peekUserbotClientPromiseDefault,
  resetUserbotClient as resetUserbotClientDefault,
} from './client.js';
import { kickOkleykaDrain as kickOkleykaDrainDefault } from '../okleyka-drain.js';

export const USERBOT_WATCHDOG_MS = 60_000;
export const USERBOT_GETME_TIMEOUT_MS = 10_000;

const RECONNECT_DELAYS_MS = [2_000, 5_000, 15_000, 45_000, 300_000];

/** @type {Promise<void> | undefined} */
let reconnectInFlight;
let reconnectDelayMs = RECONNECT_DELAYS_MS[0];
/** @type {ReturnType<typeof setInterval> | undefined} */
let watchdogTimer;

export function isAuthReconnectStop(err) {
  const msg = String(err?.message ?? err ?? '');
  return /AUTH_KEY_UNREGISTERED|SESSION_REVOKED|userbot not configured/i.test(msg);
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveDeps(deps = {}) {
  return {
    sleep: deps.sleep ?? defaultSleep,
    getUserbotClient: deps.getUserbotClient ?? getUserbotClientDefault,
    resetUserbotClient: deps.resetUserbotClient ?? resetUserbotClientDefault,
    kickOkleykaDrain: deps.kickOkleykaDrain ?? kickOkleykaDrainDefault,
    onReconnectStop: deps.onReconnectStop ?? (() => {}),
    peekUserbotClientPromise:
      deps.peekUserbotClientPromise ?? peekUserbotClientPromiseDefault,
  };
}

function nextReconnectDelay(current) {
  const idx = RECONNECT_DELAYS_MS.indexOf(current);
  if (idx < 0) return RECONNECT_DELAYS_MS[0];
  return RECONNECT_DELAYS_MS[Math.min(idx + 1, RECONNECT_DELAYS_MS.length - 1)];
}

/** Race `getMe` against a 10s timeout without leaving the loser unhandled. */
function getMeWithTimeout(client, sleep) {
  let settled = false;
  const getMePromise = Promise.resolve(client.getMe());
  const timeoutPromise = sleep(USERBOT_GETME_TIMEOUT_MS).then(() => {
    if (settled) return;
    throw new Error('TIMEOUT');
  });
  void getMePromise.catch(() => {});
  void timeoutPromise.catch(() => {});
  return Promise.race([getMePromise, timeoutPromise]).finally(() => {
    settled = true;
  });
}

async function runReconnectLoop(db, reason, deps) {
  try {
    for (;;) {
      await deps.sleep(reconnectDelayMs);
      try {
        await deps.getUserbotClient(db);
        console.log(`[telegram] userbot reconnected (${reason})`);
        reconnectDelayMs = RECONNECT_DELAYS_MS[0];
        void deps.kickOkleykaDrain(db).catch((err) => {
          console.error('[telegram] okleyka drain kick:', err.message);
        });
        return;
      } catch (err) {
        if (isAuthReconnectStop(err)) {
          const msg = String(err?.message ?? err ?? '');
          console.log(`[telegram] userbot reconnect stopped: ${msg}`);
          deps.onReconnectStop(err);
          return;
        }
        reconnectDelayMs = nextReconnectDelay(reconnectDelayMs);
      }
    }
  } finally {
    reconnectInFlight = undefined;
  }
}

export function scheduleUserbotReconnect(db, reason, deps = {}) {
  if (reconnectInFlight) return reconnectInFlight;
  const resolved = resolveDeps(deps);
  console.log(`[telegram] userbot reconnect scheduled (${reason})`);
  resolved.resetUserbotClient();
  reconnectInFlight = runReconnectLoop(db, reason, resolved);
  return reconnectInFlight;
}

async function watchdogTick(db, deps) {
  const existing = deps.peekUserbotClientPromise();
  if (!existing || reconnectInFlight) return;
  try {
    const client = await existing;
    await getMeWithTimeout(client, deps.sleep);
  } catch (err) {
    scheduleUserbotReconnect(db, err.message, deps);
  }
}

export function initUserbotWatchdog(db, deps = {}) {
  const resolved = resolveDeps(deps);
  if (watchdogTimer) clearInterval(watchdogTimer);
  watchdogTimer = setInterval(() => {
    void watchdogTick(db, resolved);
  }, USERBOT_WATCHDOG_MS);
}

export function __resetUserbotReconnectForTests() {
  reconnectInFlight = undefined;
  reconnectDelayMs = RECONNECT_DELAYS_MS[0];
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = undefined;
  }
}
