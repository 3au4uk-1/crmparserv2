import { config } from '../../config.js';
import { createTwentyGqlClient } from '../../services/twenty-gql.js';
import { callTelegram as defaultCallTelegram } from '../api-client.js';
import { getTelegramBotToken } from '../settings.js';
import { collectAlbumMessage } from './album.js';
import { buildAcceptedText, buildCreateFailedText, buildRefusalText } from './copy.js';
import {
  classifyTelegramFile,
  downloadTelegramFile as defaultDownload,
  resolveTelegramRequestFilesFieldMetadataId as defaultResolveRequestFilesFieldMetadataId,
  uploadRequestFile as defaultUpload,
} from './files.js';
import { matchOpportunity as defaultMatch } from './match-deal.js';
import { messageMentionsBot } from './mention.js';
import { parseWorkRequestForm } from './parse-form.js';
import { findSlot } from './slots.js';
import {
  deleteWorkRequestLink,
  getWorkRequestLinkByAlbum,
  insertWorkRequestLink,
  updateWorkRequestLink,
} from './store.js';
import { createTelegramRequest as defaultCreate, telegramMessageUrl } from './twenty.js';

const albums = new Map();

export async function getBotUsername(db, { token, callTelegram = defaultCallTelegram } = {}) {
  const cached = db
    .prepare(`SELECT value FROM settings WHERE key = 'telegram_bot_username'`)
    .get()?.value?.trim();
  if (cached) return cached;
  const botToken = token || getTelegramBotToken(db);
  if (!botToken) return '';
  const username = String((await callTelegram(botToken, 'getMe', {}))?.username ?? '').trim();
  if (username) {
    db.prepare(
      `INSERT OR REPLACE INTO settings (key, value) VALUES ('telegram_bot_username', ?)`,
    ).run(username);
  }
  return username;
}

function collectAttachments(messages) {
  return messages.flatMap((message) => {
    const result = [];
    const photo = message.photo?.at(-1);
    if (photo) {
      result.push({
        type: 'photo',
        fileId: photo.file_id,
        fileUniqueId: photo.file_unique_id,
        fileSize: photo.file_size,
        filename: `photo-${photo.file_unique_id || photo.file_id}.jpg`,
      });
    }
    const document = message.document;
    if (document) {
      result.push({
        type: 'document',
        fileId: document.file_id,
        fileUniqueId: document.file_unique_id,
        fileSize: document.file_size,
        filename: document.file_name || 'document',
      });
    }
    return result;
  });
}

function fullName(from) {
  return [from?.first_name, from?.last_name].filter(Boolean).join(' ');
}

function reply(chatId, threadId, messageId, text) {
  return {
    chat_id: chatId,
    message_thread_id: threadId,
    reply_to_message_id: messageId,
    text,
  };
}

function fileMarker(file) {
  return `telegram-file:${file.fileUniqueId || file.fileId} ${file.filename}`;
}

async function prepareFiles(files, sourceUrl, deps) {
  const requestFiles = [];
  const unavailable = [];
  for (const file of files) {
    try {
      if (
        file.fileSize != null
        && classifyTelegramFile({ fileSize: file.fileSize }) === 'link'
      ) {
        unavailable.push(fileMarker(file));
        continue;
      }
      const downloaded = await deps.downloadTelegramFile({
        token: deps.token,
        fileId: file.fileId,
        callTelegram: deps.callTelegram,
      });
      if (classifyTelegramFile(downloaded) === 'link') {
        unavailable.push(fileMarker(file));
        continue;
      }
      const fieldMetadataId = await deps.resolveRequestFilesFieldMetadataId({
        apiUrl: config.twentyApiUrl,
        apiToken: config.twentyApiToken,
      });
      const uploaded = await deps.uploadRequestFile({
        ...downloaded,
        filename: file.filename || downloaded.filename,
        fieldMetadataId,
        apiUrl: config.twentyApiUrl,
        apiToken: config.twentyApiToken,
      });
      requestFiles.push({ fileId: uploaded.fileId, label: file.filename || downloaded.filename });
    } catch (error) {
      console.error('Failed to upload Telegram work request file', error);
      unavailable.push(fileMarker(file));
    }
  }
  return {
    requestFiles,
    largeFileUrls: unavailable.length ? [...unavailable, sourceUrl].join('\n') : null,
  };
}

