# Telegram Morning Digest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Утром в 09:00 MSK и по командам `/завтра` / `/послезавтра` бот шлёт плотную сводку Twenty: ✔️/❌ сделки и топ рисков по скору.

**Architecture:** Чистый `digest/compute` + `digest/render`; `digest/fetch` читает Twenty GraphQL; `digest/run` шлёт через Bot API `callTelegram`. Cron `0 9 * * *` и inbound-команды вызывают один и тот же `runDigestForDay`.

**Tech Stack:** Node.js ESM, Vitest, node-cron, Twenty GraphQL (`createTwentyGqlClient` / `gql`), Telegram Bot API (`backend/src/telegram/api-client.js`), SQLite settings `telegram_chat_map`.

## Global Constraints

- Timezone: `Europe/Moscow` (`CRM_TIMEZONE`)
- Cron: `0 9 * * *` — два сообщения: ЗАВТРА, затем ПОСЛЕЗАВТРА
- Chat map key: `digest.morning`
- Commands reply in invoking chat
- Exclude opportunity `OTMENA` and line item `OTMENA` everywhere
- Deal ✔️ iff opportunity `stage === 'GOTOVO'`
- Position ready iff line item `stage === 'GOTOVO'`
- Risks only among ❌ deals; rules R0/R1/R2 + score R5; no R3/R4
- R1 threshold: `amountRubles >= 150_000` and `pct < 1`
- R2: `ready === 0` and `total >= 2`
- R0: `pct < 0.30`
- Score: +3 R0, +2 R2, +2 top-25% amount among ❌ day deals, +1 R1; sort score↓ amount↓; top 7 + `… +N`
- Empty risks block: line `нет`
- Spec: `docs/superpowers/specs/2026-08-06-telegram-morning-digest-design.md`

## File map

| File | Responsibility |
|------|----------------|
| `backend/src/telegram/digest/compute.js` | Partition ✔️/❌, readiness, risks, scoring |
| `backend/src/telegram/digest/render.js` | Message text + money format + deal label |
| `backend/src/telegram/digest/fetch.js` | GraphQL load opportunities + line items for a day |
| `backend/src/telegram/digest/run.js` | Orchestrate fetch → compute → render → send |
| `backend/src/telegram/digest/cron.js` | `initDigestCron` |
| `backend/tests/telegram-digest-compute.test.js` | Pure compute tests |
| `backend/tests/telegram-digest-render.test.js` | Render / label / money |
| `backend/tests/telegram-digest-run.test.js` | Orchestration mocks |
| `backend/tests/telegram-digest-cron.test.js` | Cron schedule |
| `backend/tests/telegram-digest-commands.test.js` | Command routing |
| Modify: `backend/src/telegram/inbound.js` | Detect commands, fire digest |
| Modify: `backend/src/index.js` | `initDigestCron()` |
| Modify: `frontend/src/pages/Telegram.jsx` | Hint for `digest.morning` key (minimal) |

---

### Task 1: Digest compute (header + risks + score)

**Files:**
- Create: `backend/src/telegram/digest/compute.js`
- Test: `backend/tests/telegram-digest-compute.test.js`

**Interfaces:**
- Consumes: plain deal/item objects (no Twenty client)
- Produces:
  - `amountRubles(amount) → number` — `amountMicros / 1e6`, else `0`
  - `buildDigestModel({ deals, lineItemsByOppId }) → DigestModel`
  - Types (JSDoc):
    ```js
    // Deal: { id, name, stage, companyName?, amount?: { amountMicros } }
    // LineItem: { id, opportunityId, stage }
    // DigestModel: {
    //   totalDeals, totalPositions,
    //   ready: { deals, positions, amountRubles },
    //   notReady: { deals, positions, amountRubles },
    //   risks: Array<{
    //     opportunityId, companyName, manager, bookingNo, name,
    //     ready, total, amountRubles, labels: string[], score
    //   }>
    // }
    ```

- [ ] **Step 1: Write the failing test**

