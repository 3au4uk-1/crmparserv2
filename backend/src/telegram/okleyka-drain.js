import { getTelegramDestination as getTelegramDestinationDefault } from './settings.js';
import {
  findLastSend as findLastSendDefault,
  hashOkleykaPayload as hashOkleykaPayloadDefault,
  insertSendLog as insertSendLogDefault,
} from './send-log.js';
import { sendOkleykaToTelegram as sendOkleykaToTelegramDefault } from './outbound.js';
import { patchOkleykaTelegramFields as patchOkleykaTelegramFieldsDefault } from './crm-log.js';
import {
  getUserbotClient as getUserbotClientDefault,
  isUserbotConfigured as isUserbotConfiguredDefault,
} from './userbot/client.js';
import { createWrapOkleykaTask as createWrapOkleykaTaskDefault } from './create-wrap-task.js';
import {
  claimNextOkleykaJob,
  completeOkleykaJob,
  failOkleykaJob,
  recoverStaleOkleykaSending,
  retryOkleykaJob,
} from './okleyka-outbox.js';
import {
  classifyOkleykaError,
  isTransportError,
  retryDelaySeconds,
} from './okleyka-errors.js';

export const OKLEYKA_DRAIN_TICKER_MS = 30_000;

let drainInFlight = null;
/** @type {Set<ReturnType<typeof setTimeout>>} */
const delayedKickTimers = new Set();
/** @type {ReturnType<typeof setInterval> | undefined} */
let drainTicker;

export function __resetOkleykaDrainForTests() {
  drainInFlight = null;
  for (const timer of delayedKickTimers) {
    clearTimeout(timer);
  }
  delayedKickTimers.clear();
  if (drainTicker) {
    clearInterval(drainTicker);
    drainTicker = undefined;
  }
}

function defaultScheduleDelayedKick(db, delayMs, kickDeps) {
  const timer = setTimeout(() => {
    delayedKickTimers.delete(timer);
    void kickOkleykaDrain(db, kickDeps).catch((err) =>
      console.error('[telegram] okleyka drain kick:', err.message),
    );
  }, delayMs);
  if (typeof timer?.unref === 'function') timer.unref();
  delayedKickTimers.add(timer);
}

function resolveDeps(db, deps) {
  return {
    getUserbotClient:
      deps.getUserbotClient ?? ((database) => getUserbotClientDefault(database)),
    isUserbotConfigured:
      deps.isUserbotConfigured ?? (() => isUserbotConfiguredDefault(db)),
    sendOkleykaToTelegram: deps.sendOkleykaToTelegram ?? sendOkleykaToTelegramDefault,
    getTelegramDestination:
      deps.getTelegramDestination ?? getTelegramDestinationDefault,
    insertSendLog: deps.insertSendLog ?? insertSendLogDefault,
    hashOkleykaPayload: deps.hashOkleykaPayload ?? hashOkleykaPayloadDefault,
    findLastSend: deps.findLastSend ?? findLastSendDefault,
    patchOkleykaTelegramFields:
      deps.patchOkleykaTelegramFields ?? patchOkleykaTelegramFieldsDefault,
    createWrapOkleykaTask: deps.createWrapOkleykaTask ?? createWrapOkleykaTaskDefault,
    scheduleUserbotReconnect: deps.scheduleUserbotReconnect ?? (() => {}),
    scheduleDelayedKick: deps.scheduleDelayedKick ?? defaultScheduleDelayedKick,
    now: deps.now ?? (() => new Date().toISOString()),
  };
}

