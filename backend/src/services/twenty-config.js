import { config } from '../config.js';
import { getDb } from '../db/connection.js';

function getSetting(key) {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row?.value?.trim() || '';
}

/** Twenty sync uses GraphQL. REST base (/rest) must be rewritten to /graphql. */
export function normalizeTwentyApiUrl(url) {
  const trimmed = url.trim().replace(/\/+$/, '');
  if (!trimmed) return trimmed;
  if (trimmed.endsWith('/graphql')) return trimmed;
  if (trimmed.endsWith('/rest')) return `${trimmed.slice(0, -5)}/graphql`;
  return `${trimmed}/graphql`;
}

function withNormalizedUrl(apiUrl, apiToken, source) {
  return {
    apiUrl: normalizeTwentyApiUrl(apiUrl),
    apiToken,
    source,
    rawApiUrl: apiUrl.trim(),
  };
}

export function getTwentyConfig() {
  const envUrl = config.twentyApiUrl?.trim();
  const envToken = config.twentyApiToken?.trim();
  if (envUrl && envToken) {
    return withNormalizedUrl(envUrl, envToken, 'env');
  }

  const settingsUrl = getSetting('twenty_api_url');
  const settingsToken = getSetting('twenty_api_token');
  if (settingsUrl && settingsToken) {
    return withNormalizedUrl(settingsUrl, settingsToken, 'settings');
  }

  return { apiUrl: null, apiToken: null, source: null, rawApiUrl: null };
}

export function requireTwentyConfig() {
  const twenty = getTwentyConfig();
  if (!twenty.apiUrl || !twenty.apiToken) {
    throw new Error('Twenty CRM not configured');
  }
  return twenty;
}
