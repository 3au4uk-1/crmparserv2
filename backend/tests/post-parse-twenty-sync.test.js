import { describe, it, expect, vi, beforeEach } from 'vitest';

const syncDealToTwenty = vi.fn();
const cancelDealInTwenty = vi.fn();
const restoreDealInTwenty = vi.fn();
const runPrintSheetRefresh = vi.fn();

vi.mock('../src/services/twenty-sync.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    syncDealToTwenty: (...args) => syncDealToTwenty(...args),
    cancelDealInTwenty: (...args) => cancelDealInTwenty(...args),
    restoreDealInTwenty: (...args) => restoreDealInTwenty(...args),
    runPrintSheetRefresh: (...args) => runPrintSheetRefresh(...args),
    setTwentySyncInFlightCaches: actual.setTwentySyncInFlightCaches ?? vi.fn(),
  };
});

vi.mock('../src/services/twenty-gql.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    resetTwentyGqlCounters: vi.fn(),
    getTwentyGqlCounters: () => ({ gqlCount: 3, rateLimitedCount: 1 }),
  };
});

import { runPostParseTwentySync } from '../src/services/post-parse-twenty-sync.js';

describe('runPostParseTwentySync', () => {
  beforeEach(() => {
    syncDealToTwenty.mockReset().mockResolvedValue({ action: 'updated' });
    cancelDealInTwenty.mockReset().mockResolvedValue({ action: 'cancelled' });
    restoreDealInTwenty.mockReset().mockResolvedValue({ action: 'restored' });
    runPrintSheetRefresh.mockReset().mockResolvedValue({});
  });

  it('syncs with skipPrintSheetRefresh and refreshes print sheet once after failures', async () => {
    syncDealToTwenty
      .mockResolvedValueOnce({ action: 'noop' })
      .mockRejectedValueOnce(new Error('fail'));
    const summary = await runPostParseTwentySync({
      resyncDealIds: [1, 2],
      cancelDealIds: [],
      restoreDealIds: [],
      autoApproveDealIds: [],
    });
    expect(syncDealToTwenty).toHaveBeenNthCalledWith(1, 1, { skipPrintSheetRefresh: true });
    expect(syncDealToTwenty).toHaveBeenNthCalledWith(2, 2, { skipPrintSheetRefresh: true });
    expect(runPrintSheetRefresh).toHaveBeenCalledTimes(1);
    expect(summary.skipped_noop).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.deals).toBe(2);
  });

  it('runs queues in order resync, cancel, restore, auto-approve', async () => {
    const order = [];
    syncDealToTwenty.mockImplementation(async (id) => {
      order.push(`s${id}`);
      return { action: 'updated' };
    });
    cancelDealInTwenty.mockImplementation(async (id) => {
      order.push(`c${id}`);
      return { action: 'cancelled' };
    });
    restoreDealInTwenty.mockImplementation(async (id) => {
      order.push(`r${id}`);
      return { action: 'restored' };
    });
    await runPostParseTwentySync({
      resyncDealIds: [1],
      cancelDealIds: [2],
      restoreDealIds: [3],
      autoApproveDealIds: [4],
    });
    expect(order).toEqual(['s1', 'c2', 'r3', 's4']);
  });
});