```js
import { describe, expect, it } from 'vitest';
import { amountRubles, buildDigestModel } from '../src/telegram/digest/compute.js';

const rub = (n) => ({ amountMicros: n * 1_000_000 });

describe('amountRubles', () => {
  it('converts micros', () => {
    expect(amountRubles(rub(150))).toBe(150);
    expect(amountRubles(null)).toBe(0);
  });
});

describe('buildDigestModel', () => {
  it('excludes OTMENA deals and items; partitions GOTOVO', () => {
    const deals = [
      { id: 'a', name: 'A', stage: 'GOTOVO', amount: rub(100), companyName: 'CoA' },
      { id: 'b', name: 'B', stage: 'V_RABOTE', amount: rub(200), companyName: 'CoB' },
      { id: 'c', name: 'C', stage: 'OTMENA', amount: rub(999), companyName: 'CoC' },
    ];
    const lineItemsByOppId = {
      a: [
        { id: '1', opportunityId: 'a', stage: 'GOTOVO' },
        { id: '2', opportunityId: 'a', stage: 'OTMENA' },
      ],
      b: [
        { id: '3', opportunityId: 'b', stage: 'NOVYY' },
        { id: '4', opportunityId: 'b', stage: 'NOVYY' },
      ],
      c: [{ id: '5', opportunityId: 'c', stage: 'NOVYY' }],
    };
    const m = buildDigestModel({ deals, lineItemsByOppId });
    expect(m.totalDeals).toBe(2);
    expect(m.totalPositions).toBe(3); // a:1 + b:2
    expect(m.ready).toEqual({ deals: 1, positions: 1, amountRubles: 100 });
    expect(m.notReady).toEqual({ deals: 1, positions: 2, amountRubles: 200 });
  });

  it('applies R0 R1 R2 and sorts by score then amount', () => {
    const deals = [
      // R0+R2+R1 candidate, large
      {
        id: 'big0',
        name: 'X/01.01/Mgr/100001/z',
        stage: 'V_RABOTE',
        amount: rub(400_000),
        companyName: 'Big',
      },
      // R1 only (50% ready, amount >= 150k)
      {
        id: 'bigHalf',
        name: 'X/01.01/Mgr/100002/z',
        stage: 'V_RABOTE',
        amount: rub(200_000),
        companyName: 'Half',
      },
      // exactly 30% — not R0; 1 ready of 1? use 3 items 1 ready = 33% not R0; 0 ready 1 item — not R2
      {
        id: 'small',
        name: 'X/01.01/Mgr/100003/z',
        stage: 'V_RABOTE',
        amount: rub(10_000),
        companyName: 'Small',
      },
      { id: 'done', name: 'D', stage: 'GOTOVO', amount: rub(500_000), companyName: 'Done' },
    ];
    const lineItemsByOppId = {
      big0: [
        { id: 'a', opportunityId: 'big0', stage: 'NOVYY' },
        { id: 'b', opportunityId: 'big0', stage: 'NOVYY' },
      ],
      bigHalf: [
        { id: 'c', opportunityId: 'bigHalf', stage: 'GOTOVO' },
        { id: 'd', opportunityId: 'bigHalf', stage: 'NOVYY' },
      ],
      small: [{ id: 'e', opportunityId: 'small', stage: 'NOVYY' }],
      done: [{ id: 'f', opportunityId: 'done', stage: 'GOTOVO' }],
    };
    const m = buildDigestModel({ deals, lineItemsByOppId });
    expect(m.risks.map((r) => r.opportunityId)).toEqual(['big0', 'bigHalf']);
    expect(m.risks[0].labels).toEqual(
      expect.arrayContaining(['риск', '0 готово', 'крупный готов не полностью']),
    );
    expect(m.risks[0].score).toBeGreaterThan(m.risks[1].score);
    expect(m.risks[1].labels).toContain('крупный готов не полностью');
    expect(m.risks[1].labels).not.toContain('риск');
  });

  it('caps risks at 7 with remainder hint via buildDigestModel option or separate slice helper', () => {
    const deals = Array.from({ length: 10 }, (_, i) => ({
      id: `d${i}`,
      name: `N/01.01/M/${100000 + i}/z`,
      stage: 'NOVYY',
      amount: rub(10_000 + i),
      companyName: `C${i}`,
    }));
    const lineItemsByOppId = Object.fromEntries(
      deals.map((d) => [
        d.id,
        [
          { id: `${d.id}a`, opportunityId: d.id, stage: 'NOVYY' },
          { id: `${d.id}b`, opportunityId: d.id, stage: 'NOVYY' },
        ],
      ]),
    );
    const m = buildDigestModel({ deals, lineItemsByOppId });
    expect(m.risks).toHaveLength(10);
    const { shown, hiddenCount } = sliceRisksForMessage(m.risks, 7);
    expect(shown).toHaveLength(7);
    expect(hiddenCount).toBe(3);
  });
});
```

