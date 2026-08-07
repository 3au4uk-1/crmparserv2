import { getTelegramDestination } from '../settings.js';
import { getUserbotClient, isUserbotConfigured } from '../userbot/client.js';
import { sendDigestText } from './send.js';
import { requireTwentyConfig } from '../../services/twenty-config.js';
import { createTwentyGqlClient } from '../../services/twenty-gql.js';
import { getDigestDayMeta } from './dates.js';
import { fetchDigestDayData } from './fetch.js';
import { buildDigestModel } from './compute.js';
import { renderDigestMessage } from './render.js';
import { pickOmniCandidates, applyOmniEnrichment } from './omni-merge.js';
import { getDigestOmniConfig } from './omni-settings.js';
import { enrichDigestWithOmni } from './omni.js';

export async function runDigestForDay({
  db,
  offsetDays,
  chatId,
  threadId = null,
  now = new Date(),
  deps = {},
}) {
  const configured = deps.isUserbotConfigured ?? isUserbotConfigured;
  const getClient = deps.getUserbotClient ?? getUserbotClient;
  const send = deps.sendDigestText ?? sendDigestText;

  if (!configured(db)) {
    console.log('[digest] skipped: user-bot not configured');
    return { ok: false, skipped: true, error: 'no userbot' };
  }

  const dest = getTelegramDestination(db, 'digest.morning');
  const targetChatId = chatId || dest?.chatId;
  if (!targetChatId) return { ok: false, skipped: true, error: 'no chat' };

  const meta = getDigestDayMeta(offsetDays, now);
  const { apiUrl, apiToken } = requireTwentyConfig();
  const gqlClient = createTwentyGqlClient(apiUrl, apiToken);
  const raw = await fetchDigestDayData(gqlClient, { gte: meta.gte, lt: meta.lt });
  const model = buildDigestModel(raw, { twentyApiUrl: apiUrl });
  const candidates = pickOmniCandidates(model.risks);
  const config = getDigestOmniConfig(db);
  let omniRaw = null;
  try {
    omniRaw = await enrichDigestWithOmni({
      config,
      dayMeta: meta,
      digestModel: model,
      candidates,
    });
  } catch (err) {
    console.log(`[digest] omni enrich skipped: ${err.message}`);
  }
  const enriched = applyOmniEnrichment(model, omniRaw);
  const text = renderDigestMessage(model, {
    title: meta.title,
    dateLabel: meta.dateLabel,
    notes: enriched.notes,
    risksOverride: enriched.risks,
  });

  const destThread = threadId ?? dest?.threadId ?? null;
  const client = await getClient(db);
  await send({ client, chatId: targetChatId, threadId: destThread, text });
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
