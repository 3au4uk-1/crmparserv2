import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function fakeDb(values = {}) {
  return {
    prepare() {
      return {
        get(key) {
          const v = values[key];
          return v != null ? { value: v } : undefined;
        },
      };
    },
  };
}

describe('getDigestOmniConfig', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    delete process.env.OMNI_API_KEY;
    delete process.env.DIGEST_OMNI_API_KEY;
    delete process.env.OMNI_BASE_URL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns defaults and disabled when no api key', async () => {
    const { getDigestOmniConfig } = await import('../src/telegram/digest/omni-settings.js');
    const cfg = getDigestOmniConfig(fakeDb());
    expect(cfg).toEqual({
      enabled: false,
      baseUrl: 'https://omni.dosugmayak.ru/v1',
      apiKey: '',
      model: 'oc/deepseek-v4-flash-free',
      fallbackModel: 'auto',
      timeoutMs: 10_000,
    });
  });

  it('enables when settings key is present', async () => {
    const { getDigestOmniConfig } = await import('../src/telegram/digest/omni-settings.js');
    const cfg = getDigestOmniConfig(
      fakeDb({ digest_omni_api_key: 'settings-key', digest_omni_base_url: 'https://custom.test/v1/' }),
    );
    expect(cfg.enabled).toBe(true);
    expect(cfg.apiKey).toBe('settings-key');
    expect(cfg.baseUrl).toBe('https://custom.test/v1');
  });

  it('disables when digest_omni_enabled is 0 even with key', async () => {
    const { getDigestOmniConfig } = await import('../src/telegram/digest/omni-settings.js');
    const cfg = getDigestOmniConfig(
      fakeDb({ digest_omni_api_key: 'k', digest_omni_enabled: '0' }),
    );
    expect(cfg.enabled).toBe(false);
    expect(cfg.apiKey).toBe('k');
  });

  it('resolves api key from env fallbacks', async () => {
    process.env.DIGEST_OMNI_API_KEY = 'digest-env';
    let { getDigestOmniConfig } = await import('../src/telegram/digest/omni-settings.js');
    expect(getDigestOmniConfig(fakeDb()).apiKey).toBe('digest-env');

    vi.resetModules();
    process.env.OMNI_API_KEY = 'omni-env';
    ({ getDigestOmniConfig } = await import('../src/telegram/digest/omni-settings.js'));
    expect(getDigestOmniConfig(fakeDb()).apiKey).toBe('omni-env');
  });

  it('prefers settings key over env', async () => {
    process.env.OMNI_API_KEY = 'env-key';
    const { getDigestOmniConfig } = await import('../src/telegram/digest/omni-settings.js');
    const cfg = getDigestOmniConfig(fakeDb({ digest_omni_api_key: 'db-key' }));
    expect(cfg.apiKey).toBe('db-key');
    expect(cfg.enabled).toBe(true);
  });

  it('resolves model and fallback from settings with defaults', async () => {
    const { getDigestOmniConfig } = await import('../src/telegram/digest/omni-settings.js');
    const cfg = getDigestOmniConfig(
      fakeDb({
        digest_omni_api_key: 'k',
        digest_omni_model: 'custom/model',
        digest_omni_model_fallback: 'fallback/model',
      }),
    );
    expect(cfg.model).toBe('custom/model');
    expect(cfg.fallbackModel).toBe('fallback/model');
  });
});
