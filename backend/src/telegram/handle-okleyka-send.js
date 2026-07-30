import { getTelegramBotToken, getTelegramChatId } from './settings.js';
import {
  findLastSend,
  hashOkleykaPayload,
  insertSendLog,
} from './send-log.js';
import { sendOkleykaToTelegram } from './outbound.js';
import { patchOkleykaTelegramFields } from './crm-log.js';

function resolveSentBy(sentBy) {
  if (!sentBy) return null;
  if (typeof sentBy === 'string') return sentBy;
  return sentBy.name ?? sentBy.id ?? null;
}

function validationError(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function configError(message) {
  const err = new Error(message);
  err.status = 503;
  return err;
}

export async function handleOkleykaSend(db, body, deps = {}) {
  const sendOkleyka = deps.sendOkleykaToTelegram ?? sendOkleykaToTelegram;
  const patchFields = deps.patchOkleykaTelegramFields ?? patchOkleykaTelegramFields;

  const event = body?.event;
  const lineItemId = body?.lineItemId;
  const text = body?.text;
  const fileUrls = Array.isArray(body?.fileUrls) ? body.fileUrls : [];
  const force = Boolean(body?.force);

  if (event !== 'okleyka.send') {
    throw validationError(`Unsupported event: ${event}`);
  }
  if (!lineItemId || typeof lineItemId !== 'string') {
    throw validationError('lineItemId required');
  }
  if (typeof text !== 'string') {
    throw validationError('text required');
  }

  const token = getTelegramBotToken(db);
  const chatId = getTelegramChatId(db, event);
  if (!token || !chatId) {
    throw configError('Telegram не настроен');
  }

  const existing = findLastSend(db, event, lineItemId);
  if (existing && !force) {
    return {
      ok: false,
      alreadySent: true,
      lastSentAt: existing.created_at,
    };
  }

  const sendResult = await sendOkleyka({
    token,
    chatId,
    text,
    fileUrls,
  });

  const loggedAt = new Date().toISOString();
  insertSendLog(db, {
    event,
    lineItemId,
    opportunityId: body?.opportunityId,
    chatId,
    sentBy: resolveSentBy(body?.sentBy),
    payloadHash: hashOkleykaPayload(text, fileUrls),
    telegramMessageIds: sendResult.messageIds,
  });

  let warning = sendResult.warning;
  try {
    await patchFields({
      lineItemId,
      sentAt: loggedAt,
      sentBy: resolveSentBy(body?.sentBy),
      chatId,
    });
  } catch (err) {
    console.error('[telegram] CRM patch failed:', err.message);
    warning = 'crm_patch_failed';
  }

  return {
    ok: true,
    messageIds: sendResult.messageIds,
    loggedAt,
    ...(warning ? { warning } : {}),
  };
}
