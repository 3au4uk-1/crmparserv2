import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('tony parse config defaults', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    delete process.env.FETCH_CONCURRENCY;
    delete process.env.TONY_UNCHANGED_PROBE;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it('defaults FETCH_CONCURRENCY to 8 and probe on', async () => {
    const { config } = await import('../src/config.js');
    expect(config.fetchConcurrency).toBe(8);
    expect(config.tonyUnchangedProbe).toBe(true);
  });

  it('treats TONY_UNCHANGED_PROBE=false as off', async () => {
    process.env.TONY_UNCHANGED_PROBE = 'false';
    const { config } = await import('../src/config.js');
    expect(config.tonyUnchangedProbe).toBe(false);
  });
});
