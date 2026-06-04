import axios from 'axios';
import * as cheerio from 'cheerio';
import { config } from '../config.js';
import { getDb } from '../db/connection.js';

let sessionCookies = '';
let calToken = '';
let keepAliveTimer = null;

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7',
};

function getSetting(key) {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row?.value || '';
}

function getAuthMode() {
  return getSetting('auth_mode') || 'auto';
}

export function normalizeCookieString(raw) {
  if (!raw) return '';
  return raw
    .trim()
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s*;\s*/g, '; ')
    .replace(/;\s*$/g, '');
}

function getCrmCookies() {
  return normalizeCookieString(getSetting('crm_cookies'));
}

function buildUrl(path) {
  const base = config.crmBaseUrl.replace(/\/$/, '');
  return `${base}/${path}`;
}

function dashboardHeaders() {
  return {
    ...BROWSER_HEADERS,
    Cookie: sessionCookies,
    Referer: buildUrl('dashboard.php'),
  };
}

function isLoginPage(html) {
  const lower = html.toLowerCase();
  const hasCalendar = html.includes('id="calendar"') || html.includes("id='calendar'");
  if (hasCalendar) return false;
  return (
    lower.includes('type="password"') ||
    lower.includes("type='password'") ||
    /name=["']pass/.test(lower) ||
    (lower.includes('войти') && lower.includes('login'))
  );
}

function parseTokenFromHtml(html) {
  const $ = cheerio.load(html);
  let token =
    $('#cal_token').val()?.toString() ||
    $('input#cal_token').attr('value') ||
    $('input[name="cal_token"]').attr('value') ||
    '';

  if (!token) {
    const match =
      html.match(/id=["']cal_token["'][^>]*value=["']([^"']*)["']/i) ||
      html.match(/value=["']([^"']*)["'][^>]*id=["']cal_token["']/i);
    token = match?.[1] || '';
  }

  return token.trim();
}

async function loginWithCredentials() {
  const loginUrl = buildUrl('dashboard.php');

  const loginResp = await axios.post(
    loginUrl,
    new URLSearchParams({
      login: config.crmLogin,
      password: config.crmPassword,
    }).toString(),
    {
      headers: {
        ...BROWSER_HEADERS,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      maxRedirects: 5,
      validateStatus: () => true,
    }
  );

  const setCookieHeaders = loginResp.headers['set-cookie'];
  if (setCookieHeaders) {
    sessionCookies = setCookieHeaders.map(c => c.split(';')[0]).join('; ');
  }

  return sessionCookies;
}

async function extractToken() {
  const dashboardUrl = buildUrl('dashboard.php');
  const resp = await axios.get(dashboardUrl, {
    headers: dashboardHeaders(),
    maxRedirects: 5,
    validateStatus: () => true,
  });

  const html = typeof resp.data === 'string' ? resp.data : String(resp.data);

  if (resp.status >= 400) {
    throw new Error(
      `CRM dashboard returned HTTP ${resp.status}. Check CRM_BASE_URL and network access.`
    );
  }

  if (isLoginPage(html)) {
    throw new Error(
      'CRM session is not authenticated (login page returned). Update PHPSESSID cookies or CRM_LOGIN/CRM_PASSWORD.'
    );
  }

  const parsed = parseTokenFromHtml(html);
  if (parsed) {
    calToken = parsed;
    return calToken;
  }

  // In browser, missing #cal_token yields "token=" + undefined → token=undefined in API URLs
  calToken = 'undefined';
  console.warn(
    'cal_token input not found on dashboard; using token=undefined (same as browser when field is absent)'
  );
  return calToken;
}

function startKeepAlive() {
  if (keepAliveTimer) clearInterval(keepAliveTimer);
  keepAliveTimer = setInterval(async () => {
    try {
      await axios.get(buildUrl('keep.php'), {
        headers: dashboardHeaders(),
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
        throw new Error(
          `Auto-login failed (${lastError?.message}) and no fallback cookies available`
        );
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

export function getCrmRequestHeaders() {
  return dashboardHeaders();
}

export function setManualCookies(cookies) {
  sessionCookies = normalizeCookieString(cookies);
}

export function stopKeepAlive() {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}
