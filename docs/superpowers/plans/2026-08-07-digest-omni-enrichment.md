# Digest Omni Enrichment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich morning digest risks via OmniRoute (reorder + short reasons + `🧠` notes) while keeping rule-based facts and falling back to current scoring when Omni fails.

**Architecture:** After `buildDigestModel`, take top-20 scored risks as candidates, call OmniRoute `POST /v1/chat/completions` (primary `oc/deepseek-v4-flash-free`, one retry with `auto`), validate/merge into top-7 + notes, then render. Missing key / timeout / bad JSON → unchanged rule-only message.

**Tech Stack:** Node ESM, Vitest, existing digest modules (`compute`, `render`, `run`), OmniRoute OpenAI-compatible HTTP API, SQLite settings + optional env.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-07-digest-omni-enrichment-design.md`
- Base URL default: `https://omni.dosugmayak.ru/v1`
- Primary model: `oc/deepseek-v4-flash-free`; fallback model: `auto`
- Timeout: 10 s per attempt; at most two attempts
- Candidate pool: top **20** by existing score; message risks: top **7**
- Reason ≤ 80 chars; notes ≤ 4 × ≤ 120 chars
- Never commit API keys; never log full key
- Cron unchanged: `0 9 * * *` + `CRM_TIMEZONE`
- No live Omni calls in CI (mock `fetch`)
- Existing R0/R1/R2 thresholds unchanged

## File map

| File | Responsibility |
|------|----------------|
| `backend/src/telegram/digest/omni-validate.js` | Parse/filter Omni JSON against candidate ids |
| `backend/src/telegram/digest/omni-merge.js` | Reorder risks, attach reasons, fill-to-7, attach notes |
| `backend/src/telegram/digest/omni-settings.js` | Resolve enabled/baseUrl/key/models from db+env |
| `backend/src/telegram/digest/omni.js` | HTTP enrich client + system/user prompt |
| Modify `backend/src/telegram/digest/render.js` | `reason` on lines; `🧠` block; accept pre-sliced risks |
| Modify `backend/src/telegram/digest/run.js` | Wire enrich between compute and render |
| Tests: `telegram-digest-omni-*.test.js` | Validate, merge, client, run integration with mocks |

---

### Task 1: Validate + merge (pure)

**Files:**
- Create: `backend/src/telegram/digest/omni-validate.js`
- Create: `backend/src/telegram/digest/omni-merge.js`
- Test: `backend/tests/telegram-digest-omni-validate.test.js`
- Test: `backend/tests/telegram-digest-omni-merge.test.js`

**Interfaces:**
- Consumes: risk objects from `buildDigestModel` (`opportunityId`, `score`, `amountRubles`, `labels`, …)
- Produces:
  - `validateOmniEnrichment(raw, candidateIds: Set<string>) → { risks: {opportunityId, reason}[], notes: string[] } | null`
  - `applyOmniEnrichment(digestModel, omniResult | null) → { risks: Risk[], notes: string[] }`
    - If `omniResult` null or empty risks after validate for ordering: `risks = digestModel.risks` (full scored list; render still slices to 7)
    - If Omni risks non-empty: order by Omni list, map to full risk objects, attach `reason`; append remaining by score until length ≥ 7 or exhausted; set `notes`
  - Constants: `OMNI_CANDIDATE_LIMIT = 20`, `OMNI_REASON_MAX = 80`, `OMNI_NOTES_MAX = 4`, `OMNI_NOTE_MAX = 120`

- [ ] **Step 1: Write failing validate tests**

```js
import { describe, expect, it } from 'vitest';
import { validateOmniEnrichment } from '../src/telegram/digest/omni-validate.js';

describe('validateOmniEnrichment', () => {
  const ids = new Set(['a', 'b']);

  it('keeps known ids, drops unknown, truncates reason', () => {
    const out = validateOmniEnrichment(
      {
        risks: [
          { opportunityId: 'a', reason: 'x'.repeat(100) },
          { opportunityId: 'zzz', reason: 'no' },
          { opportunityId: 'a', reason: 'dup' },
        ],
        notes: ['  one  ', '', 'n'.repeat(200), 'two', 'three', 'four', 'five'],
      },
      ids,
    );
    expect(out.risks).toEqual([{ opportunityId: 'a', reason: 'x'.repeat(80) }]);
    expect(out.notes).toHaveLength(4);
    expect(out.notes[0]).toBe('one');
    expect(out.notes[1].length).toBe(120);
  });

  it('returns null on non-object', () => {
    expect(validateOmniEnrichment(null, ids)).toBeNull();
    expect(validateOmniEnrichment('x', ids)).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd backend && npm test -- telegram-digest-omni-validate.test.js`

