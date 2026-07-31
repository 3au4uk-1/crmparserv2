import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { config } from '../config.js';
import { getDb } from '../db/connection.js';
import { callTelegram } from '../telegram/api-client.js';
import { telegramFetch } from '../telegram/proxy.js';
import {
  getTelegramBotToken,
  getTelegramDestination,
  mergeChatMapEntry,
} from '../telegram/settings.js';
import {
  listTelegramChats,
  listTelegramTopics,
  upsertTelegramChat,
  upsertTelegramTopic,
} from '../telegram/chat-store.js';
import { sendOkleykaToTelegram } from '../telegram/outbound.js';
import { handleTelegramWebhook } from '../telegram/inbound.js';
import { runAutoInviteForChat } from '../telegram/auto-invite.js';
import {
  listAutoInviteMembers,
  upsertAutoInviteMember,
  updateAutoInviteMember,
  deleteAutoInviteMember,
} from '../telegram/auto-invite-store.js';
import { isUserbotConfigured } from '../telegram/userbot/client.js';
import {
  getAuthStatus,
  startLogin,
  submitCode,
  submitPassword,
  cancelLogin,
  logout,
} from '../telegram/userbot/auth-login.js';

const router = Router();

function handleAuthRoute(handler) {
  return async (req, res, next) => {
    try {
      const db = getDb();
      const result = await handler(db, req);
      res.json(result);
    } catch (err) {
      if (err?.status) {
        return res.status(err.status).json({ error: err.message });
      }
      next(err);
    }
  };
}

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

function readWebhookSecret(db) {
  const row = db.prepare(`SELECT value FROM settings WHERE key = 'telegram_webhook_secret'`).get();
  return (row?.value ?? '').trim();
}

