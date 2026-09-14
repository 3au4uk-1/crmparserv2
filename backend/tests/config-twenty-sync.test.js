import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('twenty sync config defaults', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    delete process.env.TWENTY_API_RATE_LIMIT_MAX;
    delete process.env.TWENTY_SYNC_CONCURRENCY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('defaults rate max to 720 and concurrency to 6', async () => {
    const { config } = await import('../src/config.js');
    expect(config.twentyApiRateLimitMax).toBe(720);
    expect(config.twentySyncConcurrency).toBe(6);
  });

  it('reads TWENTY_SYNC_CONCURRENCY from env', async () => {
    process.env.TWENTY_SYNC_CONCURRENCY = '4';
    const { config } = await import('../src/config.js');
    expect(config.twentySyncConcurrency).toBe(4);
  });
});