- [ ] **Step 3: Implement validate**

```js
export const OMNI_REASON_MAX = 80;
export const OMNI_NOTES_MAX = 4;
export const OMNI_NOTE_MAX = 120;

function clip(s, max) {
  const t = String(s ?? '').trim();
  if (!t) return '';
  return t.length > max ? t.slice(0, max) : t;
}

export function validateOmniEnrichment(raw, candidateIds) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const risksIn = Array.isArray(raw.risks) ? raw.risks : [];
  const seen = new Set();
  const risks = [];
  for (const item of risksIn) {
    const id = String(item?.opportunityId ?? '').trim();
    if (!id || !candidateIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    const reason = clip(item?.reason, OMNI_REASON_MAX);
    risks.push({ opportunityId: id, reason });
  }
  const notes = [];
  for (const n of Array.isArray(raw.notes) ? raw.notes : []) {
    const t = clip(n, OMNI_NOTE_MAX);
    if (!t) continue;
    notes.push(t);
    if (notes.length >= OMNI_NOTES_MAX) break;
  }
  return { risks, notes };
}
```

- [ ] **Step 4: Write failing merge tests**

```js
import { describe, expect, it } from 'vitest';
import { applyOmniEnrichment, pickOmniCandidates } from '../src/telegram/digest/omni-merge.js';
import { RISK_LIST_LIMIT } from '../src/telegram/digest/compute.js';

const risk = (id, score, extra = {}) => ({
  opportunityId: id,
  score,
  amountRubles: extra.amountRubles ?? score * 1000,
  ready: 0,
  total: 2,
  labels: ['риск'],
  companyName: id,
  manager: '',
  bookingNo: '',
  name: id,
});

describe('pickOmniCandidates', () => {
  it('takes top 20 by existing order', () => {
    const risks = Array.from({ length: 25 }, (_, i) => risk(`r${i}`, 25 - i));
    expect(pickOmniCandidates(risks)).toHaveLength(20);
    expect(pickOmniCandidates(risks)[0].opportunityId).toBe('r0');
  });
});

describe('applyOmniEnrichment', () => {
  it('reorders and fills to 7', () => {
    const model = {
      risks: [risk('a', 5), risk('b', 4), risk('c', 3), risk('d', 2)],
    };
    const out = applyOmniEnrichment(model, {
      risks: [{ opportunityId: 'c', reason: 'why' }, { opportunityId: 'a', reason: '' }],
      notes: ['note1'],
    });
    expect(out.risks.map((r) => r.opportunityId)).toEqual(['c', 'a', 'b', 'd']);
    expect(out.risks[0].reason).toBe('why');
    expect(out.risks[1].reason).toBeUndefined();
    expect(out.notes).toEqual(['note1']);
  });

  it('falls back to model.risks when omni null or empty risk list', () => {
    const model = { risks: [risk('a', 1), risk('b', 0)] };
    expect(applyOmniEnrichment(model, null).risks).toEqual(model.risks);
    expect(applyOmniEnrichment(model, { risks: [], notes: ['x'] }).risks).toEqual(model.risks);
    expect(applyOmniEnrichment(model, { risks: [], notes: ['x'] }).notes).toEqual(['x']);
  });
});
```

Note: when Omni risks empty but notes present, keep rule order and still attach notes (per spec: “notes still usable if valid”).

- [ ] **Step 5: Implement merge**

```js
import { RISK_LIST_LIMIT } from './compute.js';

export const OMNI_CANDIDATE_LIMIT = 20;

export function pickOmniCandidates(risks) {
  return (risks ?? []).slice(0, OMNI_CANDIDATE_LIMIT);
}

export function applyOmniEnrichment(digestModel, omniResult) {
  const base = digestModel?.risks ?? [];
  const notes = omniResult?.notes?.length ? [...omniResult.notes] : [];
  const omniRisks = omniResult?.risks ?? [];
  if (!omniRisks.length) {
    return { risks: base, notes };
  }
  const byId = new Map(base.map((r) => [r.opportunityId, r]));
  const used = new Set();
  const ordered = [];
  for (const item of omniRisks) {
    const full = byId.get(item.opportunityId);
    if (!full || used.has(item.opportunityId)) continue;
    used.add(item.opportunityId);
    const next = { ...full };
    if (item.reason) next.reason = item.reason;
    ordered.push(next);
  }
  for (const r of base) {
    if (ordered.length >= RISK_LIST_LIMIT) break;
    if (used.has(r.opportunityId)) continue;
    used.add(r.opportunityId);
    ordered.push({ ...r });
  }
  return { risks: ordered, notes };
}
```

