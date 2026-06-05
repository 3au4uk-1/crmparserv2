import { config } from '../config.js';
import { getDb } from '../db/connection.js';

function getSetting(key) {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row?.value?.trim() || '';
}

export function getTwentyConfig() {
  const envUrl = config.twentyApiUrl?.trim();
  const envToken = config.twentyApiToken?.trim();
  if (envUrl && envToken) {
    return { apiUrl: envUrl, apiToken: envToken, source: 'env' };
  }

  const settingsUrl = getSetting('twenty_api_url');
  const settingsToken = getSetting('twenty_api_token');
  if (settingsUrl && settingsToken) {
    return { apiUrl: settingsUrl, apiToken: settingsToken, source: 'settings' };
  }

  return { apiUrl: null, apiToken: null, source: null };
}

export function requireTwentyConfig() {
  const twenty = getTwentyConfig();
  if (!twenty.apiUrl || !twenty.apiToken) {
    throw new Error('Twenty CRM not configured');
  }
  return twenty;
}
