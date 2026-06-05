import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('twenty-config', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('prefers env over settings', async () => {
    process.env.TWENTY_API_URL = 'https://env.example/graphql';
    process.env.TWENTY_API_TOKEN = 'env-token';

    const { getTwentyConfig } = await import('../src/services/twenty-config.js');
    const config = getTwentyConfig();

    expect(config.source).toBe('env');
    expect(config.apiUrl).toBe('https://env.example/graphql');
    expect(config.apiToken).toBe('env-token');
  });

  it('rewrites /rest URL to /graphql', async () => {
    const { normalizeTwentyApiUrl } = await import('../src/services/twenty-config.js');
    expect(normalizeTwentyApiUrl('https://twenty.dosugmayak.ru/rest'))
      .toBe('https://twenty.dosugmayak.ru/graphql');
    expect(normalizeTwentyApiUrl('https://twenty.example.com'))
      .toBe('https://twenty.example.com/graphql');
  });
});
