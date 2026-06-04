import axios from 'axios';
import * as cheerio from 'cheerio';
import { config } from '../config.js';
import { getDb } from '../db/connection.js';

let sessionCookies = '';
let calToken = '';
let keepAliveTimer = null;

function getSetting(key) {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row?.value || '';
}

function getAuthMode() {
  return getSetting('auth_mode') || 'auto';
}

function getCrmCookies() {
  return getSetting('crm_cookies');
}

function buildUrl(path) {
  const base = config.crmBaseUrl.replace(/\/$/, '');
  return `${base}/${path}`;
}

async function loginWithCredentials() {
  const loginUrl = buildUrl('dashboard.php');

  const loginResp = await axios.post(loginUrl, new URLSearchParams({
    login: config.crmLogin,
    password: config.crmPassword,
  }).toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    maxRedirects: 5,
    validateStatus: () => true,
    withCredentials: true,
  });

  const setCookieHeaders = loginResp.headers['set-cookie'];
  if (setCookieHeaders) {
    sessionCookies = setCookieHeaders
      .map(c => c.split(';')[0])
      .join('; ');
  }

  return sessionCookies;
}

async function extractToken() {
  const dashboardUrl = buildUrl('dashboard.php');
  const resp = await axios.get(dashboardUrl, {
    headers: { Cookie: sessionCookies },
    validateStatus: () => true,
  });

  const $ = cheerio.load(resp.data);
  calToken = $('#cal_token').val() || '';

  if (!calToken) {
    throw new Error('Failed to extract cal_token from dashboard');
  }

  return calToken;
}

function startKeepAlive() {
  if (keepAliveTimer) clearInterval(keepAliveTimer);
  keepAliveTimer = setInterval(async () => {
    try {
      await axios.get(buildUrl('keep.php'), {
        headers: { Cookie: sessionCookies },
      });
    } catch (err) {
      console.error('Keep-alive failed:', err.message);
    }
  }, 5 * 60 * 1000);
}

export async function authenticate() {
  const mode = getAuthMode();

  if (mode === 'cookies') {
    sessionCookies = getCrmCookies();
    if (!sessionCookies) {
      throw new Error('Cookie mode selected but no cookies configured');
    }
  } else {
    let attempts = 0;
    let lastError;
    while (attempts < 3) {
      try {
        await loginWithCredentials();
        break;
      } catch (err) {
        lastError = err;
        attempts++;
        if (attempts < 3) await new Promise(r => setTimeout(r, 2000));
      }
    }
    if (attempts >= 3) {
      console.error('Auto-login failed 3 times, switching to cookie fallback');
      const db = getDb();
      db.prepare("UPDATE settings SET value = 'cookies' WHERE key = 'auth_mode'").run();
      sessionCookies = getCrmCookies();
      if (!sessionCookies) {
        throw new Error(`Auto-login failed (${lastError?.message}) and no fallback cookies available`);
      }
    }
  }

  await extractToken();
  startKeepAlive();

  return { cookies: sessionCookies, token: calToken };
}

export function getSessionCookies() {
  return sessionCookies;
}

export function getCalToken() {
  return calToken;
}

export function setManualCookies(cookies) {
  sessionCookies = cookies;
}

export function stopKeepAlive() {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}
