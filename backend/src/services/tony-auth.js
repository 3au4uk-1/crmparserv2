import axios from 'axios';
import { config } from '../config.js';
import { getDb } from '../db/connection.js';

let tonyCookies = '';

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
};

function getSetting(key) {
  let db;
  try {
    db = getDb();
  } catch {
    return '';
  }
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row?.value || '';
}

export function resetTonyAuth() {
  tonyCookies = '';
}

export function getTonyCookies() {
  return tonyCookies;
}

/** Resolve Tony connection settings: DB settings override env config. */
export function getTonyConfig() {
  return {
    baseUrl: (getSetting('tony_base_url') || config.tonyBaseUrl).replace(/\/$/, ''),
    login: getSetting('tony_login') || config.tonyLogin,
    password: getSetting('tony_password') || config.tonyPassword,
  };
}

export async function tonyLogin(options = {}) {
  const { baseUrl, login, password } = { ...getTonyConfig(), ...options };
  if (!login || !password) {
    throw new Error('Tony login failed: credentials not configured');
  }

  const resp = await axios.post(
    `${baseUrl.replace(/\/$/, '')}/ajax/login.php`,
    new URLSearchParams({ login, password }).toString(),
    {
      headers: { ...BROWSER_HEADERS, 'Content-Type': 'application/x-www-form-urlencoded' },
      maxRedirects: 0,
      validateStatus: () => true,
      timeout: 30000,
    }
  );

  const setCookie = resp.headers?.['set-cookie'];
  if (!setCookie || setCookie.length === 0) {
    throw new Error('Tony login failed: no session cookie returned (check credentials)');
  }

  tonyCookies = setCookie.map((c) => c.split(';')[0]).join('; ');
  return tonyCookies;
}

export function tonyRequestHeaders() {
  return { ...BROWSER_HEADERS, Cookie: tonyCookies };
}
