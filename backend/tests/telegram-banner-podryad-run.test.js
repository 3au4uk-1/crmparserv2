import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchBannerPodryadDayData = vi.fn();
const callTelegram = vi.fn();
const findSendForLoadDate = vi.fn();
const insertSendLog = vi.fn();
const getTelegramDestination = vi.fn();
const getTelegramBotToken = vi.fn();
const getBannerPodryadHour = vi.fn();
const requireTwentyConfig = vi.fn();
const createTwentyGqlClient = vi.fn();

vi.mock('../src/telegram/banner-podryad/fetch.js', () => ({
  fetchBannerPodryadDayData: (...a) => fetchBannerPodryadDayData(...a),
}));
vi.mock('../src/telegram/api-client.js', () => ({
  callTelegram: (...a) => callTelegram(...a),
}));
vi.mock('../src/telegram/send-log.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    findSendForLoadDate: (...a) => findSendForLoadDate(...a),
    insertSendLog: (...a) => insertSendLog(...a),
  };
});
vi.mock('../src/telegram/settings.js', () => ({
  getTelegramDestination: (...a) => getTelegramDestination(...a),
  getTelegramBotToken: (...a) => getTelegramBotToken(...a),
  getBannerPodryadHour: (...a) => getBannerPodryadHour(...a),
}));
vi.mock('../src/services/twenty-config.js', () => ({
  requireTwentyConfig: (...a) => requireTwentyConfig(...a),
}));
vi.mock('../src/services/twenty-gql.js', () => ({
  createTwentyGqlClient: (...a) => createTwentyGqlClient(...a),
}));
vi.mock('../src/db/connection.js', () => ({
  getDb: () => ({ mocked: true }),
}));

import {
  queueBannerPodryadCatchUp,
  runCatchUpSweep,
  runEveningBatch,
} from '../src/telegram/banner-podryad/run.js';
import { sendBannerPodryadText } from '../src/telegram/banner-podryad/send-bot.js';

const NOW = new Date('2026-08-24T12:00:00.000Z');
const TOMORROW = '2026-08-25';
const TODAY = '2026-08-24';
const EVENT = 'banner_podryad.evening';

function reminderDay() {
  return {
    deals: [{ id: 'o1', name: '180288 Баннер', stage: 'NOVYY' }],
    lineItemsByOppId: {
      o1: [
        {
          id: 'li-1',
          opportunityId: 'o1',
          name: 'Баннер 3x6',
          tip: 'BANNERA',
          stage: 'NOVYY',
        },
      ],
    },
  };
}

