import { config } from '../../config.js';
import { isApiConfigured, resetUserbotClient } from './client.js';
import { resolveSession, setDbUserSession, clearDbUserSession } from './session-store.js';
import { createGramJsAuthApi } from './auth-gramjs.js';

/** @typedef {{ sendCode: Function, signIn: Function, checkPassword: Function, disconnect: Function }} TelegramAuthApi */

const PENDING_TTL_MS = 10 * 60 * 1000;

/**
 * @typedef {object} PendingLogin
 * @property {unknown} clientHandle
 * @property {string} phone
 * @property {string} phoneCodeHash
 * @property {'code' | 'password'} step
 * @property {number} expiresAt
 * @property {TelegramAuthApi} telegramAuthApi
 */

/** @type {PendingLogin | null} */
let pending = null;

/**
 * @param {string} message
 * @param {number} status
 */
function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}

/**
 * @param {object} [deps]
 * @param {object} [deps.cfg]
 * @param {TelegramAuthApi} [deps.telegramAuthApi]
 * @param {Function} [deps.fetchUser]
 */
function resolveDeps(deps = {}) {
  return {
    cfg: deps.cfg ?? config,
    telegramAuthApi: deps.telegramAuthApi ?? createGramJsAuthApi(),
    fetchUser: deps.fetchUser ?? null,
  };
}

/**
 * @param {TelegramAuthApi} telegramAuthApi
 */
async function clearPending(telegramAuthApi) {
  if (!pending) {
    return;
  }
  const api = pending.telegramAuthApi ?? telegramAuthApi;
  const handle = pending.clientHandle;
  pending = null;
  if (handle) {
    try {
      await api.disconnect(handle);
    } catch {
      // best-effort
    }
  }
}

/**
 * @param {TelegramAuthApi} telegramAuthApi
 * @returns {'code' | 'password' | null}
 */
function getPendingStep(telegramAuthApi) {
  if (!pending) {
    return null;
  }
  if (Date.now() > pending.expiresAt) {
    const api = pending.telegramAuthApi ?? telegramAuthApi;
    const handle = pending.clientHandle;
    pending = null;
    api.disconnect(handle).catch(() => {});
    return null;
  }
  return pending.step;
}

/**
 * @param {'code' | 'password'} expectedStep
 * @param {TelegramAuthApi} telegramAuthApi
 */
async function assertPendingStep(expectedStep, telegramAuthApi) {
  if (!pending) {
    throw httpError('No pending login', 400);
  }
  if (Date.now() > pending.expiresAt) {
    await clearPending(pending.telegramAuthApi ?? telegramAuthApi);
    throw httpError('Login session expired', 400);
  }
  if (pending.step !== expectedStep) {
    throw httpError('Invalid login step', 400);
  }
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} session
 * @param {object} [deps]
 */
async function finishLogin(db, session, deps) {
  const { telegramAuthApi } = resolveDeps(deps);
  setDbUserSession(db, session);
  resetUserbotClient();
  await clearPending(telegramAuthApi);
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {object} [deps]
 */
export function getAuthStatus(db, deps) {
  const { cfg } = resolveDeps(deps);
  const sessionStr = resolveSession(db, cfg.telegramUserSession);
  const { telegramAuthApi } = resolveDeps(deps);

  return {
    apiConfigured: isApiConfigured(cfg),
    sessionSet: Boolean(sessionStr),
    pending: getPendingStep(telegramAuthApi),
    user: null,
  };
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} phone
 * @param {object} [deps]
 */
export async function startLogin(db, phone, deps) {
  const resolved = resolveDeps(deps);
  const { cfg, telegramAuthApi } = resolved;

  if (!isApiConfigured(cfg)) {
    throw httpError('Telegram API not configured', 503);
  }

  const trimmedPhone = (phone ?? '').trim();
  if (!trimmedPhone) {
    throw httpError('Phone number required', 400);
  }

  if (pending) {
    await clearPending(pending.telegramAuthApi ?? telegramAuthApi);
  }

  const { phoneCodeHash, clientHandle } = await telegramAuthApi.sendCode({
    apiId: cfg.telegramApiId,
    apiHash: cfg.telegramApiHash,
    phone: trimmedPhone,
  });

  pending = {
    clientHandle,
    phone: trimmedPhone,
    phoneCodeHash,
    step: 'code',
    expiresAt: Date.now() + PENDING_TTL_MS,
    telegramAuthApi,
  };

  return { pending: 'code' };
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} code
 * @param {object} [deps]
 */
export async function submitCode(db, code, deps) {
  const { telegramAuthApi } = resolveDeps(deps);
  await assertPendingStep('code', telegramAuthApi);

  const trimmedCode = (code ?? '').trim();
  if (!trimmedCode) {
    throw httpError('Code required', 400);
  }

  const result = await telegramAuthApi.signIn({
    clientHandle: pending.clientHandle,
    phone: pending.phone,
    code: trimmedCode,
    phoneCodeHash: pending.phoneCodeHash,
  });

  if (result.needPassword) {
    pending.step = 'password';
    pending.expiresAt = Date.now() + PENDING_TTL_MS;
    return { pending: 'password', sessionSet: false };
  }

  await finishLogin(db, result.session, deps);
  return { pending: 'none', sessionSet: true };
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} password
 * @param {object} [deps]
 */
export async function submitPassword(db, password, deps) {
  const { telegramAuthApi } = resolveDeps(deps);
  await assertPendingStep('password', telegramAuthApi);

  const trimmedPassword = (password ?? '').trim();
  if (!trimmedPassword) {
    throw httpError('Password required', 400);
  }

  const result = await telegramAuthApi.checkPassword({
    clientHandle: pending.clientHandle,
    password: trimmedPassword,
  });

  await finishLogin(db, result.session, deps);
  return { pending: 'none', sessionSet: true };
}

export function cancelLogin() {
  if (!pending) {
    return;
  }
  const api = pending.telegramAuthApi ?? createGramJsAuthApi();
  const handle = pending.clientHandle;
  pending = null;
  api.disconnect(handle).catch(() => {});
}

/**
 * @param {import('better-sqlite3').Database} db
 */
export function logout(db) {
  clearDbUserSession(db);
  resetUserbotClient();
  cancelLogin();
}