Export `sliceRisksForMessage(risks, limit = 7)` from the same module.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- telegram-digest-compute.test.js`  
Expected: FAIL (module not found)

- [ ] **Step 3: Write minimal implementation**

```js
// backend/src/telegram/digest/compute.js
export const R1_MIN_RUBLES = 150_000;
export const RISK_PCT_LT = 0.3;
export const RISK_LIST_LIMIT = 7;

export function amountRubles(amount) {
  if (amount == null || amount.amountMicros == null) return 0;
  const n = Number(amount.amountMicros) / 1_000_000;
  return Number.isFinite(n) ? n : 0;
}

function activeItems(items) {
  return (items ?? []).filter((i) => i.stage && i.stage !== 'OTMENA');
}

function readiness(items) {
  const active = activeItems(items);
  const total = active.length;
  const ready = active.filter((i) => i.stage === 'GOTOVO').length;
  const pct = total === 0 ? 1 : ready / total;
  return { total, ready, pct };
}

function topQuarterThreshold(amounts) {
  if (!amounts.length) return Infinity;
  const sorted = [...amounts].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * 0.75);
  return sorted[Math.min(idx, sorted.length - 1)];
}

export function buildDigestModel({ deals, lineItemsByOppId }) {
  const activeDeals = (deals ?? []).filter((d) => d.stage && d.stage !== 'OTMENA');
  const readyDeals = [];
  const notReadyDeals = [];
  for (const d of activeDeals) {
    if (d.stage === 'GOTOVO') readyDeals.push(d);
    else notReadyDeals.push(d);
  }

  const sumGroup = (group) => {
    let positions = 0;
    let amount = 0;
    for (const d of group) {
      positions += readiness(lineItemsByOppId[d.id]).total;
      amount += amountRubles(d.amount);
    }
    return { deals: group.length, positions, amountRubles: amount };
  };

  const ready = sumGroup(readyDeals);
  const notReady = sumGroup(notReadyDeals);
  const notReadyAmounts = notReadyDeals.map((d) => amountRubles(d.amount));
  const q75 = topQuarterThreshold(notReadyAmounts);

  const risks = [];
  for (const d of notReadyDeals) {
    const { total, ready: rdy, pct } = readiness(lineItemsByOppId[d.id]);
    if (total === 0) continue;
    const amount = amountRubles(d.amount);
    const labels = [];
    let score = 0;
    const r0 = pct < RISK_PCT_LT;
    const r1 = amount >= R1_MIN_RUBLES && pct < 1;
    const r2 = rdy === 0 && total >= 2;
    if (r0) {
      labels.push('риск');
      score += 3;
    }
    if (r2) {
      labels.push('0 готово');
      score += 2;
    }
    if (amount >= q75 && notReadyAmounts.length > 0) score += 2;
    if (r1) {
      labels.push('крупный готов не полностью');
      score += 1;
    }
    if (!r0 && !r1 && !r2) continue;
    const parsed = parseDealNameParts(d.name); // defined in render or shared — see Task 2; for Task 1 keep raw fields:
    risks.push({
      opportunityId: d.id,
      companyName: d.companyName || '',
      manager: '', // filled in Task 2 when wiring render; OR import parse from label.js early
      bookingNo: '',
      name: d.name || '',
      ready: rdy,
      total,
      amountRubles: amount,
      labels,
      score,
    });
  }

  risks.sort((a, b) => b.score - a.score || b.amountRubles - a.amountRubles);

  return {
    totalDeals: activeDeals.length,
    totalPositions: ready.positions + notReady.positions,
    ready,
    notReady,
    risks,
  };
}

export function sliceRisksForMessage(risks, limit = RISK_LIST_LIMIT) {
  const shown = risks.slice(0, limit);
  return { shown, hiddenCount: Math.max(0, risks.length - shown.length) };
}
```

**Important for Task 1 purity:** put `parseDealNameParts` in `backend/src/telegram/digest/label.js` in Task 2; in Task 1 leave `manager`/`bookingNo` empty strings and fill them in `buildDigestModel` only after Task 2 exports parse — **preferred:** create `label.js` in Task 1 Step 3 with only `parseDealNameParts`, import it into compute so risks carry manager/bookingNo immediately.

Minimal `label.js` for Task 1:

```js
/** Tony-style: prefix/dates/manager/bookingNo/... */
export function parseDealNameParts(name) {
  const parts = String(name || '')
    .split('/')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length >= 4 && /^\d{4,}$/.test(parts[3])) {
    return { manager: parts[2], bookingNo: parts[3] };
  }
  return { manager: '', bookingNo: '' };
}
```

Call it inside `buildDigestModel` when pushing risks.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- telegram-digest-compute.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/telegram/digest/compute.js backend/src/telegram/digest/label.js backend/tests/telegram-digest-compute.test.js
git commit -m "feat(telegram): digest compute for ready/not-ready and risk score"
```