export async function handleWorkRequestInbound({ db, update, deps = {} }) {
  const message = update?.message;
  if (!message?.chat || message.from?.is_bot) return { handled: false };

  const chatId = String(message.chat.id);
  const threadId = message.message_thread_id;
  const slot = findSlot(db, chatId, threadId);
  if (!slot) return { handled: false };

  const token = deps.token || getTelegramBotToken(db);
  const callTelegram = deps.callTelegram ?? defaultCallTelegram;
  const botUsername = await (
    deps.getBotUsername ?? (() => getBotUsername(db, { token, callTelegram }))
  )();

  const messages = await collectAlbumMessage(albums, message, {
    now: deps.clock ?? (() => Date.now()),
  });
  if (!messages.some((item) => messageMentionsBot(item, botUsername))) {
    return { handled: false };
  }
  const orderedMessages = [...messages].sort(
    (left, right) => Number(left.message_id) - Number(right.message_id),
  );
  const source = orderedMessages[0];
  if (source.media_group_id && message.message_id !== source.message_id) {
    return { handled: true, action: 'album_follower' };
  }
  if (
    source.media_group_id
    && getWorkRequestLinkByAlbum(db, chatId, source.media_group_id)
  ) {
    return { handled: true, action: 'duplicate' };
  }

  const attachments = collectAttachments(orderedMessages);
  const parsed = parseWorkRequestForm({
    text: source.text || source.caption || '',
    topicRole: slot.topicRole,
    attachments,
  });
  if (!parsed.ok) {
    await callTelegram(
      token,
      'sendMessage',
      reply(chatId, threadId, source.message_id, buildRefusalText(parsed.missing)),
    );
    return { handled: true, action: 'refused' };
  }

  const link = insertWorkRequestLink(db, {
    chatId,
    threadId,
    sourceMessageId: source.message_id,
    mediaGroupId: source.media_group_id,
    requesterUserId: source.from?.id != null ? String(source.from.id) : null,
    requesterUsername: source.from?.username ?? null,
    requesterName: fullName(source.from),
  });
  if (!link.created) return { handled: true, action: 'duplicate' };

  const sourceUrl = telegramMessageUrl(chatId, source.message_id);
  const fileData = await prepareFiles(attachments, sourceUrl, {
    token,
    callTelegram,
    downloadTelegramFile: deps.downloadTelegramFile ?? defaultDownload,
    resolveRequestFilesFieldMetadataId:
      deps.resolveRequestFilesFieldMetadataId ?? defaultResolveRequestFilesFieldMetadataId,
    uploadRequestFile: deps.uploadRequestFile ?? defaultUpload,
  });
  const gql = deps.gql ?? createTwentyGqlClient(config.twentyApiUrl, config.twentyApiToken);

  let twentyId;
  try {
    const opportunity = await (deps.matchOpportunity ?? defaultMatch)({
      gql,
      booking: parsed.data.booking,
      dealName: parsed.data.dealName,
    });
    twentyId = await (deps.createTelegramRequest ?? defaultCreate)(gql, {
      name: `Запрос #${link.requestNumber}`,
      requestNumber: link.requestNumber,
      stage: 'NEW',
      kind: parsed.data.kind,
      company: slot.companyLabel,
      requesterName: fullName(source.from),
      requesterUsername: source.from?.username ?? null,
      telegramMessageUrl: sourceUrl,
      brief: parsed.data.brief,
      booking: parsed.data.booking,
      opportunityId: opportunity?.id ?? null,
      positionName: parsed.data.positionName,
      logoOrBrandUrl: parsed.data.logoOrBrandUrl,
      layoutsUrl: parsed.data.layoutsUrl,
      reviewAction: parsed.data.reviewAction,
      largeFileUrls: fileData.largeFileUrls,
      requestFiles: fileData.requestFiles,
    });
  } catch {
    deleteWorkRequestLink(db, link.id);
    await callTelegram(
      token,
      'sendMessage',
      reply(chatId, threadId, source.message_id, buildCreateFailedText()),
    );
    return { handled: true, action: 'create_failed' };
  }

  updateWorkRequestLink(db, link.id, { twentyId });
  try {
    const sent = await callTelegram(
      token,
      'sendMessage',
      reply(chatId, threadId, source.message_id, buildAcceptedText(link.requestNumber)),
    );
    updateWorkRequestLink(db, link.id, { botMessageId: sent?.message_id ?? null });
  } catch (error) {
    console.error('Failed to send Telegram work request accepted message', error);
    updateWorkRequestLink(db, link.id, { botMessageId: null });
  }
  return { handled: true, action: 'accepted' };
}
