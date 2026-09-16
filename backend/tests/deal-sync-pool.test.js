import { describe, it, expect } from 'vitest';
import { runDealSyncPool } from '../src/services/deal-sync-pool.js';

describe('runDealSyncPool', () => {
  it('runs two deals overlapping when concurrency is 2', async () => {
    let inFlight = 0;
    let max = 0;
    const started = [];
    await runDealSyncPool([1, 2], async (id) => {
      started.push(id);
      inFlight += 1;
      max = Math.max(max, inFlight);
      await new Promise((r) => setTimeout(r, 30));
      inFlight -= 1;
      return id;
    }, { concurrency: 2 });
    expect(max).toBe(2);
    expect(started).toHaveLength(2);
  });

  it('continues after a failed deal and reports settle', async () => {
    const settled = [];
    await runDealSyncPool([1, 2], async (id) => {
      if (id === 1) throw new Error('boom');
      return { action: 'updated' };
    }, {
      concurrency: 2,
      onDealSettled: (event) => settled.push(event),
    });
    expect(settled).toHaveLength(2);
    expect(settled.filter((e) => !e.ok)).toHaveLength(1);
  });
});