function writeWebhookSecret(db, secret) {
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('telegram_webhook_secret', ?)`).run(
    secret,
  );
}

function mapChatRow(row) {
  return {
    chatId: row.chat_id,
    title: row.title,
    type: row.type,
    isForum: Boolean(row.is_forum),
    username: row.username,
    active: Boolean(row.active),
    source: row.source,
    lastSeenAt: row.last_seen_at,
  };
}

function mapTopicRow(row) {
  return {
    chatId: row.chat_id,
    threadId: row.thread_id,
    name: row.name,
    source: row.source,
    lastSeenAt: row.last_seen_at,
  };
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

async function callTelegramGetMe(token, fetchImpl = telegramFetch) {
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
    const merged = mergeChatMapEntry(readChatMap(db), chatMap);
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
    const dest = getTelegramDestination(db, 'okleyka.send');
    if (!token) {
      return res.status(400).json({ ok: false, error: 'Bot token not configured' });
    }
    if (!dest?.chatId) {
      return res.status(400).json({ ok: false, error: 'okleyka.send chat_id not configured' });
    }
    const { chatId, threadId } = dest;
    await sendOkleykaToTelegram({
      token,
      chatId,
      threadId,
      text: 'Тест из crmparser',
      fileUrls: [],
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/chats', (req, res) => {
  const db = getDb();
  const activeOnly = req.query.active !== '0';
  const chats = listTelegramChats(db, { activeOnly }).map(mapChatRow);
  res.json({ chats });
});

router.get('/chats/:chatId/topics', (req, res) => {
  const db = getDb();
  const topics = listTelegramTopics(db, req.params.chatId).map(mapTopicRow);
  res.json({ topics });
});

router.post('/chats', async (req, res, next) => {
  try {
    const db = getDb();
    const token = getTelegramBotToken(db);
    if (!token) {
      return res.status(400).json({ error: 'Bot token not configured' });
    }
    const chatId = String(req.body?.chatId ?? '').trim();
    if (!chatId) {
      return res.status(400).json({ error: 'chatId required' });
    }
    const chat = await callTelegram(token, 'getChat', { chat_id: chatId });
    upsertTelegramChat(db, {
      chatId: String(chat.id),
      title: chat.title || chat.username || '',
      type: chat.type || '',
      isForum: Boolean(chat.is_forum),
      username: chat.username || null,
      active: true,
      source: 'manual',
    });
    const row = db.prepare(`SELECT * FROM telegram_chats WHERE chat_id = ?`).get(String(chat.id));
    res.json({ chat: mapChatRow(row) });
  } catch (err) {
    next(err);
  }
});

router.post('/chats/:chatId/topics', (req, res) => {
  const db = getDb();
  const chatId = req.params.chatId;
  const threadId = Number(req.body?.threadId);
  if (!Number.isInteger(threadId) || threadId <= 0) {
    return res.status(400).json({ error: 'threadId must be a positive integer' });
  }
  const name = req.body?.name != null ? String(req.body.name) : null;
  upsertTelegramTopic(db, { chatId, threadId, name, source: 'manual' });
  const row = db
    .prepare(`SELECT * FROM telegram_topics WHERE chat_id = ? AND thread_id = ?`)
    .get(chatId, threadId);
  res.json({ topic: mapTopicRow(row) });
});

router.get('/webhook/status', async (req, res, next) => {
  try {
    const db = getDb();
    const token = getTelegramBotToken(db);
    const secretSet = Boolean(readWebhookSecret(db));
    const webhookUrl = config.publicBaseUrl
      ? `${config.publicBaseUrl}/api/telegram/webhook`
      : '';
    const payload = {
      publicBaseUrlConfigured: Boolean(config.publicBaseUrl),
      webhookUrl,
      secretSet,
    };
    if (token) {
      payload.telegram = await callTelegram(token, 'getWebhookInfo', {});
    }
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

router.post('/webhook/setup', async (req, res, next) => {
  try {
    if (!config.publicBaseUrl) {
      return res.status(400).json({ error: 'PUBLIC_BASE_URL not set' });
    }
    const db = getDb();
    const token = getTelegramBotToken(db);
    if (!token) {
      return res.status(400).json({ error: 'Bot token not configured' });
    }
    let secret = readWebhookSecret(db);
    if (!secret) {
      secret = randomBytes(24).toString('hex');
      writeWebhookSecret(db, secret);
    }
    const webhookUrl = `${config.publicBaseUrl}/api/telegram/webhook`;
    await callTelegram(token, 'setWebhook', {
      url: webhookUrl,
      secret_token: secret,
      allowed_updates: ['message', 'channel_post', 'my_chat_member'],
    });
    res.json({ ok: true, webhookUrl, secretSet: true });
  } catch (err) {
    next(err);
  }
});

router.post('/webhook/teardown', async (req, res, next) => {
  try {
    const db = getDb();
    const token = getTelegramBotToken(db);
    if (!token) {
      return res.status(400).json({ error: 'Bot token not configured' });
    }
    await callTelegram(token, 'deleteWebhook', {});
    res.json({ ok: true, secretSet: Boolean(readWebhookSecret(db)) });
  } catch (err) {
    next(err);
  }
});

router.get('/userbot/auth/status', (req, res) => {
  res.json(getAuthStatus(getDb()));
});

router.post(
  '/userbot/auth/start',
  handleAuthRoute((db, req) => startLogin(db, req.body?.phone)),
);

router.post(
  '/userbot/auth/code',
  handleAuthRoute((db, req) => submitCode(db, req.body?.code)),
);

router.post(
  '/userbot/auth/password',
  handleAuthRoute((db, req) => submitPassword(db, req.body?.password)),
);

router.post('/userbot/auth/cancel', (req, res) => {
  cancelLogin();
  res.json({ ok: true });
});

router.post('/userbot/auth/logout', (req, res) => {
  logout(getDb());
  res.json({ ok: true });
});

router.get('/auto-invite/status', (req, res) => {
  res.json({ configured: isUserbotConfigured(getDb()) });
});

router.get('/auto-invite/members', (req, res) => {
  const db = getDb();
  const members = listAutoInviteMembers(db, { activeOnly: false });
  res.json({ members });
});

router.post('/auto-invite/members', (req, res, next) => {
  try {
    const db = getDb();
    const { username, userId, displayName } = req.body ?? {};
    const member = upsertAutoInviteMember(db, { username, userId, displayName });
    res.status(201).json({ member });
  } catch (err) {
    if (err.message?.includes('required')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

router.patch('/auto-invite/members/:id', (req, res, next) => {
  try {
    const db = getDb();
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'invalid id' });
    }
    const member = updateAutoInviteMember(db, id, req.body ?? {});
    if (!member) {
      return res.status(404).json({ error: 'not found' });
    }
    res.json({ member });
  } catch (err) {
    if (err.message?.includes('required')) {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  }
});

router.delete('/auto-invite/members/:id', (req, res) => {
  const db = getDb();
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: 'invalid id' });
  }
  const deleted = deleteAutoInviteMember(db, id);
  if (!deleted) {
    return res.status(404).json({ error: 'not found' });
  }
  res.json({ ok: true });
});

router.post('/auto-invite/runs/:chatId/retry', async (req, res, next) => {
  try {
    const db = getDb();
    const result = await runAutoInviteForChat(db, req.params.chatId, { force: true });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/webhook', handleTelegramWebhook);

export default router;