- [ ] **Step 6: Pass tests + commit**

```bash
cd backend && npm test -- telegram-digest-omni-validate.test.js telegram-digest-omni-merge.test.js
git add backend/src/telegram/digest/omni-validate.js backend/src/telegram/digest/omni-merge.js backend/tests/telegram-digest-omni-validate.test.js backend/tests/telegram-digest-omni-merge.test.js
git commit -m "feat(digest): validate and merge Omni enrichment"
```

---

### Task 2: Settings + Omni HTTP client

**Files:**
- Create: `backend/src/telegram/digest/omni-settings.js`
- Create: `backend/src/telegram/digest/omni.js`
- Test: `backend/tests/telegram-digest-omni-settings.test.js`
- Test: `backend/tests/telegram-digest-omni-client.test.js`

**Interfaces:**
- Consumes: `db`, `formatRiskTitle` from render (for candidate titles in payload)
- Produces:
  - `getDigestOmniConfig(db) → { enabled, baseUrl, apiKey, model, fallbackModel, timeoutMs }`
  - `enrichDigestWithOmni({ config, dayMeta, digestModel, candidates, fetchImpl? }) → validated {risks, notes} | null`

Settings resolution order:
- key: settings `digest_omni_api_key` → env `OMNI_API_KEY` → env `DIGEST_OMNI_API_KEY`
- enabled: settings `digest_omni_enabled` === `'0'` → false; else true if key non-empty
- baseUrl: settings / env / default `https://omni.dosugmayak.ru/v1` (strip trailing slash)
- model: settings / default `oc/deepseek-v4-flash-free`
- fallback: settings / default `auto`
- timeoutMs: 10_000

- [ ] **Step 1: Settings tests** (in-memory fake db with `prepare().get()`)

- [ ] **Step 2: Implement settings**

- [ ] **Step 3: Client tests with mocked fetch**

```js
it('calls primary then fallback on 500', async () => {
  const fetchImpl = vi
    .fn()
    .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ risks: [{ opportunityId: 'a', reason: 'r' }], notes: [] }) } }],
      }),
    });
  const result = await enrichDigestWithOmni({
    config: {
      enabled: true,
      baseUrl: 'https://omni.test/v1',
      apiKey: 'k',
      model: 'oc/deepseek-v4-flash-free',
      fallbackModel: 'auto',
      timeoutMs: 10_000,
    },
    dayMeta: { title: 'ЗАВТРА', dateLabel: '07.08' },
    digestModel: { ready: {}, notReady: {}, totalDeals: 1, totalPositions: 1 },
    candidates: [{ opportunityId: 'a', ready: 0, total: 2, amountRubles: 1, labels: ['риск'], score: 3, companyName: 'A' }],
    fetchImpl,
  });
  expect(fetchImpl).toHaveBeenCalledTimes(2);
  expect(JSON.parse(fetchImpl.mock.calls[0][1].body).model).toBe('oc/deepseek-v4-flash-free');
  expect(JSON.parse(fetchImpl.mock.calls[1][1].body).model).toBe('auto');
  expect(result.risks[0].opportunityId).toBe('a');
});

it('returns null when disabled', async () => {
  const fetchImpl = vi.fn();
  expect(
    await enrichDigestWithOmni({
      config: { enabled: false, baseUrl: '', apiKey: '', model: '', fallbackModel: '', timeoutMs: 1 },
      dayMeta: {},
      digestModel: {},
      candidates: [],
      fetchImpl,
    }),
  ).toBeNull();
  expect(fetchImpl).not.toHaveBeenCalled();
});
```

Use `AbortSignal.timeout(timeoutMs)` or `AbortController` + `setTimeout` compatible with Node 20+.

System prompt (exact intent):
- Reply JSON only: `{ "risks":[{ "opportunityId","reason"}], "notes":[string] }`
- Only use opportunityIds from candidates
- reasons ≤80 chars Russian, dense; notes ≤4 lines ≤120 chars
- Do not invent amounts or ids