---

### Task 2: Render message text

**Files:**
- Create: `backend/src/telegram/digest/render.js`
- Modify: `backend/src/telegram/digest/label.js` (if needed)
- Test: `backend/tests/telegram-digest-render.test.js`

**Interfaces:**
- Consumes: `DigestModel`, `sliceRisksForMessage`, day meta `{ title: 'ЗАВТРА'|'ПОСЛЕЗАВТРА', dateLabel: 'DD.MM' }`
- Produces: `formatCompactRub(n) → string`, `formatRiskTitle(risk) → string`, `renderDigestMessage(model, dayMeta) → string`

- [ ] **Step 1: Write the failing test**

```js
import { describe, expect, it } from 'vitest';
import { formatCompactRub, formatRiskTitle, renderDigestMessage } from '../src/telegram/digest/render.js';
import { parseDealNameParts } from '../src/telegram/digest/label.js';

describe('formatCompactRub', () => {
  it('formats thousands and millions', () => {
    expect(formatCompactRub(420_000)).toBe('₽420к');
    expect(formatCompactRub(1_800_000)).toBe('₽1.8М');
    expect(formatCompactRub(0)).toBe('₽0');
  });
});

describe('parseDealNameParts', () => {
  it('parses tony segments', () => {
    expect(parseDealNameParts('АРЕНДА/07.08/Ольга/179037/Фест')).toEqual({
      manager: 'Ольга',
      bookingNo: '179037',
    });
  });
});

describe('formatRiskTitle', () => {
  it('joins non-empty segments', () => {
    expect(
      formatRiskTitle({
        companyName: 'Acme',
        manager: 'Ольга',
        bookingNo: '179037',
        name: 'fallback',
      }),
    ).toBe('Acme/Ольга/179037');
    expect(
      formatRiskTitle({ companyName: '', manager: '', bookingNo: '', name: 'OnlyName' }),
    ).toBe('OnlyName');
  });
});

describe('renderDigestMessage', () => {
  it('renders header and risks', () => {
    const text = renderDigestMessage(
      {
        totalDeals: 2,
        totalPositions: 3,
        ready: { deals: 1, positions: 1, amountRubles: 100_000 },
        notReady: { deals: 1, positions: 2, amountRubles: 200_000 },
        risks: [
          {
            companyName: 'Big',
            manager: 'Mgr',
            bookingNo: '100001',
            name: 'x',
            ready: 0,
            total: 2,
            amountRubles: 400_000,
            labels: ['риск', '0 готово'],
            score: 7,
          },
        ],
      },
      { title: 'ЗАВТРА', dateLabel: '07.08' },
    );
    expect(text).toContain('ЗАВТРА 07.08 · 2 сделок / 3 позиций');
    expect(text).toContain('✔️ 1 сделок / 1 позиций · ₽100к');
    expect(text).toContain('❌ 1 сделок / 2 позиций · ₽200к');
    expect(text).toContain('⚠ РИСКИ:');
    expect(text).toContain('• Big/Mgr/100001 · 0/2 · ₽400к · риск · 0 готово');
  });

  it('renders нет when no risks', () => {
    const text = renderDigestMessage(
      {
        totalDeals: 0,
        totalPositions: 0,
        ready: { deals: 0, positions: 0, amountRubles: 0 },
        notReady: { deals: 0, positions: 0, amountRubles: 0 },
        risks: [],
      },
      { title: 'ЗАВТРА', dateLabel: '07.08' },
    );
    expect(text).toContain('⚠ РИСКИ:\nнет');
  });
});
```

Grammar note: keep copy exactly as user format (`1 сделок` is fine for v1 — denser than perfect Russian plural).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- telegram-digest-render.test.js`  
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```js
// backend/src/telegram/digest/render.js
import { sliceRisksForMessage } from './compute.js';

export function formatCompactRub(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) {
    const m = v / 1_000_000;
    const s = Number.isInteger(m) ? String(m) : m.toFixed(1).replace(/\.0$/, '');
    return `₽${s}М`;
  }
  if (v >= 1000) {
    const k = Math.round(v / 1000);
    return `₽${k}к`;
  }
  return `₽${Math.round(v)}`;
}

