import { Api } from 'telegram';
import { config } from '../../config.js';
import { getDb } from '../../db/connection.js';
import { upsertTelegramChat, upsertTelegramTopic, listTelegramChats } from '../chat-store.js';
import { getAutoInviteRun } from '../auto-invite-store.js';
import { scheduleAutoInvite } from '../auto-invite.js';
import { getUserbotClient, isUserbotConfigured } from './client.js';

/**
 * Normalize GramJS dialog entity into chat row fields.
 * @param {object} entity
 * @returns {null | {
 *   chatId: string,
 *   title: string,
 *   type: string,
 *   isForum: boolean,
 *   username: string | null,
 *   entity: object,
 * }}
 */
export function mapEntityToChat(entity) {
  if (!entity) return null;
  const className = entity.className || entity.constructor?.name || '';
  const isUser = className.includes('User') || entity.firstName != null || entity.bot === true;
  if (isUser && !entity.title) return null;

  const isChannel =
    className.includes('Channel') || Boolean(entity.broadcast) || Boolean(entity.megagroup);
  const isBasicChat = className.includes('Chat') && !isChannel;

  if (!isChannel && !isBasicChat) return null;
  // Skip broadcast-only channels (keep megagroups / forums).
  if (entity.broadcast && !entity.megagroup && !entity.forum) return null;

  const rawId = entity.id != null ? String(entity.id) : null;
  if (!rawId) return null;

  let chatId = rawId;
  if (isChannel) {
    const abs = rawId.replace(/^-/, '');
    chatId = `-100${abs}`;
  } else if (!rawId.startsWith('-')) {
    chatId = `-${rawId}`;
  }

  const type = entity.megagroup || entity.forum ? 'supergroup' : isChannel ? 'channel' : 'group';

  return {
    chatId,
    title: entity.title || entity.username || '',
    type,
    isForum: Boolean(entity.forum),
    username: entity.username || null,
    entity,
  };
}

/**
 * One reconcile pass: upsert group dialogs + forum topics; schedule auto-invite for new groups.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {Record<string, unknown>} [deps]
 */
export async function reconcileUserbotChats(db, deps = {}) {
  const isConfigured = deps.isConfigured ?? (() => isUserbotConfigured(db));
  if (!isConfigured()) {
    return { skipped: true, reason: 'userbot not configured', chats: 0, topics: 0, invited: 0 };
  }

  const getClient = deps.getClient ?? (() => getUserbotClient(db));
  const scheduleInvite = deps.scheduleInvite ?? scheduleAutoInvite;
  const listForumTopics =
    deps.listForumTopics ??
    (async (client, entity) => {
      try {
        const result = await client.invoke(
          new Api.channels.GetForumTopics({
            channel: entity,
            offsetDate: 0,
            offsetId: 0,
            offsetTopic: 0,
            limit: 100,
          }),
        );
        return (result?.topics || []).map((t) => ({
          id: Number(t.id),
          title: t.title || null,
        }));
      } catch {
        return [];
      }
    });

  const client = await getClient();
  const dialogs = await client.getDialogs({ limit: 200 });

  let chatsUpserted = 0;
  let topicsUpserted = 0;
  let invitesScheduled = 0;
  const knownBefore = new Set(
    listTelegramChats(db, { activeOnly: false }).map((row) => String(row.chat_id)),
  );

  for (const dialog of dialogs) {
    const entity = dialog.entity || dialog;
    const mapped = mapEntityToChat(entity);
    if (!mapped) continue;
    if (mapped.type !== 'group' && mapped.type !== 'supergroup') continue;

    const isNew = !knownBefore.has(mapped.chatId);
    upsertTelegramChat(db, {
      chatId: mapped.chatId,
      title: mapped.title,
      type: mapped.type,
      isForum: mapped.isForum,
      username: mapped.username,
      active: true,
      source: 'userbot',
    });
    chatsUpserted += 1;
    knownBefore.add(mapped.chatId);

    if (mapped.isForum) {
      const topics = await listForumTopics(client, entity);
      for (const topic of topics) {
        if (!Number.isInteger(topic.id) || topic.id <= 0) continue;
        upsertTelegramTopic(db, {
          chatId: mapped.chatId,
          threadId: topic.id,
          name: topic.title,
          source: 'userbot',
        });
        topicsUpserted += 1;
      }
    }

    if (isNew && !getAutoInviteRun(db, mapped.chatId)) {
      scheduleInvite(db, mapped.chatId);
      invitesScheduled += 1;
    }
  }

  return { chats: chatsUpserted, topics: topicsUpserted, invited: invitesScheduled };
}

let running = false;

/** Background reconcile loop (discovery + auto-invite trigger). */
export function initUserbotReconcile(deps = {}) {
  if (running) return;
  const intervalMs = deps.intervalMs ?? config.telegramReconcileIntervalMs ?? 30000;
  if (intervalMs <= 0) return;

  running = true;
  console.log(`[telegram] userbot reconcile enabled (every ${intervalMs}ms)`);

  const tick = async () => {
    try {
      const db = deps.getDb?.() ?? getDb();
      await reconcileUserbotChats(db, deps);
    } catch (err) {
      console.error('[telegram] reconcile error:', err.message);
    }
  };

  setTimeout(() => {
    tick().finally(() => {
      const handle = setInterval(tick, intervalMs);
      handle.unref?.();
    });
  }, 2000).unref?.();
}

/** Test helper to reset singleton. */
export function resetUserbotReconcileForTests() {
  running = false;
}
