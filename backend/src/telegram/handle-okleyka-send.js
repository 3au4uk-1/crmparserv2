import { getTelegramDestination } from './settings.js';
import { findLastSend } from './send-log.js';
import { isUserbotConfigured } from './userbot/client.js';
import { enqueueOkleykaJob } from './okleyka-outbox.js';
import { kickOkleykaDrain } from './okleyka-drain.js';

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
  const configured = deps.isUserbotConfigured ?? (() => isUserbotConfigured(db));

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

  const dest = getTelegramDestination(db, event);
  if (!configured() || !dest?.chatId) {
    throw configError('Telegram не настроен (нужен user-bot и чат оклейки)');
  }

  const existing = findLastSend(db, event, lineItemId);
  if (existing && !force) {
    return {
      ok: false,
      alreadySent: true,
      lastSentAt: existing.created_at,
    };
  }

  const job = enqueueOkleykaJob(db, {
    lineItemId,
    opportunityId: body?.opportunityId,
    text,
    fileUrls,
    sentBy: resolveSentBy(body?.sentBy),
    force,
  });
  console.log(`[telegram] okleyka queued job=${job.id} lineItem=${lineItemId}`);
  const kick = deps.kickOkleykaDrain ?? kickOkleykaDrain;
  void kick(db).catch((err) => console.error('[telegram] okleyka drain kick:', err.message));
  return { ok: true, queued: true, jobId: job.id, status: job.status };
}