export function formatRiskTitle(risk) {
  const parts = [risk.companyName, risk.manager, risk.bookingNo]
    .map((p) => String(p || '').trim())
    .filter(Boolean);
  if (parts.length) return parts.join('/');
  return String(risk.name || risk.opportunityId || '—').trim();
}

export function renderDigestMessage(model, { title, dateLabel }) {
  const lines = [
    `${title} ${dateLabel} · ${model.totalDeals} сделок / ${model.totalPositions} позиций`,
    `✔️ ${model.ready.deals} сделок / ${model.ready.positions} позиций · ${formatCompactRub(model.ready.amountRubles)}`,
    `❌ ${model.notReady.deals} сделок / ${model.notReady.positions} позиций · ${formatCompactRub(model.notReady.amountRubles)}`,
    '',
    '⚠ РИСКИ:',
  ];
  const { shown, hiddenCount } = sliceRisksForMessage(model.risks);
  if (!shown.length) {
    lines.push('нет');
  } else {
    for (const r of shown) {
      lines.push(
        `• ${formatRiskTitle(r)} · ${r.ready}/${r.total} · ${formatCompactRub(r.amountRubles)} · ${r.labels.join(' · ')}`,
      );
    }
    if (hiddenCount > 0) lines.push(`… +${hiddenCount}`);
  }
  return lines.join('\n');
}
```

Ensure `buildDigestModel` sets `manager`/`bookingNo` via `parseDealNameParts`.

- [ ] **Step 4: Run tests**

Run: `cd backend && npm test -- telegram-digest-render.test.js telegram-digest-compute.test.js`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/telegram/digest/render.js backend/src/telegram/digest/label.js backend/tests/telegram-digest-render.test.js backend/src/telegram/digest/compute.js
git commit -m "feat(telegram): render morning digest message text"
```

---

### Task 3: Day bounds + Twenty fetch

**Files:**
- Create: `backend/src/telegram/digest/dates.js`
- Create: `backend/src/telegram/digest/fetch.js`
- Test: `backend/tests/telegram-digest-dates.test.js`
- Test: `backend/tests/telegram-digest-fetch.test.js`

**Interfaces:**
- Consumes: `CRM_TIMEZONE`, `getCrmCalendarDate`, `toInputDate` from `utils/crm-dates.js`; `gql` client
- Produces:
  - `addCalendarDays(inputDateYmd, days) → 'YYYY-MM-DD'`
  - `getDigestDayMeta(offsetDays, now = new Date()) → { inputDate, title, dateLabel, gte, lt }`
    - offset 1 → `ЗАВТРА`, 2 → `ПОСЛЕЗАВТРА`
    - `gte`/`lt` ISO bounds for `loadDate` filter (same idea as board `getLocalDayBounds`, but CRM TZ)
  - `fetchDigestDayData(gqlClient, { gte, lt }) → { deals, lineItemsByOppId }`

- [ ] **Step 1: Write failing date tests**

```js
import { describe, expect, it } from 'vitest';
import { getDigestDayMeta } from '../src/telegram/digest/dates.js';

describe('getDigestDayMeta', () => {
  it('tomorrow from fixed Moscow instant', () => {
    // 2026-08-06 12:00 MSK
    const now = new Date('2026-08-06T09:00:00.000Z');
    const meta = getDigestDayMeta(1, now);
    expect(meta.title).toBe('ЗАВТРА');
    expect(meta.inputDate).toBe('2026-08-07');
    expect(meta.dateLabel).toBe('07.08');
    expect(meta.gte).toContain('2026-08-07');
    expect(meta.lt).toContain('2026-08-08');
  });
});
```

Implement bounds with `formatCrmDateTime` / calendar parts so Docker UTC hosts stay correct.

- [ ] **Step 2: Run — expect FAIL, then implement `dates.js`, re-run PASS**

- [ ] **Step 3: Write fetch test with mocked gql**

```js
import { describe, expect, it, vi } from 'vitest';
import { fetchDigestDayData } from '../src/telegram/digest/fetch.js';

describe('fetchDigestDayData', () => {
  it('maps opportunities and groups line items', async () => {
    const gqlClient = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          data: {
            opportunities: {
              edges: [
                {
                  node: {
                    id: 'o1',
                    name: 'N',
                    stage: 'NOVYY',
                    loadDate: '2026-08-07',
                    amount: { amountMicros: 1e6 },
                    companyName: 'Co',
                  },
                },
              ],
            },
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: {
            dealLineItems: {
              edges: [
                { node: { id: 'li1', opportunityId: 'o1', stage: 'NOVYY' } },
                { node: { id: 'li2', opportunityId: 'o1', stage: 'OTMENA' } },
              ],
            },
          },
        },
      });

    const data = await fetchDigestDayData(gqlClient, {
      gte: '2026-08-07T00:00:00+03:00',
      lt: '2026-08-08T00:00:00+03:00',
    });
    expect(data.deals).toHaveLength(1);
    expect(data.lineItemsByOppId.o1).toHaveLength(2);
    expect(gqlClient).toHaveBeenCalled();
  });
});
```

