import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { getTelegramBotToken, getTelegramChatId } from '../telegram/settings.js';
import { sendOkleykaToTelegram } from '../telegram/outbound.js';
import { handleTelegramWebhook } from '../telegram/inbound.js';

const router = Router();

function readChatMap(db) {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'telegram_chat_map'`).get();
  if (!row?.value) return {};
  try {
    const map = JSON.parse(row.value);
    return map && typeof map === 'object' && !Array.isArray(map) ? map : {};
  } catch {
    return {};
  }
}

function buildTokenPreview(token) {
  if (!token) return '';
  const parts = token.split(':');
  if (parts.length >= 2) {
    const secret = parts[1];
    const tail = secret.length >= 4 ? secret.slice(-4) : secret;
    return `${parts[0]}:••••${tail}`;
  }
  return `••••${token.slice(-4)}`;
}

async function callTelegramGetMe(token, fetchImpl = globalThis.fetch) {
  const resp = await fetchImpl(`https://api.telegram.org/bot${token}/getMe`);
  const data = typeof resp.json === 'function' ? await resp.json() : resp;
  if (!data.ok) {
    const err = new Error(data.description || 'Telegram API error');
    err.status = 502;
    throw err;
  }
  return data.result;
}

router.get('/settings', (req, res) => {
  const db = getDb();
  const token = getTelegramBotToken(db);
  res.json({
    tokenSet: Boolean(token),
    tokenPreview: buildTokenPreview(token),
    chatMap: readChatMap(db),
  });
});

router.put('/settings', (req, res) => {
  const db = getDb();
  const { token, chatMap } = req.body ?? {};

  if (typeof token === 'string' && token.trim()) {
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('telegram_bot_token', ?)`).run(
      token.trim(),
    );
  }

  if (chatMap && typeof chatMap === 'object' && !Array.isArray(chatMap)) {
    const merged = { ...readChatMap(db), ...chatMap };
    db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('telegram_chat_map', ?)`).run(
      JSON.stringify(merged),
    );
  }

  res.json({ success: true });
});

router.post('/test-bot', async (req, res, next) => {
  try {
    const db = getDb();
    const token = getTelegramBotToken(db);
    if (!token) {
      return res.status(400).json({ ok: false, error: 'Bot token not configured' });
    }
    const me = await callTelegramGetMe(token);
    res.json({ ok: true, username: me.username });
  } catch (err) {
    next(err);
  }
});

router.post('/test-send', async (req, res, next) => {
  try {
    const db = getDb();
    const token = getTelegramBotToken(db);
    const chatId = getTelegramChatId(db, 'okleyka.send');
    if (!token) {
      return res.status(400).json({ ok: false, error: 'Bot token not configured' });
    }
    if (!chatId) {
      return res.status(400).json({ ok: false, error: 'okleyka.send chat_id not configured' });
    }
    await sendOkleykaToTelegram({
      token,
      chatId,
      text: 'Тест из crmparser',
      fileUrls: [],
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.post('/webhook', handleTelegramWebhook);

export default router;
