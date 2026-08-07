export const OMNI_DEFAULT_BASE_URL = 'https://omni.dosugmayak.ru/v1';
export const OMNI_DEFAULT_MODEL = 'oc/deepseek-v4-flash-free';
export const OMNI_DEFAULT_FALLBACK_MODEL = 'auto';
export const OMNI_DEFAULT_TIMEOUT_MS = 10_000;

function trim(v) {
  return String(v ?? '').trim();
}

function stripTrailingSlash(url) {
  return trim(url).replace(/\/+$/, '');
}

function getSetting(db, key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return trim(row?.value);
}

function resolveApiKey(db) {
  const fromSettings = getSetting(db, 'digest_omni_api_key');
  if (fromSettings) return fromSettings;
  const fromOmniEnv = trim(process.env.OMNI_API_KEY);
  if (fromOmniEnv) return fromOmniEnv;
  return trim(process.env.DIGEST_OMNI_API_KEY);
}

function resolveBaseUrl(db) {
  const fromSettings = getSetting(db, 'digest_omni_base_url');
  if (fromSettings) return stripTrailingSlash(fromSettings);
  const fromEnv = trim(process.env.OMNI_BASE_URL);
  if (fromEnv) return stripTrailingSlash(fromEnv);
  return OMNI_DEFAULT_BASE_URL;
}

export function getDigestOmniConfig(db) {
  const apiKey = resolveApiKey(db);
  const enabledFlag = getSetting(db, 'digest_omni_enabled');
  const enabled = enabledFlag !== '0' && apiKey.length > 0;
  const model = getSetting(db, 'digest_omni_model') || OMNI_DEFAULT_MODEL;
  const fallbackModel =
    getSetting(db, 'digest_omni_model_fallback') || OMNI_DEFAULT_FALLBACK_MODEL;

  return {
    enabled,
    baseUrl: resolveBaseUrl(db),
    apiKey,
    model,
    fallbackModel,
    timeoutMs: OMNI_DEFAULT_TIMEOUT_MS,
  };
}