GraphQL (paginate with `first: 200` + `after` until `!hasNextPage` if needed; v1 may single-page if volume is small — **implement pagination loop** for both queries):

```graphql
query DigestOpps($filter: OpportunityFilterInput, $first: Int!, $after: String) {
  opportunities(filter: $filter, first: $first, after: $after) {
    pageInfo { hasNextPage endCursor }
    edges {
      node {
        id name stage loadDate
        amount { amountMicros currencyCode }
        companyName
      }
    }
  }
}
```

Filter: `{ and: [ { loadDate: { gte } }, { loadDate: { lt } } ] }`  
(If Twenty rejects `lt`, use `lte` end-of-day — match whatever print-sheet / export already use.)

```graphql
query DigestItems($filter: DealLineItemFilterInput, $first: Int!, $after: String) {
  dealLineItems(filter: $filter, first: $first, after: $after) {
    pageInfo { hasNextPage endCursor }
    edges { node { id opportunityId stage } }
  }
}
```

Filter line items: `{ opportunityId: { in: [ids...] } }` in chunks of ≤50 if needed.

If `companyName` is not a scalar on opportunity in this workspace, select `company { name }` and map to `companyName` in fetch.

- [ ] **Step 4: Implement fetch, pass tests, commit**

```bash
git add backend/src/telegram/digest/dates.js backend/src/telegram/digest/fetch.js backend/tests/telegram-digest-dates.test.js backend/tests/telegram-digest-fetch.test.js
git commit -m "feat(telegram): fetch Twenty deals for digest day window"
```

---

### Task 4: Run + sendMessage

**Files:**
- Create: `backend/src/telegram/digest/run.js`
- Test: `backend/tests/telegram-digest-run.test.js`

**Interfaces:**
- Consumes: `getDb`, `getTelegramBotToken`, `getTelegramDestination`, `callTelegram`, `requireTwentyConfig`, `createTwentyGqlClient`, `getDigestDayMeta`, `fetchDigestDayData`, `buildDigestModel`, `renderDigestMessage`
- Produces:
  - `runDigestForDay({ db, offsetDays, chatId?, threadId?, now?, deps? }) → { ok, text?, skipped?, error? }`
  - `runMorningDigests({ db, deps? }) → void` — offset 1 then 2 to `digest.morning`

- [ ] **Step 1: Failing tests**

