import { NewMessage } from 'telegram/events/index.js';
import { getDb } from '../../db/connection.js';
import { parseDigestCommand } from '../digest/commands.js';
import { messageMatchesDigestDest } from '../digest/command-match.js';
import { runDigestForDay } from '../digest/run.js';
import { sendDigestText } from '../digest/send.js';
import { getTelegramDestination } from '../settings.js';
import { onUserbotClientReady } from './client.js';
import { normalizePeerChatId } from './mention-forward.js';

const DIGEST_ERROR_TEXT = 'не удалось загрузить';

/**
 * Forum topic root id from GramJS MessageReplyHeader (Bot-API threadId).
 *
 * @param {{ replyTo?: { forumTopic?: boolean, replyToTopId?: number, replyToMsgId?: number } } | undefined} message
 * @returns {number | null}
 */
export function resolveMessageThreadId(message) {
  const reply = message?.replyTo;
  if (!reply?.forumTopic) return null;
  const threadId = reply.replyToTopId ?? reply.replyToMsgId;
  return threadId != null ? Number(threadId) : null;
}

/**
 * @param {{
 *   client: { sendMessage: Function },
 *   db: import('better-sqlite3').Database,
 *   message?: { message?: string, peerId?: object, replyTo?: object },
 *   deps?: object,
 * }} input
 */
export async function handleDigestCommandEvent({ client, db, message, deps = {} }) {
  const text = String(message?.message ?? '');
  const parse = deps.parseDigestCommand ?? parseDigestCommand;
  const offsetDays = parse(text);
  if (offsetDays == null) return;

  const normalize = deps.normalizePeerChatId ?? normalizePeerChatId;
  const sourceChatId = normalize(message?.peerId);
  const messageThreadId = resolveMessageThreadId(message);

  const getDest = deps.getTelegramDestination ?? getTelegramDestination;
  const dest = getDest(db, 'digest.morning');
  const matches = deps.messageMatchesDigestDest ?? messageMatchesDigestDest;
  if (!matches({ sourceChatId, messageThreadId, dest })) return;

  const run = deps.runDigestForDay ?? runDigestForDay;
  const send = deps.sendDigestText ?? sendDigestText;

  try {
    const result = await run({ db, offsetDays });
    if (result?.ok === false) {
      await send({
        client,
        chatId: dest.chatId,
        threadId: dest.threadId,
        text: DIGEST_ERROR_TEXT,
      });
    }
  } catch (err) {
    console.error('[digest] command error:', err.message);
    await send({
      client,
      chatId: dest.chatId,
      threadId: dest.threadId,
      text: DIGEST_ERROR_TEXT,
    });
  }
}

const attachedClients = new WeakSet();

/**
 * Registers the NewMessage digest-command handler on every userbot client instance.
 */
export function initDigestCommands(deps = {}) {
  const register = deps.onClientReady ?? onUserbotClientReady;
  register((client) => {
    if (attachedClients.has(client)) return;
    attachedClients.add(client);
    client.addEventHandler(
      async (event) => {
        try {
          const db = deps.getDb?.() ?? getDb();
          await handleDigestCommandEvent({ client, db, message: event.message, deps });
        } catch (err) {
          console.error('[telegram] digest command handler error:', err.message);
        }
      },
      new NewMessage({ incoming: true }),
    );
    console.log('[telegram] digest commands attached');
  });
}
