import { describe, it, expect } from 'vitest';
import { createPool, withRetry } from '../src/services/fetch-pool.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('createPool', () => {
  it('never runs more than `concurrency` tasks at once', async () => {
    const run = createPool({ concurrency: 3 });
    let active = 0;
    let maxActive = 0;
    const task = async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await sleep(20);
      active--;
      return active;
    };
    await Promise.all(Array.from({ length: 12 }, () => run(task)));
    expect(maxActive).toBe(3);
  });

  it('returns each task result and propagates rejections', async () => {
    const run = createPool({ concurrency: 2 });
    const ok = await run(async () => 42);
    expect(ok).toBe(42);
    await expect(run(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  });

  it('with concurrency 1 it serializes (FIFO)', async () => {
    const run = createPool({ concurrency: 1 });
    const order = [];
    await Promise.all([
      run(async () => { await sleep(15); order.push('a'); }),
      run(async () => { order.push('b'); }),
    ]);
    expect(order).toEqual(['a', 'b']);
  });
});

describe('withRetry', () => {
  it('retries retryable failures then succeeds', async () => {
    let n = 0;
    const result = await withRetry(
      async () => { n++; if (n < 3) { const e = new Error('429'); e.retryable = true; throw e; } return 'ok'; },
      { retries: 3, baseDelayMs: 1, isRetryable: (e) => e.retryable }
    );
    expect(result).toBe('ok');
    expect(n).toBe(3);
  });

  it('does not retry non-retryable failures', async () => {
    let n = 0;
    await expect(
      withRetry(async () => { n++; throw new Error('login'); }, { retries: 3, baseDelayMs: 1, isRetryable: () => false })
    ).rejects.toThrow('login');
    expect(n).toBe(1);
  });
});
