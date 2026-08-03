import { telegramFetch } from './proxy.js';

export async function callTelegram(token, method, body, fetchImpl = telegramFetch) {
  const resp = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const data = await resp.json();
  if (!data.ok) {
    const err = new Error(data.description || 'Telegram API error');
    err.status = 502;
    throw err;
  }
  return data.result;
}