describe('runEveningBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTelegramDestination.mockReturnValue({ chatId: '-100', threadId: 9 });
    getTelegramBotToken.mockReturnValue('tok');
    getBannerPodryadHour.mockReturnValue(18);
    requireTwentyConfig.mockReturnValue({ apiUrl: 'https://t/graphql', apiToken: 'x' });
    createTwentyGqlClient.mockReturnValue(vi.fn());
    fetchBannerPodryadDayData.mockResolvedValue(reminderDay());
    findSendForLoadDate.mockReturnValue(undefined);
    insertSendLog.mockReturnValue(1);
    callTelegram.mockResolvedValue({ message_id: 42 });
  });

  it('does not send already-logged items', async () => {
    findSendForLoadDate.mockReturnValue({ id: 1 });

    const result = await runEveningBatch({ db: {}, now: NOW });

    expect(result).toEqual({ ok: true, sent: false });
    expect(callTelegram).not.toHaveBeenCalled();
    expect(insertSendLog).not.toHaveBeenCalled();
    expect(findSendForLoadDate).toHaveBeenCalledWith({}, EVENT, 'li-1', TOMORROW);
  });

  it('does not sendMessage when the universe is empty', async () => {
    fetchBannerPodryadDayData.mockResolvedValue({ deals: [], lineItemsByOppId: {} });

    const result = await runEveningBatch({ db: {}, now: NOW });

    expect(result).toEqual({ ok: true, sent: false });
    expect(callTelegram).not.toHaveBeenCalled();
    expect(insertSendLog).not.toHaveBeenCalled();
  });

  it('skips when destination is missing', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    getTelegramDestination.mockReturnValue(null);

    const result = await runEveningBatch({ db: {}, now: NOW });

    expect(result).toEqual({ skipped: true });
    expect(callTelegram).not.toHaveBeenCalled();
    expect(insertSendLog).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('skips when bot token is missing', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    getTelegramBotToken.mockReturnValue('');

    const result = await runEveningBatch({ db: {}, now: NOW });

    expect(result).toEqual({ skipped: true });
    expect(callTelegram).not.toHaveBeenCalled();
    expect(insertSendLog).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('sends one message and logs each item on success', async () => {
    const result = await runEveningBatch({ db: {}, now: NOW });

    expect(result).toEqual({ ok: true, sent: true });
    expect(callTelegram).toHaveBeenCalledTimes(1);
    expect(callTelegram).toHaveBeenCalledWith(
      'tok',
      'sendMessage',
      expect.objectContaining({
        chat_id: '-100',
        message_thread_id: 9,
        text: expect.stringContaining('Накануне отгрузки 25.08'),
      }),
    );
    expect(insertSendLog).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        event: EVENT,
        lineItemId: 'li-1',
        opportunityId: 'o1',
        loadDate: TOMORROW,
        chatId: '-100',
      }),
    );
  });

  it('does not insert send-log when Twenty fetch throws', async () => {
    fetchBannerPodryadDayData.mockRejectedValue(new Error('twenty down'));

    await expect(runEveningBatch({ db: {}, now: NOW })).rejects.toThrow('twenty down');
    expect(insertSendLog).not.toHaveBeenCalled();
    expect(callTelegram).not.toHaveBeenCalled();
  });

  it('treats UNIQUE constraint on insert after send as already-logged', async () => {
    insertSendLog.mockImplementation(() => {
      const err = new Error('UNIQUE constraint failed: telegram_send_log.event, line_item_id, load_date');
      err.code = 'SQLITE_CONSTRAINT_UNIQUE';
      throw err;
    });

    const result = await runEveningBatch({ db: {}, now: NOW });

    expect(result).toEqual({ ok: true, sent: true });
    expect(callTelegram).toHaveBeenCalledTimes(1);
  });
});

