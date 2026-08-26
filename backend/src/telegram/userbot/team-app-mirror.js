const LINK_CODE_RE = /^[A-Za-z0-9]{8}$/;

/**
 * Pure inbound classifier for the Team App userbot mirror. No Bot API.
 * @param {{
 *   peerChatId: string | null,
 *   threadId?: number | string | null,
 *   senderId?: string | number | null,
 *   selfId?: string | number | null,
 *   text?: string | null,
 *   settings?: { chatId?: string, topicId?: number | null },
 *   knownOutboxTelegramIds?: Set<string>,
 *   telegramMessageId?: string | number | null,
 * }} input
 * @returns {{ action: 'ignore' } | { action: 'link_code', code: string } | { action: 'topic_inbound', originatedByOutbox: boolean, isUserbotSelf: boolean }}
 */
export function classifyUserbotMessage({
  peerChatId,
  threadId,
  senderId,
  selfId,
  text,
  settings,
  knownOutboxTelegramIds,
  telegramMessageId,
}) {
  const trimmed = String(text ?? '').trim();
  if (peerChatId == null || peerChatId === '') {
    if (LINK_CODE_RE.test(trimmed)) {
      return { action: 'link_code', code: trimmed };
    }
    return { action: 'ignore' };
  }

  const chatId = String(settings?.chatId ?? '').trim();
  const topicId = settings?.topicId;
  if (!chatId || topicId == null) return { action: 'ignore' };
  if (String(peerChatId) !== chatId) return { action: 'ignore' };
  if (Number(threadId) !== Number(topicId)) return { action: 'ignore' };

  const isUserbotSelf = String(senderId) === String(selfId);
  const id = telegramMessageId == null || telegramMessageId === '' ? '' : String(telegramMessageId);
  const originatedByOutbox = Boolean(id && knownOutboxTelegramIds?.has(id));
  return { action: 'topic_inbound', originatedByOutbox, isUserbotSelf };
}
