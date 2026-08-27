import { NewMessage } from 'telegram/events/index.js';
import { config } from '../../config.js';
import { getDb } from '../../db/connection.js';
import { teamAppConsumeLink, teamAppIngest } from '../team-app-client.js';
import { getTeamAppMirrorSettings } from '../team-app-mirror-settings.js';
import { guessUploadFileName } from '../outbound.js';
import { onUserbotClientReady } from './client.js';
import { getSelfUserId } from './actions.js';
import { normalizePeerChatId } from './mention-forward.js';

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

function extractSenderId(message) {
  const from = message?.fromId;
  if (from?.userId != null) return String(from.userId);
  if (message?.senderId != null) return String(message.senderId);
  return '';
}

function messageText(message) {
  return String(message?.message ?? message?.text ?? '');
}

function hasMedia(message) {
  const media = message?.media;
  if (!media) return false;
  return media.className !== 'MessageMediaEmpty';
}

function mediaKind(message) {
  const cls = String(message?.media?.className ?? '');
  if (cls.includes('Photo') || message?.photo) return 'photo';
  if (cls.includes('Voice') || message?.voice) return 'voice';
  return 'file';
}

function linkReplyText(result) {
  if (result?.ok) return 'Telegram подключён';
  if (result?.reason === 'taken') return 'этот Telegram уже привязан';
  return 'код не подошёл, открой Настройки ещё раз';
}

async function resolveDisplayName(message) {
  try {
    const sender = await message.getSender?.();
    const name = [sender?.firstName, sender?.lastName].filter(Boolean).join(' ').trim();
    if (name) return name;
    if (sender?.username) return sender.username;
  } catch {
    // best-effort
  }
  return extractSenderId(message);
}

async function downloadMessageMedia(message, deps) {
  if (typeof deps.downloadMedia === 'function') {
    return deps.downloadMedia(message);
  }
  if (typeof message.downloadMedia === 'function') {
    return message.downloadMedia();
  }
  throw new Error('downloadMedia unavailable');
}

function attachmentFromDownload(downloaded, kind) {
  const buf = Buffer.isBuffer(downloaded) ? downloaded : Buffer.from(downloaded);
  const filename =
    buf.name || guessUploadFileName('', kind === 'photo' ? 'image/jpeg' : '');
  return {
    filename,
    mime: kind === 'photo' ? 'image/jpeg' : 'application/octet-stream',
    bytesBase64: buf.toString('base64'),
  };
}

/**
 * @param {{
 *   db: import('better-sqlite3').Database,
 *   client: { sendMessage?: Function, getMe?: Function },
 *   message: object,
 *   deps?: object,
 * }} input
 */
export async function handleUserbotNewMessage({ db, client, message, deps = {} }) {
  const normalize = deps.normalizePeerChatId ?? normalizePeerChatId;
  const classify = deps.classify ?? classifyUserbotMessage;
  const getSettings = deps.getSettings ?? getTeamAppMirrorSettings;
  const getSelf = deps.getSelfUserId ?? getSelfUserId;
  const consumeLink =
    deps.consumeLink ??
    ((payload) => teamAppConsumeLink(config, payload));
  const ingest = deps.ingest ?? ((body) => teamAppIngest(config, body));
  const reply =
    deps.reply ??
    ((peer, text) => client.sendMessage(peer, { message: text }));
  const shouldHint = deps.shouldHint ?? (() => true);

  const peerChatId = normalize(message?.peerId);
  const threadId = message?.replyTo?.replyToMsgId ?? null;
  const text = messageText(message);
  const senderId = extractSenderId(message);
  const selfId = await getSelf(client);
  const settings = getSettings(db);

  const classified = classify({
    peerChatId,
    threadId,
    senderId,
    selfId,
    text,
    settings,
    knownOutboxTelegramIds: deps.knownOutboxTelegramIds ?? knownOutboxTelegramIds,
    telegramMessageId: message?.id,
  });

  if (classified.action === 'link_code') {
    const result = await consumeLink({ code: classified.code, telegramUserId: senderId });
    await reply(senderId, linkReplyText(result));
    return { action: 'link_code' };
  }

  if (classified.action === 'topic_inbound') {
    let body = text;
    let kind = 'text';
    let attachments;
    if (hasMedia(message)) {
      kind = mediaKind(message);
      try {
        const downloaded = await downloadMessageMedia(message, deps);
        if (downloaded == null) throw new Error('empty media');
        attachments = [attachmentFromDownload(downloaded, kind)];
      } catch {
        kind = 'text';
        attachments = undefined;
        body = [text.trim(), 'файл не загрузился'].filter(Boolean).join(' ');
      }
    }
    await ingest({
      telegramMessageId: String(message?.id ?? ''),
      telegramUserId: senderId,
      telegramDisplayName: await resolveDisplayName(message),
      kind,
      body,
      isUserbotSelf: classified.isUserbotSelf,
      originatedByOutbox: classified.originatedByOutbox,
      ...(attachments ? { attachments } : {}),
    });
    return { action: 'topic_inbound' };
  }

  const isPrivate = peerChatId == null || peerChatId === '';
  if (isPrivate && text.trim() && shouldHint(senderId)) {
    await reply(senderId, 'отправь код из Настроек');
  }
  return { action: 'ignore' };
}

const attachedClients = new WeakSet();

/**
 * Registers the Team App mirror NewMessage handler on every userbot client.
 */
export function initTeamAppMirror(deps = {}) {
  const register = deps.onClientReady ?? onUserbotClientReady;
  register((client) => {
    if (attachedClients.has(client)) return;
    attachedClients.add(client);
    client.addEventHandler(
      async (event) => {
        try {
          const db = deps.getDb?.() ?? getDb();
          await handleUserbotNewMessage({ client, db, message: event.message, deps });
        } catch (err) {
          console.error('[telegram] team app mirror error:', err.message);
        }
      },
      new NewMessage({ incoming: true }),
    );
  });
}
