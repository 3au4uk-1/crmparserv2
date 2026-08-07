import { getDb } from '../db/connection.js';
import { callTelegram } from './api-client.js';
import { upsertTelegramChat, upsertTelegramTopic } from './chat-store.js';
import { parseDigestCommand } from './digest/commands.js';
import { runDigestForDay } from './digest/run.js';
import { getTelegramBotToken } from './settings.js';

const MEMBER_OK = new Set(['member', 'administrator', 'creator']);

/**
 * Legacy bot webhook processor — discovery only (no auto-invite).
 * Auto-invite is triggered by user-bot reconcile.
 */
export function processTelegramUpdate(db, update) {
  if (update.my_chat_member) {
    const m = update.my_chat_member;
    const chat = m.chat;
    const status = m.new_chat_member?.status;
    upsertTelegramChat(db, {
      chatId: String(chat.id),
      title: chat.title || chat.username || '',
      type: chat.type || '',
      isForum: Boolean(chat.is_forum),
      username: chat.username || null,
      active: MEMBER_OK.has(status),
      source: 'webhook',
    });
    return;
  }
  const msg = update.message || update.channel_post;
  if (!msg?.chat) return;
  const chat = msg.chat;
  upsertTelegramChat(db, {
    chatId: String(chat.id),
    title: chat.title || chat.username || '',
    type: chat.type || '',
    isForum: Boolean(chat.is_forum),
    username: chat.username || null,
    active: true,
    source: 'webhook',
  });
  const text = (msg.text || '').trim();
  const offset = parseDigestCommand(text);
  if (offset != null) {
    const chatId = String(chat.id);
    const threadId = msg.message_thread_id || null;
    void runDigestForDay({ db, offsetDays: offset, chatId, threadId }).catch((err) => {
      console.error('[digest] command failed:', err.message);
      const token = getTelegramBotToken(db);
      if (token) {
        void callTelegram(token, 'sendMessage', {
          chat_id: chatId,
          text: 'не удалось загрузить',
          ...(threadId ? { message_thread_id: threadId } : {}),
        }).catch(() => {});
      }
    });
  }
  const created = msg.forum_topic_created;
  const edited = msg.forum_topic_edited;
  if ((created || edited) && msg.message_thread_id) {
    upsertTelegramTopic(db, {
      chatId: String(chat.id),
      threadId: msg.message_thread_id,
      name: created?.name || edited?.name || null,
      source: 'webhook',
    });
  } else if (msg.is_topic_message && msg.message_thread_id) {
    upsertTelegramTopic(db, {
      chatId: String(chat.id),
      threadId: msg.message_thread_id,
      name: null,
      source: 'webhook',
    });
  }
}

export function handleTelegramWebhook(req, res) {
  const db = getDb();
  const secretRow = db
    .prepare(`SELECT value FROM settings WHERE key = 'telegram_webhook_secret'`)
    .get();
  const expected = (secretRow?.value ?? '').trim();
  if (expected) {
    const got = req.get('X-Telegram-Bot-Api-Secret-Token') || '';
    if (got !== expected) return res.status(401).json({ ok: false, error: 'invalid secret' });
  }
  try {
    processTelegramUpdate(db, req.body || {});
  } catch (err) {
    console.error('[telegram] webhook process error:', err.message);
  }
  return res.json({ ok: true });
}
