import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  beginTwentySyncContext,
  endTwentySyncContext,
  runTwentySyncContext,
  logTwentyStep,
} from '../src/services/twenty-sync-log.js';

describe('twenty-sync-log context', () => {
  afterEach(() => {
    endTwentySyncContext();
    vi.restoreAllMocks();
  });

  it('keeps overlapping begin scopes isolated per deal', async () => {
    const lines = [];
    vi.spyOn(console, 'log').mockImplementation((line) => {
      lines.push(String(line));
    });

    async function runDeal(dealId) {
      const ctx = { dealId, twentyId: `t-${dealId}` };
      await runTwentySyncContext(ctx, async () => {
        beginTwentySyncContext(ctx);
        try {
          logTwentyStep('start');
          await new Promise((resolve) => setTimeout(resolve, 20));
          logTwentyStep('done');
        } finally {
          endTwentySyncContext();
        }
      });
    }

    await Promise.all([runDeal(1), runDeal(2)]);

    const deal1 = lines.filter((line) => line.includes('"dealId":1'));
    const deal2 = lines.filter((line) => line.includes('"dealId":2'));
    expect(deal1.some((line) => line.includes('step: start'))).toBe(true);
    expect(deal1.some((line) => line.includes('step: done'))).toBe(true);
    expect(deal2.some((line) => line.includes('step: start'))).toBe(true);
    expect(deal2.some((line) => line.includes('step: done'))).toBe(true);
    expect(deal1).toHaveLength(2);
    expect(deal2).toHaveLength(2);
  });
});
