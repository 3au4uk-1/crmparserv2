import { ProxyAgent } from 'undici';
import { config } from '../config.js';

let cachedDispatcher;
let cachedDispatcherUrl;

/**
 * GramJS proxy option built from TELEGRAM_PROXY_URL (socks5://[user:pass@]host:port).
 * @returns {object | undefined}
 */
export function getGramjsProxy(url = config.telegramProxyUrl) {
  if (!url) return undefined;
  const parsed = new URL(url);
  return {
    ip: parsed.hostname,
    port: Number(parsed.port),
    socksType: 5,
    timeout: 10,
    ...(parsed.username
      ? {
          username: decodeURIComponent(parsed.username),
          password: decodeURIComponent(parsed.password || ''),
        }
      : {}),
  };
}

/**
 * fetch that routes api.telegram.org through TELEGRAM_HTTP_PROXY_URL.
 * All other hosts (e.g. internal file downloads) go direct.
 * @type {typeof globalThis.fetch}
 */
export function telegramFetch(url, init = {}) {
  const proxyUrl = config.telegramHttpProxyUrl;
  if (proxyUrl && String(url).startsWith('https://api.telegram.org/')) {
    if (cachedDispatcherUrl !== proxyUrl) {
      cachedDispatcher = new ProxyAgent(proxyUrl);
      cachedDispatcherUrl = proxyUrl;
    }
    return globalThis.fetch(url, { ...init, dispatcher: cachedDispatcher });
  }
  return globalThis.fetch(url, init);
}
