import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate } from '../src/db/migrate.js';
import {
  enqueueOkleykaJob,
  getOkleykaJobForLineItem,
  claimNextOkleykaJob,
} from '../src/telegram/okleyka-outbox.js';
import {
  kickOkleykaDrain,
  runOkleykaDrain,
  __resetOkleykaDrainForTests,
} from '../src/telegram/okleyka-drain.js';

function dbWithOutbox() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)`);
  migrate(db);
  return db;
}

function enqueueSample(db, overrides = {}) {
  return enqueueOkleykaJob(db, {
    lineItemId: 'li-1',
    opportunityId: 'opp-1',
    text: 'Заказ: t',
    fileUrls: ['https://cdn.example.com/a.jpg'],
    sentBy: 'Ann',
    force: false,
    ...overrides,
  });
}

function makeDeps(overrides = {}) {
  return {
    getUserbotClient: vi.fn(async () => ({ id: 'client' })),
    isUserbotConfigured: () => true,
    sendOkleykaToTelegram: vi.fn(async () => ({ messageIds: [7] })),
    getTelegramDestination: vi.fn(() => ({ chatId: '-1001', threadId: 42 })),
    insertSendLog: vi.fn(),
    hashOkleykaPayload: vi.fn(() => 'hash-1'),
    findLastSend: vi.fn(() => undefined),
    patchOkleykaTelegramFields: vi.fn(async () => {}),
    createWrapOkleykaTask: vi.fn(async () => ({ id: 't1' })),
    scheduleUserbotReconnect: vi.fn(),
    now: () => '2026-09-14T13:00:00.000Z',
    ...overrides,
  };
}

function dueNow(db, id) {
  db.prepare(
    `UPDATE telegram_okleyka_outbox SET next_attempt_at = datetime('now', '-1 second') WHERE id = ?`,
  ).run(id);
}

describe('okleyka-drain', () => {
  beforeEach(() => {
    __resetOkleykaDrainForTests();
  });

  afterEach(() => {
    __resetOkleykaDrainForTests();
    vi.useRealTimers();
  });

  it('sends, logs, wraps, marks sent', async () => {
    const db = dbWithOutbox();
    const job = enqueueSample(db);
    const client = { id: 'client' };
    const deps = makeDeps({
      getUserbotClient: vi.fn(async () => client),
    });

    await runOkleykaDrain(db, deps);

    expect(deps.sendOkleykaToTelegram).toHaveBeenCalledWith({
      client,
      chatId: '-1001',
      threadId: 42,
      text: 'Заказ: t',
      fileUrls: ['https://cdn.example.com/a.jpg'],
    });
    expect(deps.hashOkleykaPayload).toHaveBeenCalledWith('Заказ: t', [
      'https://cdn.example.com/a.jpg',
    ]);
    expect(deps.insertSendLog).toHaveBeenCalledWith(db, {
      event: 'okleyka.send',
      lineItemId: 'li-1',
      opportunityId: 'opp-1',
      chatId: '-1001',
      sentBy: 'Ann',
      payloadHash: 'hash-1',
      telegramMessageIds: [7],
    });
    expect(deps.patchOkleykaTelegramFields).toHaveBeenCalledWith({
      lineItemId: 'li-1',
      sentAt: '2026-09-14T13:00:00.000Z',
      sentBy: 'Ann',
      chatId: '-1001',
    });
    expect(deps.createWrapOkleykaTask).toHaveBeenCalledWith({
      lineItemId: 'li-1',
      opportunityId: 'opp-1',
      text: 'Заказ: t',
      fileUrls: ['https://cdn.example.com/a.jpg'],
      force: false,
    });
    const row = getOkleykaJobForLineItem(db, 'li-1');
    expect(row.id).toBe(job.id);
    expect(row.status).toBe('sent');
  });

  it('does not call telegram when send_log exists and force is 0', async () => {
    const db = dbWithOutbox();
    enqueueSample(db, { force: false });
    const deps = makeDeps({
      findLastSend: vi.fn(() => ({ created_at: '2026-09-14T12:00:00.000Z' })),
    });

    await runOkleykaDrain(db, deps);

    expect(deps.sendOkleykaToTelegram).not.toHaveBeenCalled();
    expect(deps.insertSendLog).not.toHaveBeenCalled();
    expect(deps.createWrapOkleykaTask).not.toHaveBeenCalled();
    expect(getOkleykaJobForLineItem(db, 'li-1').status).toBe('sent');
  });

  it('on TIMEOUT retries pending and schedules reconnect', async () => {
    const db = dbWithOutbox();
    enqueueSample(db);
    const deps = makeDeps({
      sendOkleykaToTelegram: vi.fn(async () => {
        throw new Error('Error: TIMEOUT');
      }),
    });

    await runOkleykaDrain(db, deps);

    const row = getOkleykaJobForLineItem(db, 'li-1');
    expect(row.status).toBe('pending');
    expect(row.attempt_count).toBe(1);
    expect(row.error).toBe('Error: TIMEOUT');
    expect(deps.scheduleUserbotReconnect).toHaveBeenCalledWith(db, 'Error: TIMEOUT');
    expect(deps.insertSendLog).not.toHaveBeenCalled();
    expect(claimNextOkleykaJob(db)).toBeUndefined();
  });

  it('on missing destination marks failed', async () => {
    const db = dbWithOutbox();
    enqueueSample(db);
    const deps = makeDeps({
      getTelegramDestination: vi.fn(() => null),
    });

    await runOkleykaDrain(db, deps);

    const row = getOkleykaJobForLineItem(db, 'li-1');
    expect(row.status).toBe('failed');
    expect(deps.sendOkleykaToTelegram).not.toHaveBeenCalled();
  });

  it('on userbot not configured marks failed', async () => {
    const db = dbWithOutbox();
    enqueueSample(db);
    const deps = makeDeps({
      isUserbotConfigured: () => false,
    });

    await runOkleykaDrain(db, deps);

    const row = getOkleykaJobForLineItem(db, 'li-1');
    expect(row.status).toBe('failed');
    expect(row.error).toMatch(/userbot not configured/i);
    expect(deps.sendOkleykaToTelegram).not.toHaveBeenCalled();
    expect(deps.scheduleUserbotReconnect).not.toHaveBeenCalled();
  });

  it('keeps telegram success if wrap throws', async () => {
    const db = dbWithOutbox();
    enqueueSample(db);
    const deps = makeDeps({
      createWrapOkleykaTask: vi.fn(async () => {
        throw new Error('twenty down');
      }),
    });

    await runOkleykaDrain(db, deps);

    expect(deps.sendOkleykaToTelegram).toHaveBeenCalledOnce();
    expect(deps.insertSendLog).toHaveBeenCalledOnce();
    expect(getOkleykaJobForLineItem(db, 'li-1').status).toBe('sent');
  });

  it('treats download HTTP 4xx as transient until 3 attempts then fails', async () => {
    const db = dbWithOutbox();
    const job = enqueueSample(db);
    const deps = makeDeps({
      sendOkleykaToTelegram: vi.fn(async () => {
        throw new Error('download failed: HTTP 404');
      }),
    });

    await runOkleykaDrain(db, deps);
    let row = getOkleykaJobForLineItem(db, 'li-1');
    expect(row.status).toBe('pending');
    expect(row.attempt_count).toBe(1);
    expect(deps.scheduleUserbotReconnect).not.toHaveBeenCalled();

    dueNow(db, job.id);
    await runOkleykaDrain(db, deps);
    row = getOkleykaJobForLineItem(db, 'li-1');
    expect(row.status).toBe('pending');
    expect(row.attempt_count).toBe(2);

    dueNow(db, job.id);
    await runOkleykaDrain(db, deps);
    row = getOkleykaJobForLineItem(db, 'li-1');
    expect(row.status).toBe('failed');
    expect(row.error).toMatch(/download failed: HTTP 404/i);
    expect(deps.sendOkleykaToTelegram).toHaveBeenCalledTimes(3);
    expect(deps.scheduleUserbotReconnect).not.toHaveBeenCalled();
  });

  it('on download HTTP 5xx retries without scheduling reconnect', async () => {
    const db = dbWithOutbox();
    enqueueSample(db);
    const deps = makeDeps({
      sendOkleykaToTelegram: vi.fn(async () => {
        throw new Error('download failed: HTTP 502');
      }),
    });

    await runOkleykaDrain(db, deps);

    const row = getOkleykaJobForLineItem(db, 'li-1');
    expect(row.status).toBe('pending');
    expect(row.attempt_count).toBe(1);
    expect(deps.scheduleUserbotReconnect).not.toHaveBeenCalled();
    expect(claimNextOkleykaJob(db)).toBeUndefined();
  });

  it('kickOkleykaDrain is single-flight', async () => {
    const db = dbWithOutbox();
    enqueueSample(db, { lineItemId: 'li-a', text: 'a' });
    enqueueSample(db, { lineItemId: 'li-b', text: 'b' });

    let inFlight = 0;
    let maxInFlight = 0;
    const resolvers = [];
    const deps = makeDeps({
      sendOkleykaToTelegram: vi.fn(() => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        return new Promise((resolve) => {
          resolvers.push((value) => {
            inFlight -= 1;
            resolve(value);
          });
        });
      }),
    });

    const first = kickOkleykaDrain(db, deps);
    await vi.waitFor(() => expect(deps.sendOkleykaToTelegram).toHaveBeenCalledTimes(1));
    const second = kickOkleykaDrain(db, deps);
    await Promise.resolve();
    expect(deps.sendOkleykaToTelegram).toHaveBeenCalledTimes(1);
    expect(maxInFlight).toBe(1);

    resolvers[0]({ messageIds: [1] });
    await vi.waitFor(() => expect(deps.sendOkleykaToTelegram).toHaveBeenCalledTimes(2));
    resolvers[1]({ messageIds: [2] });
    await first;
    await second;
    expect(maxInFlight).toBe(1);
    expect(getOkleykaJobForLineItem(db, 'li-a').status).toBe('sent');
    expect(getOkleykaJobForLineItem(db, 'li-b').status).toBe('sent');
  });

  it('schedules delayed kick after TIMEOUT retry', async () => {
    vi.useFakeTimers();
    const db = dbWithOutbox();
    const job = enqueueSample(db);
    const deps = makeDeps({
      sendOkleykaToTelegram: vi.fn()
        .mockRejectedValueOnce(new Error('Error: TIMEOUT'))
        .mockResolvedValue({ messageIds: [9] }),
    });

    await runOkleykaDrain(db, deps);
    expect(getOkleykaJobForLineItem(db, 'li-1').status).toBe('pending');
    expect(deps.sendOkleykaToTelegram).toHaveBeenCalledTimes(1);

    dueNow(db, job.id);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(deps.sendOkleykaToTelegram).toHaveBeenCalledTimes(2);
    expect(getOkleykaJobForLineItem(db, 'li-1').status).toBe('sent');
  });

  it('does not leave sending when getTelegramDestination throws', async () => {
    const db = dbWithOutbox();
    enqueueSample(db);
    const deps = makeDeps({
      getTelegramDestination: vi.fn(() => {
        throw new Error('settings exploded');
      }),
    });

    await expect(runOkleykaDrain(db, deps)).resolves.toBeUndefined();

    const row = getOkleykaJobForLineItem(db, 'li-1');
    expect(row.status).not.toBe('sending');
    expect(row.status).toBe('failed');
    expect(row.error).toMatch(/settings exploded/);
    expect(deps.sendOkleykaToTelegram).not.toHaveBeenCalled();
  });

  it('logs download warning on successful send without failing the job', async () => {
    const db = dbWithOutbox();
    enqueueSample(db);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const deps = makeDeps({
        sendOkleykaToTelegram: vi.fn(async () => ({
          messageIds: [7],
          warning: 'Failed to download https://cdn.example.com/a.jpg: HTTP 404',
        })),
      });

      await runOkleykaDrain(db, deps);

      const row = getOkleykaJobForLineItem(db, 'li-1');
      expect(row.status).toBe('sent');
      expect(row.error).toMatch(/Failed to download/);
      const logged = [...log.mock.calls, ...warnSpy.mock.calls]
        .map((args) => args.join(' '))
        .join('\n');
      expect(logged).toMatch(/okleyka drain sent job=/);
      expect(logged).toMatch(/Failed to download/);
    } finally {
      log.mockRestore();
      warnSpy.mockRestore();
    }
  });

  it('drain ticker recovers stale sending then kicks', async () => {
    vi.useFakeTimers();
    const { initOkleykaDrainTicker } = await import('../src/telegram/okleyka-drain.js');
    expect(typeof initOkleykaDrainTicker).toBe('function');

    const db = dbWithOutbox();
    enqueueSample(db);
    claimNextOkleykaJob(db);
    db.prepare(
      `UPDATE telegram_okleyka_outbox SET sending_started_at = datetime('now', '-3 minutes')`,
    ).run();
    expect(getOkleykaJobForLineItem(db, 'li-1').status).toBe('sending');

    const deps = makeDeps();
    initOkleykaDrainTicker(db, deps);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(getOkleykaJobForLineItem(db, 'li-1').status).toBe('sent');
    expect(deps.sendOkleykaToTelegram).toHaveBeenCalledOnce();
  });
});
