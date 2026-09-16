import { afterEach, describe, expect, it, vi } from 'vitest';
import { peekUserbotClientPromise } from '../src/telegram/userbot/client.js';
import {
  USERBOT_GETME_TIMEOUT_MS,
  USERBOT_WATCHDOG_MS,
  __resetUserbotReconnectForTests,
  initUserbotWatchdog,
  isAuthReconnectStop,
  scheduleUserbotReconnect,
} from '../src/telegram/userbot/reconnect.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeReconnectDeps(overrides = {}) {
  return {
    sleep,
    getUserbotClient: vi.fn(async () => ({ id: 'client' })),
    resetUserbotClient: vi.fn(),
    kickOkleykaDrain: vi.fn(async () => {}),
    onReconnectStop: vi.fn(),
    peekUserbotClientPromise: vi.fn(() => undefined),
    ...overrides,
  };
}

describe('userbot reconnect', () => {
  afterEach(() => {
    __resetUserbotReconnectForTests();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('peekUserbotClientPromise returns undefined without connecting', () => {
    expect(peekUserbotClientPromise()).toBeUndefined();
  });

  it('isAuthReconnectStop matches auth/session errors', () => {
    expect(isAuthReconnectStop(new Error('AUTH_KEY_UNREGISTERED'))).toBe(true);
    expect(isAuthReconnectStop(new Error('SESSION_REVOKED'))).toBe(true);
    expect(isAuthReconnectStop(new Error('userbot not configured'))).toBe(true);
    expect(isAuthReconnectStop(new Error('TIMEOUT'))).toBe(false);
  });

  it('reconnects once, kicks drain, runs getUserbotClient after reset', async () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const db = { name: 'db' };
    const order = [];
    const deps = makeReconnectDeps({
      resetUserbotClient: vi.fn(() => {
        order.push('reset');
      }),
      getUserbotClient: vi.fn(async () => {
        order.push('get');
        return { id: 'client' };
      }),
      kickOkleykaDrain: vi.fn(async () => {
        order.push('drain');
      }),
    });

    const done = scheduleUserbotReconnect(db, 'TIMEOUT', deps);

    expect(deps.resetUserbotClient).toHaveBeenCalledTimes(1);
    expect(deps.getUserbotClient).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('[telegram] userbot reconnect scheduled (TIMEOUT)');

    await vi.advanceTimersByTimeAsync(2000);
    await done;

    expect(deps.getUserbotClient).toHaveBeenCalledTimes(1);
    expect(deps.getUserbotClient).toHaveBeenCalledWith(db);
    expect(deps.kickOkleykaDrain).toHaveBeenCalledTimes(1);
    expect(deps.kickOkleykaDrain).toHaveBeenCalledWith(db);
    expect(order).toEqual(['reset', 'get', 'drain']);
    expect(log).toHaveBeenCalledWith('[telegram] userbot reconnected (TIMEOUT)');
  });

  it('reconnect success swallows kickOkleykaDrain rejection', async () => {
    vi.useFakeTimers();
    const unhandled = [];
    const onUnhandled = (reason) => {
      unhandled.push(reason);
    };
    process.prependListener('unhandledRejection', onUnhandled);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const deps = makeReconnectDeps({
        kickOkleykaDrain: vi.fn(() => Promise.reject(new Error('drain failed'))),
      });
      const done = scheduleUserbotReconnect({ name: 'db' }, 'TIMEOUT', deps);

      await vi.advanceTimersByTimeAsync(2000);
      await done;
      await Promise.resolve();

      expect(deps.kickOkleykaDrain).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledWith(
        '[telegram] okleyka drain kick:',
        'drain failed',
      );
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('second scheduleUserbotReconnect is a no-op while in flight', async () => {
    vi.useFakeTimers();
    let release;
    const getUserbotClient = vi.fn(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const deps = makeReconnectDeps({ getUserbotClient });
    const db = { name: 'db' };

    const first = scheduleUserbotReconnect(db, 'TIMEOUT', deps);
    scheduleUserbotReconnect(db, 'disconnected', deps);

    expect(deps.resetUserbotClient).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2000);
    expect(getUserbotClient).toHaveBeenCalledTimes(1);

    scheduleUserbotReconnect(db, 'again', deps);
    expect(deps.resetUserbotClient).toHaveBeenCalledTimes(1);
    expect(getUserbotClient).toHaveBeenCalledTimes(1);

    release({ id: 'client' });
    await first;

    expect(deps.kickOkleykaDrain).toHaveBeenCalledTimes(1);
    expect(getUserbotClient).toHaveBeenCalledTimes(1);
  });

  it('stops on AUTH_KEY_UNREGISTERED', async () => {
    vi.useFakeTimers();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const deps = makeReconnectDeps({
      getUserbotClient: vi.fn(async () => {
        throw new Error('AUTH_KEY_UNREGISTERED');
      }),
    });

    const done = scheduleUserbotReconnect({}, 'TIMEOUT', deps);
    await vi.advanceTimersByTimeAsync(2000);
    await done;

    expect(deps.getUserbotClient).toHaveBeenCalledTimes(1);
    expect(deps.kickOkleykaDrain).not.toHaveBeenCalled();
    expect(deps.onReconnectStop).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(
      '[telegram] userbot reconnect stopped: AUTH_KEY_UNREGISTERED',
    );

    await vi.advanceTimersByTimeAsync(5000);
    expect(deps.getUserbotClient).toHaveBeenCalledTimes(1);
  });

  it('watchdog skips when peekUserbotClientPromise is empty', async () => {
    vi.useFakeTimers();
    const deps = makeReconnectDeps({
      peekUserbotClientPromise: vi.fn(() => undefined),
      getUserbotClient: vi.fn(),
    });

    initUserbotWatchdog({ name: 'db' }, deps);
    await vi.advanceTimersByTimeAsync(USERBOT_WATCHDOG_MS);

    expect(deps.peekUserbotClientPromise).toHaveBeenCalled();
    expect(deps.getUserbotClient).not.toHaveBeenCalled();
    expect(deps.resetUserbotClient).not.toHaveBeenCalled();
  });

  it('watchdog schedules reconnect when getMe times out', async () => {
    vi.useFakeTimers();
    const getMe = vi.fn(() => new Promise(() => {}));
    const deps = makeReconnectDeps({
      peekUserbotClientPromise: vi.fn(() => Promise.resolve({ getMe })),
    });
    const db = { name: 'db' };

    initUserbotWatchdog(db, deps);

    await vi.advanceTimersByTimeAsync(USERBOT_WATCHDOG_MS);
    expect(deps.resetUserbotClient).not.toHaveBeenCalled();
    expect(getMe).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(USERBOT_GETME_TIMEOUT_MS);
    expect(deps.resetUserbotClient).toHaveBeenCalledTimes(1);
    expect(deps.getUserbotClient).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2000);
    expect(deps.getUserbotClient).toHaveBeenCalledTimes(1);
    expect(deps.getUserbotClient).toHaveBeenCalledWith(db);
    expect(deps.kickOkleykaDrain).toHaveBeenCalledWith(db);
  });

  it('healthy watchdog getMe does not leave unhandled TIMEOUT after 10s', async () => {
    vi.useFakeTimers();
    const unhandled = [];
    const onUnhandled = (reason) => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);

    try {
      const getMe = vi.fn(async () => ({ id: 'me' }));
      const deps = makeReconnectDeps({
        peekUserbotClientPromise: vi.fn(() => Promise.resolve({ getMe })),
      });

      initUserbotWatchdog({ name: 'db' }, deps);
      await vi.advanceTimersByTimeAsync(USERBOT_WATCHDOG_MS);

      expect(getMe).toHaveBeenCalledTimes(1);
      expect(deps.resetUserbotClient).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(USERBOT_GETME_TIMEOUT_MS);
      await Promise.resolve();

      expect(unhandled).toEqual([]);
      expect(deps.resetUserbotClient).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
