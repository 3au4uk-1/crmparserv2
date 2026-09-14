import { describe, it, expect, vi } from 'vitest';
import { createInFlightCache } from '../src/services/twenty-inflight-cache.js';

describe('createInFlightCache', () => {
  it('shares one in-flight promise per key', async () => {
    const cache = createInFlightCache();
    let starts = 0;
    const fn = () => {
      starts += 1;
      return new Promise((resolve) => setTimeout(() => resolve('id-1'), 20));
    };
    const [a, b] = await Promise.all([
      cache.getOrStart('Баннер', fn),
      cache.getOrStart('Баннер', fn),
    ]);
    expect(a).toBe('id-1');
    expect(b).toBe('id-1');
    expect(starts).toBe(1);
  });
});
