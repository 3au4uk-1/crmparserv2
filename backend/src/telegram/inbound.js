import { getDb } from '../db/connection.js';
import {
  upsertBotChat,
  upsertBotTopic,
  upsertTelegramChat,
  upsertTelegramTopic,
} from './chat-store.js';
import { emit } from './dispatcher.js';

const MEMBER_OK = new Set(['member', 'administrator', 'creator']);

/**
 * Legacy bot webhook processor — discovery only (no auto-invite).
 * Auto-invite is triggered by user-bot reconcile.
 */
export async function processTelegramUpdate(db, update) {
  if (update.my_chat_member) {
    const m = update.my_chat_member;
    const chat = m.chat;
    const status = m.new_chat_member?.status;
    const botChat = {
      chatId: String(chat.id),
      title: chat.title || chat.username || '',
      type: chat.type || '',
      isForum: Boolean(chat.is_forum),
      username: chat.username || null,
      active: MEMBER_OK.has(status),
      source: 'bot',
    };
    upsertTelegramChat(db, { ...botChat, source: 'webhook' });
    upsertBotChat(db, botChat);
  } else {
    const msg = update.message || update.channel_post;
    if (msg?.chat) {
      const chat = msg.chat;
      const botChat = {
        chatId: String(chat.id),
        title: chat.title || chat.username || '',
        type: chat.type || '',
        isForum: Boolean(chat.is_forum),
        username: chat.username || null,
        active: true,
        source: 'bot',
      };
      upsertTelegramChat(db, { ...botChat, source: 'webhook' });
      upsertBotChat(db, botChat);
      const created = msg.forum_topic_created;
      const edited = msg.forum_topic_edited;
      if ((created || edited) && msg.message_thread_id) {
        const topic = {
          chatId: String(chat.id),
          threadId: msg.message_thread_id,
          name: created?.name || edited?.name || null,
          source: 'bot',
        };
        upsertTelegramTopic(db, { ...topic, source: 'webhook' });
        upsertBotTopic(db, topic);
      } else if (msg.is_topic_message && msg.message_thread_id) {
        const topic = {
          chatId: String(chat.id),
          threadId: msg.message_thread_id,
          name: null,
          source: 'bot',
        };
        upsertTelegramTopic(db, { ...topic, source: 'webhook' });
        upsertBotTopic(db, topic);
      }
    }
  }
  await emit('telegram.inbound', { db, update });
}

export async function handleTelegramWebhook(req, res) {
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
    await processTelegramUpdate(db, req.body || {});
  } catch (err) {
    console.error('[telegram] webhook process error:', err.message);
  }
  return res.json({ ok: true });
}
