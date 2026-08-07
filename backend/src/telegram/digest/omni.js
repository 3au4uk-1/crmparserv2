import { formatRiskTitle } from './render.js';
import { validateOmniEnrichment } from './omni-validate.js';

const SYSTEM_PROMPT = [
  'Reply with JSON only: { "risks":[{ "opportunityId","reason"}], "notes":[string] }.',
  'Use only opportunityIds from the candidates list.',
  'reason: Russian, dense, max 80 characters each.',
  'notes: max 4 lines, max 120 characters each.',
  'Do not invent amounts or ids.',
].join(' ');

function buildUserPayload({ dayMeta, digestModel, candidates }) {
  return {
    day: { title: dayMeta.title, dateLabel: dayMeta.dateLabel },
    header: {
      totalDeals: digestModel.totalDeals ?? 0,
      totalPositions: digestModel.totalPositions ?? 0,
      ready: digestModel.ready ?? {},
      notReady: digestModel.notReady ?? {},
    },
    candidates: (candidates ?? []).map((c) => ({
      opportunityId: c.opportunityId,
      title: formatRiskTitle(c),
      ready: c.ready,
      total: c.total,
      amountRubles: c.amountRubles,
      labels: c.labels ?? [],
      score: c.score,
    })),
  };
}

function parseContent(raw) {
  let text = String(raw ?? '').trim();
  if (!text) return null;
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  if (fenced) text = fenced[1].trim();
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function callOmniChat({ config, model, userPayload, fetchImpl }) {
  const resp = await fetchImpl(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      stream: false,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(userPayload) },
      ],
    }),
    signal: AbortSignal.timeout(config.timeoutMs),
  });

  if (!resp.ok) return null;
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content;
  return parseContent(content);
}

export async function enrichDigestWithOmni({
  config,
  dayMeta,
  digestModel,
  candidates,
  fetchImpl = globalThis.fetch,
}) {
  if (!config?.enabled) return null;

  const candidateIds = new Set((candidates ?? []).map((c) => String(c.opportunityId)));
  const userPayload = buildUserPayload({ dayMeta, digestModel, candidates });

  let raw = await callOmniChat({
    config,
    model: config.model,
    userPayload,
    fetchImpl,
  });

  if (raw == null && config.fallbackModel && config.fallbackModel !== config.model) {
    raw = await callOmniChat({
      config,
      model: config.fallbackModel,
      userPayload,
      fetchImpl,
    });
  }

  if (raw == null) return null;
  return validateOmniEnrichment(raw, candidateIds);
}
