import { callTelegram } from '../api-client.js';
import { getTelegramBotToken, getTelegramDestination } from '../settings.js';
import { requireTwentyConfig } from '../../services/twenty-config.js';
import { createTwentyGqlClient } from '../../services/twenty-gql.js';
import { getDigestDayMeta } from './dates.js';
import { fetchDigestDayData } from './fetch.js';
import { buildDigestModel } from './compute.js';
import { renderDigestMessage } from './render.js';

export async function runDigestForDay({
  db,
  offsetDays,
  chatId,
  threadId = null,
  now = new Date(),
}) {
  const token = getTelegramBotToken(db);
  if (!token) return { ok: false, skipped: true, error: 'no bot token' };
  const targetChatId = chatId || getTelegramDestination(db, 'digest.morning')?.chatId;
  if (!targetChatId) return { ok: false, skipped: true, error: 'no chat' };

  const meta = getDigestDayMeta(offsetDays, now);
  const { apiUrl, apiToken } = requireTwentyConfig();
  const gqlClient = createTwentyGqlClient(apiUrl, apiToken);
  const raw = await fetchDigestDayData(gqlClient, { gte: meta.gte, lt: meta.lt });
  const model = buildDigestModel(raw);
  const text = renderDigestMessage(model, {
    title: meta.title,
    dateLabel: meta.dateLabel,
  });

  const body = { chat_id: targetChatId, text };
  const destThread =
    threadId ?? getTelegramDestination(db, 'digest.morning')?.threadId ?? null;
  if (chatId == null && destThread != null) body.message_thread_id = destThread;
  if (chatId != null && threadId != null) body.message_thread_id = threadId;

  await callTelegram(token, 'sendMessage', body);
  return { ok: true, text };
}

export async function runMorningDigests({ db, now = new Date() }) {
  const dest = getTelegramDestination(db, 'digest.morning');
  if (!dest?.chatId) {
    console.log('[digest] skipped: digest.morning not configured');
    return { skipped: true };
  }
  for (const offsetDays of [1, 2]) {
    try {
      await runDigestForDay({
        db,
        offsetDays,
        chatId: dest.chatId,
        threadId: dest.threadId,
        now,
      });
    } catch (err) {
      console.error(`[digest] offset=${offsetDays} failed:`, err.message);
    }
  }
  return { skipped: false };
}