function parseFileUrls(job) {
  try {
    const parsed = JSON.parse(job.file_urls_json ?? '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function handleJobFailure(db, job, err, deps, kickDeps) {
  const message = String(err?.message ?? err ?? '');
  const download4xx = /download failed: HTTP 4\d\d/i.test(message);
  const kind =
    download4xx && job.attempt_count + 1 < 3
      ? 'transient'
      : classifyOkleykaError(err);

  if (kind === 'transient') {
    console.log(`[telegram] okleyka drain transient job=${job.id}: ${message}`);
    const delaySeconds = retryDelaySeconds(job.attempt_count + 1);
    retryOkleykaJob(db, job.id, {
      error: message,
      delaySeconds,
    });
    deps.scheduleDelayedKick(db, delaySeconds * 1000, kickDeps);
    if (isTransportError(err)) {
      deps.scheduleUserbotReconnect(db, message);
    }
    return;
  }

  console.error(`[telegram] okleyka drain failed job=${job.id}: ${message}`);
  failOkleykaJob(db, job.id, message);
}

async function processOkleykaJob(db, job, deps, kickDeps) {
  try {
    const dest = deps.getTelegramDestination(db, 'okleyka.send');
    if (!dest?.chatId || !deps.isUserbotConfigured()) {
      const error = dest?.chatId ? 'userbot not configured' : 'destination missing';
      failOkleykaJob(db, job.id, error);
      return;
    }

    const force = Boolean(job.force);
    const lineItemId = job.line_item_id;
    if (!force && deps.findLastSend(db, 'okleyka.send', lineItemId)) {
      completeOkleykaJob(db, job.id);
      return;
    }

    const client = await deps.getUserbotClient(db);
    const fileUrls = parseFileUrls(job);
    const sendResult = await deps.sendOkleykaToTelegram({
      client,
      chatId: dest.chatId,
      threadId: dest.threadId,
      text: job.text,
      fileUrls,
    });

    deps.insertSendLog(db, {
      event: 'okleyka.send',
      lineItemId,
      opportunityId: job.opportunity_id,
      chatId: dest.chatId,
      sentBy: job.sent_by,
      payloadHash: deps.hashOkleykaPayload(job.text, fileUrls),
      telegramMessageIds: sendResult.messageIds,
    });

    try {
      await deps.patchOkleykaTelegramFields({
        lineItemId,
        sentAt: deps.now(),
        sentBy: job.sent_by,
        chatId: dest.chatId,
      });
    } catch (err) {
      console.error('[telegram] CRM patch failed:', err.message);
    }

    try {
      await deps.createWrapOkleykaTask({
        lineItemId,
        opportunityId: job.opportunity_id,
        text: job.text,
        fileUrls,
        force,
      });
    } catch (err) {
      console.error('[telegram] wrap task failed:', err.message);
    }

    completeOkleykaJob(db, job.id, { warning: sendResult.warning });
    if (sendResult.warning) {
      console.log(`[telegram] okleyka drain sent job=${job.id}: ${sendResult.warning}`);
    } else {
      console.log(`[telegram] okleyka drain sent job=${job.id}`);
    }
  } catch (err) {
    handleJobFailure(db, job, err, deps, kickDeps);
  }
}

export async function runOkleykaDrain(db, deps = {}) {
  const resolved = resolveDeps(db, deps);
  while (true) {
    const job = claimNextOkleykaJob(db);
    if (!job) return;
    await processOkleykaJob(db, job, resolved, deps);
  }
}

export async function kickOkleykaDrain(db, deps = {}) {
  if (drainInFlight) return drainInFlight;
  drainInFlight = runOkleykaDrain(db, deps).finally(() => {
    drainInFlight = null;
  });
  await drainInFlight;
}

export function initOkleykaDrainTicker(db, deps = {}) {
  if (drainTicker) clearInterval(drainTicker);
  drainTicker = setInterval(() => {
    try {
      recoverStaleOkleykaSending(db);
    } catch (err) {
      console.error('[telegram] okleyka recover stale:', err.message);
    }
    void kickOkleykaDrain(db, deps).catch((err) =>
      console.error('[telegram] okleyka drain kick:', err.message),
    );
  }, OKLEYKA_DRAIN_TICKER_MS);
  if (typeof drainTicker?.unref === 'function') drainTicker.unref();
}