```js
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchDigestDayData = vi.fn();
const buildDigestModel = vi.fn();
const renderDigestMessage = vi.fn();
const callTelegram = vi.fn();
const getTelegramBotToken = vi.fn();
const getTelegramDestination = vi.fn();
const requireTwentyConfig = vi.fn();
const createTwentyGqlClient = vi.fn();

vi.mock('../src/telegram/digest/fetch.js', () => ({
  fetchDigestDayData: (...a) => fetchDigestDayData(...a),
}));
vi.mock('../src/telegram/digest/compute.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, buildDigestModel: (...a) => buildDigestModel(...a) };
});
vi.mock('../src/telegram/digest/render.js', () => ({
  renderDigestMessage: (...a) => renderDigestMessage(...a),
}));
vi.mock('../src/telegram/api-client.js', () => ({
  callTelegram: (...a) => callTelegram(...a),
}));
vi.mock('../src/telegram/settings.js', () => ({
  getTelegramBotToken: (...a) => getTelegramBotToken(...a),
  getTelegramDestination: (...a) => getTelegramDestination(...a),
}));
vi.mock('../src/services/twenty-config.js', () => ({
  requireTwentyConfig: (...a) => requireTwentyConfig(...a),
}));
vi.mock('../src/services/twenty-gql.js', () => ({
  createTwentyGqlClient: (...a) => createTwentyGqlClient(...a),
}));

import { runDigestForDay, runMorningDigests } from '../src/telegram/digest/run.js';

describe('runDigestForDay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getTelegramBotToken.mockReturnValue('tok');
    requireTwentyConfig.mockReturnValue({ apiUrl: 'https://t/graphql', apiToken: 'x' });
    createTwentyGqlClient.mockReturnValue(vi.fn());
    fetchDigestDayData.mockResolvedValue({ deals: [], lineItemsByOppId: {} });
    buildDigestModel.mockReturnValue({
      totalDeals: 0,
      totalPositions: 0,
      ready: { deals: 0, positions: 0, amountRubles: 0 },
      notReady: { deals: 0, positions: 0, amountRubles: 0 },
      risks: [],
    });
    renderDigestMessage.mockReturnValue('TEXT');
    callTelegram.mockResolvedValue({});
  });

  it('sends to explicit chatId', async () => {
    const result = await runDigestForDay({
      db: {},
      offsetDays: 1,
      chatId: '-1001',
      now: new Date('2026-08-06T09:00:00.000Z'),
    });
    expect(result.ok).toBe(true);
    expect(callTelegram).toHaveBeenCalledWith(
      'tok',
      'sendMessage',
      expect.objectContaining({ chat_id: '-1001', text: 'TEXT' }),
    );
  });

  it('skips morning when no destination', async () => {
    getTelegramDestination.mockReturnValue(null);
    const result = await runMorningDigests({ db: {} });
    expect(result.skipped).toBe(true);
    expect(callTelegram).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Implement `run.js`**

```js
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
```

- [ ] **Step 3: Pass tests + commit**

```bash
git add backend/src/telegram/digest/run.js backend/tests/telegram-digest-run.test.js
git commit -m "feat(telegram): run digest fetch-render-send pipeline"
```

---

### Task 5: Morning cron

**Files:**
- Create: `backend/src/telegram/digest/cron.js`
- Modify: `backend/src/index.js`
- Test: `backend/tests/telegram-digest-cron.test.js`

**Interfaces:**
- Consumes: `runMorningDigests`, `getDb`, `CRM_TIMEZONE`
- Produces: `initDigestCron()`

- [ ] **Step 1: Failing cron test** (mirror `print-sheet-cron.test.js`)

```js
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CRM_TIMEZONE } from '../src/utils/crm-dates.js';

const scheduleMock = vi.fn();
const runMorningDigests = vi.fn();

vi.mock('node-cron', () => ({
  default: { schedule: (...args) => scheduleMock(...args) },
}));
vi.mock('../src/telegram/digest/run.js', () => ({
  runMorningDigests: (...a) => runMorningDigests(...a),
}));
vi.mock('../src/db/connection.js', () => ({
  getDb: () => ({}),
}));

import { initDigestCron } from '../src/telegram/digest/cron.js';

describe('initDigestCron', () => {
  beforeEach(() => {
    scheduleMock.mockReset().mockReturnValue({ stop: vi.fn() });
    runMorningDigests.mockReset().mockResolvedValue({});
  });

  it('schedules 09:00 Moscow', () => {
    initDigestCron();
    expect(scheduleMock).toHaveBeenCalledWith(
      '0 9 * * *',
      expect.any(Function),
      { timezone: CRM_TIMEZONE },
    );
  });
});
```

- [ ] **Step 2: Implement cron + wire `index.js`**

```js
// cron.js
import cron from 'node-cron';
import { getDb } from '../../db/connection.js';
import { CRM_TIMEZONE } from '../../utils/crm-dates.js';
import { runMorningDigests } from './run.js';

let cronTask = null;

export function initDigestCron() {
  if (cronTask) cronTask.stop();
  cronTask = cron.schedule(
    '0 9 * * *',
    () => {
      runMorningDigests({ db: getDb() }).catch((err) => {
        console.error('[digest] cron error:', err.message);
      });
    },
    { timezone: CRM_TIMEZONE },
  );
  console.log(`Digest cron initialized: 0 9 * * * (${CRM_TIMEZONE})`);
}
```

In `index.js`: `import { initDigestCron } from './telegram/digest/cron.js';` and call next to other crons.

- [ ] **Step 3: Pass + commit**

```bash
git add backend/src/telegram/digest/cron.js backend/src/index.js backend/tests/telegram-digest-cron.test.js
git commit -m "feat(telegram): schedule morning digest at 09:00 Moscow"
```

---

### Task 6: Bot commands `/завтра` `/послезавтра`

**Files:**
- Modify: `backend/src/telegram/inbound.js`
- Create: `backend/src/telegram/digest/commands.js` (pure parse)
- Test: `backend/tests/telegram-digest-commands.test.js`

**Interfaces:**
- Consumes: message text
- Produces: `parseDigestCommand(text) → 1 | 2 | null`  
  Match (trim, case-insensitive for latin; Cyrillic exact):  
  `/завтра`, `/завтра@AnyBot`, `/послезавтра`, `/послезавтра@AnyBot`  
  Also bare `завтра` / `послезавтра` **only if** message starts with `/` stripped forms above (spec: slash commands). Stick to slash forms.

- [ ] **Step 1: Failing parse tests**

```js
import { describe, expect, it } from 'vitest';
import { parseDigestCommand } from '../src/telegram/digest/commands.js';

