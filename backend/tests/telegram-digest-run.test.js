import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchDigestDayData = vi.fn();
const buildDigestModel = vi.fn();
const renderDigestMessage = vi.fn();
const callTelegram = vi.fn();
const getTelegramBotToken = vi.fn();
const getTelegramDestination = vi.fn();
const requireTwentyConfig = vi.fn();
const createTwentyGqlClient = vi.fn();

vi.mock('../src/telegram/digest/fetch.js', () => ({
  fetchDigestDayData: (...a) => fetchDigestDayData(...a),
}));
vi.mock('../src/telegram/digest/compute.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, buildDigestModel: (...a) => buildDigestModel(...a) };
});
vi.mock('../src/telegram/digest/render.js', () => ({
  renderDigestMessage: (...a) => renderDigestMessage(...a),
}));
vi.mock('../src/telegram/api-client.js', () => ({
  callTelegram: (...a) => callTelegram(...a),
}));
vi.mock('../src/telegram/settings.js', () => ({
  getTelegramBotToken: (...a) => getTelegramBotToken(...a),
  getTelegramDestination: (...a) => getTelegramDestination(...a),
}));
vi.mock('../src/services/twenty-config.js', () => ({
  requireTwentyConfig: (...a) => requireTwentyConfig(...a),
}));
vi.mock('../src/services/twenty-gql.js', () => ({
  createTwentyGqlClient: (...a) => createTwentyGqlClient(...a),
}));

import { runDigestForDay, runMorningDigests } from '../src/telegram/digest/run.js';

describe('runDigestForDay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTelegramBotToken.mockReturnValue('tok');
    requireTwentyConfig.mockReturnValue({ apiUrl: 'https://t/graphql', apiToken: 'x' });
    createTwentyGqlClient.mockReturnValue(vi.fn());
    fetchDigestDayData.mockResolvedValue({ deals: [], lineItemsByOppId: {} });
    buildDigestModel.mockReturnValue({
      totalDeals: 0,
      totalPositions: 0,
      ready: { deals: 0, positions: 0, amountRubles: 0 },
      notReady: { deals: 0, positions: 0, amountRubles: 0 },
      risks: [],
    });
    renderDigestMessage.mockReturnValue('TEXT');
    callTelegram.mockResolvedValue({});
  });

  it('sends to explicit chatId', async () => {
    const result = await runDigestForDay({
      db: {},
      offsetDays: 1,
      chatId: '-1001',
      now: new Date('2026-08-06T09:00:00.000Z'),
    });
    expect(result.ok).toBe(true);
    expect(callTelegram).toHaveBeenCalledWith(
      'tok',
      'sendMessage',
      expect.objectContaining({ chat_id: '-1001', text: 'TEXT' }),
    );
  });

  it('skips morning when no destination', async () => {
    getTelegramDestination.mockReturnValue(null);
    const result = await runMorningDigests({ db: {} });
    expect(result.skipped).toBe(true);
    expect(callTelegram).not.toHaveBeenCalled();
  });

  it('returns ok:false and logs when no bot token', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    getTelegramBotToken.mockReturnValue(null);

    const result = await runDigestForDay({ db: {}, offsetDays: 1, chatId: '-1001' });

    expect(result).toEqual({ ok: false, skipped: true, error: 'no bot token' });
    expect(logSpy).toHaveBeenCalledWith('[digest] skipped: no bot token');
    expect(callTelegram).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });
});