describe('runCatchUpSweep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTelegramDestination.mockReturnValue({ chatId: '-100', threadId: 9 });
    getTelegramBotToken.mockReturnValue('tok');
    getBannerPodryadHour.mockReturnValue(18);
    requireTwentyConfig.mockReturnValue({ apiUrl: 'https://t/graphql', apiToken: 'x' });
    createTwentyGqlClient.mockReturnValue(vi.fn());
    findSendForLoadDate.mockReturnValue(undefined);
    insertSendLog.mockReturnValue(1);
    callTelegram.mockResolvedValue({ message_id: 7 });
    fetchBannerPodryadDayData.mockImplementation(async (_gql, { gte }) => {
      if (String(gte).startsWith(TODAY)) return reminderDay();
      return { deals: [], lineItemsByOppId: {} };
    });
  });

  it('skips already-logged catch-up items', async () => {
    findSendForLoadDate.mockReturnValue({ id: 9 });

    const result = await runCatchUpSweep({ db: {}, now: NOW });

    expect(result).toEqual({ ok: true, sent: false });
    expect(callTelegram).not.toHaveBeenCalled();
    expect(findSendForLoadDate).toHaveBeenCalledWith({}, EVENT, 'li-1', TODAY);
  });

  it('uses catch-up title and today loadDate', async () => {
    const result = await runCatchUpSweep({ db: {}, now: NOW });

    expect(result.ok).toBe(true);
    expect(result.sent).toBe(true);
    expect(callTelegram.mock.calls[0][2].text).toContain('Догон · отгрузка 24.08');
    expect(insertSendLog).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ lineItemId: 'li-1', loadDate: TODAY }),
    );
  });

  it('limits to optional lineItemIds', async () => {
    fetchBannerPodryadDayData.mockResolvedValue({
      deals: [{ id: 'o1', name: '180288 Баннер', stage: 'NOVYY' }],
      lineItemsByOppId: {
        o1: [
          { id: 'li-1', opportunityId: 'o1', name: 'A', tip: 'BANNERA', stage: 'NOVYY' },
          { id: 'li-2', opportunityId: 'o1', name: 'B', tip: 'PODRYAD', stage: 'NOVYY' },
        ],
      },
    });

    await runCatchUpSweep({ db: {}, now: NOW, lineItemIds: ['li-2'] });

    expect(insertSendLog).toHaveBeenCalledTimes(1);
    expect(insertSendLog).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ lineItemId: 'li-2' }),
    );
  });

  it('at 18:00 tomorrow universe is one evening send, not two', async () => {
    const eveningNow = new Date('2026-08-24T15:00:00.000Z');
    const logged = new Set();
    findSendForLoadDate.mockImplementation((_db, _event, id, loadDate) =>
      logged.has(`${id}|${loadDate}`) ? { id: 1 } : undefined,
    );
    insertSendLog.mockImplementation((_db, row) => {
      logged.add(`${row.lineItemId}|${row.loadDate}`);
      return 1;
    });
    fetchBannerPodryadDayData.mockImplementation(async (_gql, { gte }) => {
      if (String(gte).startsWith(TOMORROW)) return reminderDay();
      return { deals: [], lineItemsByOppId: {} };
    });

    await runEveningBatch({ db: {}, now: eveningNow });
    await runCatchUpSweep({ db: {}, now: eveningNow });

    expect(callTelegram).toHaveBeenCalledTimes(1);
    expect(callTelegram.mock.calls[0][2].text).toContain('Накануне отгрузки 25.08');
    expect(callTelegram.mock.calls[0][2].text).not.toContain('Догон');
  });
});

describe('sendBannerPodryadText', () => {
  beforeEach(() => {
    callTelegram.mockReset();
  });

  it('retries once when sendMessage throws', async () => {
    callTelegram.mockRejectedValueOnce(new Error('net')).mockResolvedValueOnce({ message_id: 1 });

    await sendBannerPodryadText({
      token: 'tok',
      chatId: '-1',
      threadId: 3,
      text: 'hi',
    });

    expect(callTelegram).toHaveBeenCalledTimes(2);
    expect(callTelegram).toHaveBeenLastCalledWith('tok', 'sendMessage', {
      chat_id: '-1',
      text: 'hi',
      message_thread_id: 3,
    });
  });
});

describe('queueBannerPodryadCatchUp debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    getTelegramDestination.mockReturnValue({ chatId: '-100' });
    getTelegramBotToken.mockReturnValue('tok');
    getBannerPodryadHour.mockReturnValue(18);
    requireTwentyConfig.mockReturnValue({ apiUrl: 'https://t/graphql', apiToken: 'x' });
    createTwentyGqlClient.mockReturnValue(vi.fn());
    findSendForLoadDate.mockReturnValue(undefined);
    insertSendLog.mockReturnValue(1);
    callTelegram.mockResolvedValue({ message_id: 1 });
    fetchBannerPodryadDayData.mockResolvedValue(reminderDay());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits 45s then runs catch-up with queued ids', async () => {
    queueBannerPodryadCatchUp(['li-1'], { db: {}, now: NOW });
    expect(callTelegram).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(45_000);

    expect(callTelegram).toHaveBeenCalled();
    expect(insertSendLog).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ lineItemId: 'li-1' }),
    );
  });
});
