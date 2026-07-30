import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import {
  getAuthStatus,
  startLogin,
  submitCode,
  submitPassword,
  cancelLogin,
  logout,
} from '../src/telegram/userbot/auth-login.js';
import { getDbUserSession, setDbUserSession } from '../src/telegram/userbot/session-store.js';
import { resetUserbotClient } from '../src/telegram/userbot/client.js';

function memDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  return db;
}

const cfg = { telegramApiId: '123', telegramApiHash: 'hash', telegramUserSession: '' };

function fakeApi(overrides = {}) {
  let handleCounter = 0;
  return {
    sendCode: vi.fn(async () => ({
      phoneCodeHash: 'hash123',
      clientHandle: `handle-${++handleCounter}`,
    })),
    signIn: vi.fn(async () => ({ session: 'saved-session' })),
    checkPassword: vi.fn(async () => ({ session: 'saved-session-2fa' })),
    disconnect: vi.fn(async () => {}),
    ...overrides,
  };
}

function deps(api, extra = {}) {
  return { cfg, telegramAuthApi: api, ...extra };
}

describe('auth-login', () => {
  let db;

  beforeEach(() => {
    db = memDb();
    cancelLogin();
    resetUserbotClient();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cancelLogin();
    vi.useRealTimers();
  });

  it('start → code success', async () => {
    const api = fakeApi();
    const result = await startLogin(db, '+79001234567', deps(api));
    expect(result).toEqual({ pending: 'code' });
    expect(api.sendCode).toHaveBeenCalledWith({
      apiId: '123',
      apiHash: 'hash',
      phone: '+79001234567',
    });

    expect(getAuthStatus(db, deps(api))).toMatchObject({
      apiConfigured: true,
      sessionSet: false,
      pending: 'code',
      user: null,
    });

    const codeResult = await submitCode(db, '12345', deps(api));
    expect(codeResult).toEqual({ pending: 'none', sessionSet: true });
    expect(getDbUserSession(db)).toBe('saved-session');
    expect(api.disconnect).toHaveBeenCalledWith('handle-1');
    expect(getAuthStatus(db, deps(api)).pending).toBeNull();
  });

  it('start → code → password', async () => {
    const api = fakeApi({
      signIn: vi.fn(async () => ({ needPassword: true })),
    });
    await startLogin(db, '+79001234567', deps(api));

    const codeResult = await submitCode(db, '12345', deps(api));
    expect(codeResult).toEqual({ pending: 'password', sessionSet: false });
    expect(getAuthStatus(db, deps(api)).pending).toBe('password');

    const pwResult = await submitPassword(db, 'secret', deps(api));
    expect(pwResult).toEqual({ pending: 'none', sessionSet: true });
    expect(getDbUserSession(db)).toBe('saved-session-2fa');
    expect(api.checkPassword).toHaveBeenCalledWith({
      clientHandle: 'handle-1',
      password: 'secret',
    });
  });

  it('cancel clears pending and disconnects', async () => {
    const api = fakeApi();
    await startLogin(db, '+79001234567', deps(api));
    cancelLogin();
    expect(getAuthStatus(db, deps(api)).pending).toBeNull();
    expect(api.disconnect).toHaveBeenCalledWith('handle-1');
  });

  it('second startLogin cancels previous pending', async () => {
    const api = fakeApi();
    await startLogin(db, '+79001111111', deps(api));
    await startLogin(db, '+79002222222', deps(api));
    expect(api.disconnect).toHaveBeenCalledWith('handle-1');
    expect(api.sendCode).toHaveBeenLastCalledWith(
      expect.objectContaining({ phone: '+79002222222' }),
    );
  });

  it('rejects start without api', async () => {
    const api = fakeApi();
    await expect(
      startLogin(db, '+79001234567', deps(api, {
        cfg: { telegramApiId: '', telegramApiHash: '', telegramUserSession: '' },
      })),
    ).rejects.toMatchObject({ status: 503 });
  });

  it('rejects empty phone', async () => {
    const api = fakeApi();
    await expect(startLogin(db, '  ', deps(api))).rejects.toMatchObject({ status: 400 });
  });

  it('rejects submitCode without pending', async () => {
    const api = fakeApi();
    await expect(submitCode(db, '12345', deps(api))).rejects.toMatchObject({ status: 400 });
  });

  it('rejects expired pending', async () => {
    const api = fakeApi();
    await startLogin(db, '+79001234567', deps(api));
    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    await expect(submitCode(db, '12345', deps(api))).rejects.toMatchObject({ status: 400 });
    expect(getAuthStatus(db, deps(api)).pending).toBeNull();
    expect(api.disconnect).toHaveBeenCalledWith('handle-1');
  });

  it('logout clears DB session and pending', async () => {
    setDbUserSession(db, 'old-session');
    const api = fakeApi();
    await startLogin(db, '+79001234567', deps(api));
    logout(db);
    expect(getDbUserSession(db)).toBe('');
    expect(getAuthStatus(db, deps(api)).pending).toBeNull();
    expect(api.disconnect).toHaveBeenCalled();
  });
});
