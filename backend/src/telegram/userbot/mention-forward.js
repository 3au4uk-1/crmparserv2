import { Api } from 'telegram';
import { NewMessage } from 'telegram/events/index.js';
import { generateRandomBigInt } from 'telegram/Helpers.js';
import { getDb } from '../../db/connection.js';
import { getMentionForwardSettings } from '../settings.js';
import { onUserbotClientReady } from './client.js';

/**
 * Normalize a GramJS Peer into a Bot-API-style chat id string.
 * PeerUser (DMs) → null: mentions are only forwarded from groups.
 *
 * @param {{ channelId?: unknown, chatId?: unknown, userId?: unknown } | undefined} peerId
 * @returns {string | null}
 */
export function normalizePeerChatId(peerId) {
  if (!peerId) return null;
  if (peerId.channelId != null) return `-100${peerId.channelId}`;
  if (peerId.chatId != null) return `-${peerId.chatId}`;
  return null;
}

/**
 * Pure filter: forward only configured, explicit mentions from other group chats.
 *
 * @param {{ message?: { mentioned?: boolean }, sourceChatId?: string | null, settings?: { chatId?: string, topicId?: number | null } }} input
 * @returns {{ ok: boolean, reason?: string }}
 */
export function shouldForwardMention({ message, sourceChatId, settings } = {}) {
  if (!settings?.chatId || !settings?.topicId) {
    return { ok: false, reason: 'not configured' };
  }
  if (message?.mentioned !== true) {
    return { ok: false, reason: 'not a mention' };
  }
  if (!sourceChatId) {
    return { ok: false, reason: 'not a group chat' };
  }
  if (sourceChatId === settings.chatId) {
    return { ok: false, reason: 'message is in the target chat' };
  }
  return { ok: true };
}

/**
 * @param {{ chatTitle?: string | null, senderName?: string, senderUsername?: string }} input
 */
export function buildMentionContext({ chatTitle, senderName, senderUsername } = {}) {
  const from = [senderName, senderUsername ? `@${senderUsername}` : '']
    .filter(Boolean)
    .join(' ');
  const source = chatTitle ? `«${chatTitle}»` : 'чате';
  return `🔔 Упоминание в ${source}${from ? ` от ${from}` : ''}`;
}

/**
 * Sends a context line into the target topic, then forwards the original message.
 *
 * @param {{
 *   client: { sendMessage: Function, invoke: Function },
 *   db: import('better-sqlite3').Database,
 *   message: { id: number, peerId?: object, mentioned?: boolean, getSender?: () => Promise<object> },
 *   deps?: { randomId?: () => unknown },
 * }} input
 */
export async function forwardMentionMessage({ client, db, message, deps = {} }) {
  const settings = getMentionForwardSettings(db);
  const sourceChatId = normalizePeerChatId(message?.peerId);
  const check = shouldForwardMention({ message, sourceChatId, settings });
  if (!check.ok) {
    return { skipped: true, reason: check.reason };
  }

  const row = db
    .prepare(`SELECT title FROM telegram_chats WHERE chat_id = ?`)
    .get(sourceChatId);

  let senderName = '';
  let senderUsername = '';
  try {
    const sender = await message.getSender?.();
    senderName = [sender?.firstName, sender?.lastName].filter(Boolean).join(' ');
    senderUsername = sender?.username || '';
  } catch {
    // Sender info is best-effort; forward without it.
  }

  const text = buildMentionContext({ chatTitle: row?.title, senderName, senderUsername });
  await client.sendMessage(settings.chatId, { message: text, replyTo: settings.topicId });
  await client.invoke(
    new Api.messages.ForwardMessages({
      fromPeer: message.peerId,
      id: [message.id],
      toPeer: settings.chatId,
      topMsgId: settings.topicId,
      randomId: [deps.randomId ? deps.randomId() : generateRandomBigInt()],
    }),
  );
  return { forwarded: true, sourceChatId };
}

const attachedClients = new WeakSet();

/**
 * Registers the NewMessage handler on every userbot client instance.
 * Safe to call once at startup; re-attaches after client re-creation.
 */
export function initMentionForwarding(deps = {}) {
  const register = deps.onClientReady ?? onUserbotClientReady;
  register((client) => {
    if (attachedClients.has(client)) return;
    attachedClients.add(client);
    client.addEventHandler(
      async (event) => {
        try {
          const db = deps.getDb?.() ?? getDb();
          await forwardMentionMessage({ client, db, message: event.message });
        } catch (err) {
          console.error('[telegram] mention forward error:', err.message);
        }
      },
      new NewMessage({ incoming: true }),
    );
    console.log('[telegram] mention forwarding attached');
  });
}
