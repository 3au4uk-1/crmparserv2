# Digest Omni enrichment (каркас + LLM-редактор)

**Date:** 2026-08-07  
**Status:** Approved for planning  
**Scope:** crmparserv2 Telegram morning digest + OmniRoute (`omni.dosugmayak.ru`)  
**Related:** `2026-08-06-telegram-morning-digest-design.md`

## Problem

Утренняя сводка уже даёт факты (✔️/❌, R0/R1/R2, скор). Нужна короткая нейро-аналитика и более «человечный» порядок рисков через OmniRoute, без потери стабильности цифр при сбое LLM.

## Goals / non-goals

| In (v1) | Out (v1) |
|---------|----------|
| Правила владеют шапкой и пулом кандидатов | Замена R0/R1/R2 нейросетью |
| Omni пересортировывает топ‑7 и пишет короткий `reason` | Смягчение порогов R0/R1/R2 |
| Блок `🧠` 2–4 строки | Streaming, ретраи, multi-turn |
| Fallback на текущий скор при любой ошибке Omni | Отдельный длинный аналитический отчёт |
| OpenAI-compatible `chat/completions` через OmniRoute | Коммит API-ключа в git |

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| Approach | **Каркас + LLM-редактор** (между B и C) |
| Facts owner | Rule compute (header + candidates) |
| Omni role | Reorder top risks + short reasons + notes |
| Candidate pool | R0∨R1∨R2, score↓ amount↓, **top 20** to Omni |
| Message risks | **Top 7** after Omni; fill from rules if Omni returns fewer |
| Thresholds | Unchanged from digest v1 |
| Omni base URL | `https://omni.dosugmayak.ru/v1` |
| Primary model | `oc/deepseek-v4-flash-free` |
| Fallback model | `auto` (second attempt only if first fails/empty; still one overall enrich budget — see Delivery) |
| Timeout | **10 s** per attempt |
| Auth | Bearer API key in settings/env only |
| Cron | Unchanged: `0 9 * * *` + `CRM_TIMEZONE` (`Europe/Moscow`) |
| No key / disabled | Skip Omni silently; rule-only message |

## Architecture

```
Twenty fetch
  → buildDigestModel (header + all risks)
  → pickCandidates(top 20)
  → enrichDigestWithOmni(payload)  // may return null
  → applyOmniEnrichment(model, omniResult) // reorder + reasons + notes
  → renderDigestMessage
  → Telegram
```

Modules (orientative):

| File | Role |
|------|------|
| `telegram/digest/omni.js` | HTTP client + parse raw LLM JSON |
| `telegram/digest/omni-validate.js` | Schema filter (ids in pool, lengths) |
| `telegram/digest/omni-merge.js` | Apply order/reasons/notes; fill-to-7 |
| Modify `run.js` | Call enrich between compute and render |
| Modify `render.js` | Optional `reason` on risk lines; `🧠` block |

## Message format

Unchanged header. Risks and notes:

```
⚠ РИСКИ:
• {title} · {ready}/{total} · ₽… · {labels}[ · {reason}]
…

🧠
{note1}
{note2}
```

- If Omni fails or is disabled: no `🧠` block; risks = rule score top‑7 (current behavior).
- If Omni succeeds with empty `notes`: omit `🧠`.
- `reason` appended only when non-empty after validation.

## Omni request

`POST {base}/v1/chat/completions`

Headers: `Authorization: Bearer {key}`, `Content-Type: application/json`

Body:

- `model`: primary `oc/deepseek-v4-flash-free`; on failure retry once with `auto`
- `stream`: false
- `temperature`: 0.2
- `messages`: system (schema + constraints) + user (compact day JSON)
- Prefer `response_format: { "type": "json_object" }` when accepted; else parse JSON from content

### User payload (compact)

```json
{
  "day": { "title": "ЗАВТРА", "dateLabel": "07.08" },
  "header": {
    "totalDeals": 14,
    "totalPositions": 38,
    "ready": { "deals": 6, "positions": 30, "amountRubles": 1800000 },
    "notReady": { "deals": 8, "positions": 8, "amountRubles": 2500000 }
  },
  "candidates": [
    {
      "opportunityId": "…",
      "title": "Company/Mgr/№",
      "ready": 0,
      "total": 5,
      "amountRubles": 420000,
      "labels": ["риск", "0 готово"],
      "score": 7
    }
  ]
}
```

### Expected Omni JSON

```json
{
  "risks": [{ "opportunityId": "…", "reason": "крупный, 0✓" }],
  "notes": ["узкое место: печать без готовности у топ-сумм"]
}
```

## Validation

- `risks[]`: keep only `opportunityId` present in candidate pool; first wins on duplicates.
- `reason`: string, trim, max **80** chars; empty → no reason.
- `notes[]`: max **4** items; each trim, max **120** chars; drop empties.
- After filter, if `risks` empty → treat enrich as failed for ordering (rule top‑7); notes still usable if valid.
- Fill display list to **7** using remaining candidates by rule score (excluding already chosen ids).

## Delivery / failure

| Case | Behavior |
|------|----------|
| No API key / `digest_omni_enabled=0` | Skip Omni; rule-only |
| Primary model error/timeout | One retry with model `auto` (fresh 10 s) |
| Both attempts fail / invalid JSON | Rule-only; log `[digest] omni enrich skipped: …` |
| Cron / commands | Same enrich path |

No infinite retries. Enrich must not block forever: hard ceiling ~20 s if both attempts used.

## Settings

| Key | Default | Notes |
|-----|---------|-------|
| `digest_omni_base_url` | `https://omni.dosugmayak.ru/v1` | No secrets |
| `digest_omni_api_key` | (empty) | Or env `OMNI_API_KEY` |
| `digest_omni_model` | `oc/deepseek-v4-flash-free` | Primary |
| `digest_omni_model_fallback` | `auto` | Second attempt |
| `digest_omni_enabled` | on if key present | Explicit `0` disables |

Telegram settings UI: masked key + model fields optional in v1 (env/settings row sufficient); must not log full key.

**Secrets:** never commit API keys. Keys shared in chat should be rotated in OmniRoute dashboard.

## Testing

Unit (mocked HTTP):

- Validate drops unknown ids / truncates reason & notes
- Merge: Omni order preserved; fill-to-7 from rules
- Timeout / 5xx / bad JSON → null → rule render without `🧠`
- Primary fail → fallback model called once
- Disabled / missing key → no HTTP

No live Omni calls in CI.

## Success criteria

1. With Omni configured, digest shows reordered risks and optional `🧠` notes.
2. With Omni down, message still matches digest v1 rule output (no crash).
3. Cron remains `0 9 * * *` Moscow.
4. Model attempts: `oc/deepseek-v4-flash-free` then `auto`.
5. No API key in git.
