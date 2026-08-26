import { guessUploadFileName } from '../outbound.js';

const LINK_CODE_RE = /^[A-Za-z0-9]{8}$/;

/**
 * GramJS uses `buffer.name` for upload filename / photo-vs-document detection.
 * @param {Buffer} fileBuffer
 * @param {string | undefined} filename
 * @param {string | undefined} mime
 */
function prepareUploadBuffer(fileBuffer, filename, mime) {
  const buf = Buffer.isBuffer(fileBuffer) ? fileBuffer : Buffer.from(fileBuffer);
  buf.name = String(filename ?? '').trim() || guessUploadFileName('', mime);
  return buf;
}
const OUTBOX_CAP = 500;
const knownOutboxOrder = [];

/** Module-scope outbox ids for classify `originatedByOutbox`. */
export const knownOutboxTelegramIds = new Set();

/**
 * @param {string | number} id
 */
export function rememberOutboxTelegramId(id) {
  const s = String(id);
  if (!s || knownOutboxTelegramIds.has(s)) return;
  knownOutboxTelegramIds.add(s);
  knownOutboxOrder.push(s);
  while (knownOutboxTelegramIds.size > OUTBOX_CAP) {
    const oldest = knownOutboxOrder.shift();
    if (oldest != null) knownOutboxTelegramIds.delete(oldest);
  }
}

function formatCaption(authorLabel, body) {
  const label = String(authorLabel ?? '');
  const text = String(body ?? '');
  if (!text) return label;
  return `${label}: ${text}`;
}

/**
 * @param {{
 *   client: { sendMessage: Function, sendFile: Function },
 *   chatId: string,
 *   threadId: number,
 *   authorLabel?: string,
 *   kind?: string,
 *   body?: string,
 *   fileBuffer?: Buffer,
 *   filename?: string,
 *   mime?: string,
 * }} opts
 * @returns {Promise<string>}
 */
export async function sendTopicMessage({
  client,
  chatId,
  threadId,
  authorLabel,
  kind,
  body,
  fileBuffer,
  filename,
  mime,
}) {
  const caption = formatCaption(authorLabel, body);
  const replyTo = threadId;
  const useFile = Boolean(fileBuffer) && kind !== 'text';
  const result = useFile
    ? await client.sendFile(chatId, {
        file: prepareUploadBuffer(fileBuffer, filename, mime),
        caption,
        replyTo,
        forceDocument: false,
      })
    : await client.sendMessage(chatId, { message: caption, replyTo });
  return String(result.id);
}

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
