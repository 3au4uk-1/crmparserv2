import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('axios', () => ({ default: { post: vi.fn() } }));

describe('twenty gql counters', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts one logical gql call and a 429 retry as rate_limited', async () => {
    const axios = (await import('axios')).default;
    const {
      gql,
      resetTwentyGqlCounters,
      getTwentyGqlCounters,
    } = await import('../src/services/twenty-gql.js');

    resetTwentyGqlCounters();
    axios.post
      .mockResolvedValueOnce({
        status: 200,
        data: { errors: [{ message: 'Limit reached (100 tokens per 60000 ms)' }] },
      })
      .mockResolvedValueOnce({ status: 200, data: { data: { ok: true } } });

    const promise = gql('http://t/graphql', 'tok', 'query { ping }');
    await vi.runAllTimersAsync();
    await promise;

    expect(getTwentyGqlCounters()).toEqual({ gqlCount: 1, rateLimitedCount: 1 });
    expect(axios.post).toHaveBeenCalledTimes(2);
  });
});