describe('parseDigestCommand', () => {
  it('parses tomorrow', () => {
    expect(parseDigestCommand('/завтра')).toBe(1);
    expect(parseDigestCommand('/завтра@MyBot')).toBe(1);
  });
  it('parses day after', () => {
    expect(parseDigestCommand('/послезавтра')).toBe(2);
  });
  it('ignores other', () => {
    expect(parseDigestCommand('hello')).toBeNull();
    expect(parseDigestCommand('/start')).toBeNull();
  });
});
```

- [ ] **Step 2: Implement parse + wire inbound**

In `processTelegramUpdate`, after chat upsert:

```js
const text = (msg.text || '').trim();
const offset = parseDigestCommand(text);
if (offset != null) {
  const chatId = String(chat.id);
  const threadId = msg.message_thread_id || null;
  // fire-and-forget so webhook/polling can ack quickly
  void runDigestForDay({ db, offsetDays: offset, chatId, threadId }).catch((err) => {
    console.error('[digest] command failed:', err.message);
    const token = getTelegramBotToken(db);
    if (token) {
      void callTelegram(token, 'sendMessage', {
        chat_id: chatId,
        text: 'не удалось загрузить',
        ...(threadId ? { message_thread_id: threadId } : {}),
      }).catch(() => {});
    }
  });
}
```

Keep discovery behavior unchanged.

- [ ] **Step 3: Integration-style unit test that `processTelegramUpdate` invokes run** (mock `runDigestForDay`)

- [ ] **Step 4: Commit**

```bash
git add backend/src/telegram/digest/commands.js backend/src/telegram/inbound.js backend/tests/telegram-digest-commands.test.js
git commit -m "feat(telegram): handle /завтра and /послезавтра digest commands"
```

---

### Task 7: Settings UI hint for `digest.morning`

**Files:**
- Modify: `frontend/src/pages/Telegram.jsx` (description near okleyka destination)
- Optional: allow saving `digest.morning` the same way as a string chat id in chat map editor if UI only edits `okleyka.send` today — add a small second field **or** document JSON key in description.

Minimal approach matching YAGNI:

- [ ] **Step 1:** In the okleyka / chat map section description, add one line:  
  `Утренняя сводка: ключ digest.morning в telegram_chat_map (chatId или {chatId, threadId}).`
- [ ] **Step 2:** If chat map is only edited as full JSON elsewhere, no code change beyond copy.
- [ ] **Step 3:** If there is structured save that strips unknown keys, ensure `digest.morning` is preserved (`mergeChatMapEntry` already keeps non-`okleyka.send` keys).

Verify with a quick read of Telegram.jsx save path; add field only if users cannot set the key today.

```bash
git add frontend/src/pages/Telegram.jsx
git commit -m "docs(ui): note digest.morning chat map key on Telegram page"
```

---

### Task 8: Smoke checklist (manual)

- [ ] Set `telegram_chat_map.digest.morning` on staging
- [ ] `runDigestForDay` via temporary script or hit command in Telegram
- [ ] Confirm message shape vs spec
- [ ] Confirm cron log line on boot: `Digest cron initialized: 0 9 * * *`
- [ ] No commit required unless fixes found

---

## Spec coverage self-check

| Spec item | Task |
|-----------|------|
| Format header ✔️/❌ | 1–2 |
| Risks R0/R1/R2 + labels | 1 |
| Scoring + top 7 | 1–2 |
| OTMENA excluded | 1 |
| Deal ✔️ = opportunity GOTOVO | 1 |
| 09:00 two messages | 4–5 |
| `digest.morning` | 4, 7 |
| Commands reply in chat | 6 |
| Twenty fetch loadDate | 3 |
| Empty → `нет` | 2 |
| Error «не удалось загрузить» | 6 |

## Placeholder / consistency scan

- No TBD left; money format and name parse are explicit.
- `runDigestForDay` / `runMorningDigests` names consistent across tasks 4–6.
- R1 threshold `150_000` rubles via `amountRubles`, not micros.