Parse: `choices[0].message.content` — if fenced ```json, strip; `JSON.parse`; then `validateOmniEnrichment`.

- [ ] **Step 4: Implement client + pass tests + commit**

```bash
git commit -m "feat(digest): OmniRoute enrich client with model fallback"
```

**Do not** write the real API key into any file in the repo. Ops: set `digest_omni_api_key` in SQLite settings or `OMNI_API_KEY` in Dokploy env after merge.

---

### Task 3: Render reasons + `🧠` block

**Files:**
- Modify: `backend/src/telegram/digest/render.js`
- Test: `backend/tests/telegram-digest-render.test.js` (extend)

**Interfaces:**
- Change `renderDigestMessage(model, dayMeta, options?)`  
  Prefer: `renderDigestMessage(model, { title, dateLabel, notes?, risksOverride? })`
  - If `risksOverride` provided, use it instead of `sliceRisksForMessage(model.risks)` (already ordered/filled; still cap display at 7 via slice or assume merge already sized — **use `sliceRisksForMessage(risksOverride ?? model.risks)`** so hiddenCount still works if >7)
  - Risk line: append ` · ${r.reason}` only if `r.reason`
  - After risks block, if `notes?.length`: blank line, `🧠`, then each note

- [ ] **Step 1: Failing tests for reason + notes**

```js
it('appends reason and notes block', () => {
  const text = renderDigestMessage(
    {
      totalDeals: 1,
      totalPositions: 1,
      ready: { deals: 0, positions: 0, amountRubles: 0 },
      notReady: { deals: 1, positions: 1, amountRubles: 1000 },
      risks: [
        {
          companyName: 'Big',
          manager: 'M',
          bookingNo: '1',
          ready: 0,
          total: 2,
          amountRubles: 400_000,
          labels: ['риск'],
          reason: '0✓ крупный',
        },
      ],
    },
    { title: 'ЗАВТРА', dateLabel: '07.08', notes: ['узкое место: печать'] },
  );
  expect(text).toContain('· риск · 0✓ крупный');
  expect(text).toContain('🧠\nузкое место: печать');
});
```

- [ ] **Step 2: Implement + keep existing tests green**

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(digest): render Omni reasons and notes block"
```

---

### Task 4: Wire into `runDigestForDay`

**Files:**
- Modify: `backend/src/telegram/digest/run.js`
- Modify: `backend/tests/telegram-digest-run.test.js`

**Interfaces:**
- After `buildDigestModel(raw)`:
  1. `candidates = pickOmniCandidates(model.risks)`
  2. `config = getDigestOmniConfig(db)`
  3. `omniRaw = await enrichDigestWithOmni({ config, dayMeta: meta, digestModel: model, candidates })` // already validated or null
  4. `enriched = applyOmniEnrichment(model, omniRaw)`
  5. `text = renderDigestMessage(model, { title, dateLabel, notes: enriched.notes, risksOverride: enriched.risks })`

On enrich throw: catch, log `[digest] omni enrich skipped: …`, continue rule-only.

- [ ] **Step 1: Extend run tests** — mock omni modules; assert render gets notes when enrich returns data; assert send still works when enrich null

- [ ] **Step 2: Implement wiring**

- [ ] **Step 3: Full suite**

```bash
cd backend && npm test -- telegram-digest
git commit -m "feat(digest): wire Omni enrichment into digest run"
```

---

### Task 5: Ops note + Telegram UI one-liner (optional YAGNI)

**Files:**
- Modify: `frontend/src/pages/Telegram.jsx` — one line near digest.morning hint: Omni settings keys (`digest_omni_api_key`, model defaults)
- Or skip UI and document in report only if hint already crowded

- [ ] **Step 1:** Add short description line (no key values)
- [ ] **Step 2:** Commit `docs(ui): note digest Omni settings keys`

Manual smoke (not CI): set `OMNI_API_KEY` or settings key on staging → `/завтра` → expect `🧠` or silent fallback.

---

## Spec coverage

| Spec item | Task |
|-----------|------|
| validate ids/lengths | 1 |
| merge order + fill-7 + notes-only | 1 |
| Omni HTTP + primary/fallback models | 2 |
| settings/env | 2 |
| render reason + 🧠 | 3 |
| run wiring + fallback | 4 |
| no key in git / UI hint | 5 |
| cron unchanged | (no change) |

## Self-check

- No placeholders; models and URL exact from spec.
- `applyOmniEnrichment` + `validateOmniEnrichment` names consistent across tasks.
- Existing `llmApiKey` in `config.js` is **not** required; digest uses dedicated keys per spec (optional later alias out of scope).
