import { getDb } from '../../db/connection.js';
import { requireTwentyConfig } from '../../services/twenty-config.js';
import { createTwentyGqlClient } from '../../services/twenty-gql.js';
import { getDigestDayMeta } from '../digest/dates.js';
import {
  getBannerPodryadHour,
  getTelegramBotToken,
  getTelegramDestination,
} from '../settings.js';
import { findSendForLoadDate, hashOkleykaPayload, insertSendLog } from '../send-log.js';
import { extractBookingId } from './booking.js';
import { fetchBannerPodryadDayData } from './fetch.js';
import { isBannerPodryadReminderItem } from './item.js';
import { renderBannerPodryadMessage } from './render.js';
import { sendBannerPodryadText } from './send-bot.js';
import { shouldCatchUp } from './window.js';

export const BANNER_PODRYAD_EVENT = 'banner_podryad.evening';
/** HTTP catch-up waits 45s then runCatchUpSweep. */
const CATCH_UP_DEBOUNCE_MS = 45_000;

const pendingIds = new Set();
let catchUpTimer = null;

function destAndToken(db) {
  const dest = getTelegramDestination(db, BANNER_PODRYAD_EVENT);
  const token = getTelegramBotToken(db);
  if (!dest?.chatId || !token) {
    console.log('[banner-podryad] skipped: destination or bot token not configured');
    return { skipped: true };
  }
  return { dest, token };
}

function collectReminderItems(deals, lineItemsByOppId, allowedIds) {
  const allow = allowedIds?.length ? new Set(allowedIds) : null;
  const items = [];
  for (const deal of deals ?? []) {
    if (!deal?.stage || deal.stage === 'OTMENA') continue;
    const booking = extractBookingId(deal.name);
    for (const li of lineItemsByOppId[deal.id] ?? []) {
      if (allow && !allow.has(li.id)) continue;
      if (!isBannerPodryadReminderItem(li)) continue;
      items.push({
        id: li.id,
        opportunityId: deal.id,
        name: li.name,
        booking,
      });
    }
  }
  return items;
}

function dropLogged(db, items, loadDateYmd) {
  return items.filter((item) => !findSendForLoadDate(db, BANNER_PODRYAD_EVENT, item.id, loadDateYmd));
}

async function fetchDay(now, offsetDays) {
  const meta = getDigestDayMeta(offsetDays, now);
  const { apiUrl, apiToken } = requireTwentyConfig();
  const gqlClient = createTwentyGqlClient(apiUrl, apiToken);
  const raw = await fetchBannerPodryadDayData(gqlClient, { gte: meta.gte, lt: meta.lt });
  return { meta, raw };
}

async function sendAndLog({ db, dest, token, mode, loadDateYmd, items }) {
  if (!items.length) return { ok: true, sent: false };

  const text = renderBannerPodryadMessage({
    mode,
    loadDateYmd,
    items: items.map((item) => ({ booking: item.booking, name: item.name })),
  });
  if (!text) return { ok: true, sent: false };

  const result = await sendBannerPodryadText({
    token,
    chatId: dest.chatId,
    threadId: dest.threadId ?? null,
    text,
  });

  const messageId = result?.message_id;
  for (const item of items) {
    insertSendLog(db, {
      event: BANNER_PODRYAD_EVENT,
      lineItemId: item.id,
      opportunityId: item.opportunityId,
      chatId: dest.chatId,
      sentBy: 'bot',
      payloadHash: hashOkleykaPayload(text, []),
      telegramMessageIds: messageId != null ? [messageId] : [],
      loadDate: loadDateYmd,
    });
  }
  return { ok: true, sent: true };
}

export async function runEveningBatch({ db, now = new Date() }) {
  const cfg = destAndToken(db);
  if (cfg.skipped) return { skipped: true };

  const { meta, raw } = await fetchDay(now, 1);
  const items = dropLogged(
    db,
    collectReminderItems(raw.deals, raw.lineItemsByOppId),
    meta.inputDate,
  );
  return sendAndLog({
    db,
    dest: cfg.dest,
    token: cfg.token,
    mode: 'evening',
    loadDateYmd: meta.inputDate,
    items,
  });
}

export async function runCatchUpSweep({ db, now = new Date(), lineItemIds } = {}) {
  const cfg = destAndToken(db);
  if (cfg.skipped) return { skipped: true };

  const hour = getBannerPodryadHour(db);
  const todayMeta = getDigestDayMeta(0, now);
  const tomorrowMeta = getDigestDayMeta(1, now);
  const todayYmd = todayMeta.inputDate;
  const tomorrowYmd = tomorrowMeta.inputDate;

  const days = [];
  for (const offsetDays of [0, 1]) {
    const { meta, raw } = await fetchDay(now, offsetDays);
    if (
      !shouldCatchUp({
        loadDateYmd: meta.inputDate,
        todayYmd,
        tomorrowYmd,
        now,
        hour,
      })
    ) {
      continue;
    }
    const items = dropLogged(
      db,
      collectReminderItems(raw.deals, raw.lineItemsByOppId, lineItemIds),
      meta.inputDate,
    );
    days.push({ loadDateYmd: meta.inputDate, items });
  }

  let sent = false;
  for (const day of days) {
    const result = await sendAndLog({
      db,
      dest: cfg.dest,
      token: cfg.token,
      mode: 'catchup',
      loadDateYmd: day.loadDateYmd,
      items: day.items,
    });
    if (result.sent) sent = true;
  }
  return { ok: true, sent };
}

export function queueBannerPodryadCatchUp(lineItemIds, opts = {}) {
  for (const id of lineItemIds ?? []) {
    if (id) pendingIds.add(id);
  }
  if (catchUpTimer) clearTimeout(catchUpTimer);
  catchUpTimer = setTimeout(() => {
    const ids = [...pendingIds];
    pendingIds.clear();
    catchUpTimer = null;
    if (!ids.length) return;
    const db = opts.db ?? getDb();
    runCatchUpSweep({ db, now: opts.now ?? new Date(), lineItemIds: ids }).catch((err) => {
      console.error('[banner-podryad] catch-up error:', err.message);
    });
  }, CATCH_UP_DEBOUNCE_MS);
}
