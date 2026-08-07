# Digest Risk Booking № + CRM Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Morning digest risk lines lead with Tony booking № and show clickable `(Twenty | Tony | Bitrix)` HTML links.

**Architecture:** Fetch `tonyLink`/`bitrixLink` with opportunities. Pure helpers resolve booking № (Tony URL `id=` first, else `\d{5,}` in name) and Twenty object URL from API origin. Compute attaches URLs onto risks; render escapes HTML and emits a second link line; `sendDigestText` uses GramJS `parseMode: 'html'`.

**Tech Stack:** Node ESM, Vitest, GramJS (`telegram`), existing digest modules under `backend/src/telegram/digest/`.

## Global Constraints

- Risk title = booking № only (no company/manager in title).
- Link line only when ≥1 URL; omit missing of Twenty/Tony/Bitrix.
- Escape HTML in plain text (`&`, `<`, `>`); attribute-escape hrefs.
- Scoring / Omni merge / destination / user-bot transport unchanged (except HTML parse mode on send).
- YAGNI: no inline keyboards; no new settings keys.
- Spec: `docs/superpowers/specs/2026-08-07-digest-risk-booking-links-design.md`.

## File map

| File | Role |
|------|------|
| `backend/src/telegram/digest/label.js` | Booking № + Twenty URL helpers |
| `backend/src/telegram/digest/fetch.js` | GraphQL + map `tonyUrl`/`bitrixUrl` |
| `backend/src/telegram/digest/compute.js` | Attach `bookingNo`, URLs on risks |
| `backend/src/telegram/digest/render.js` | Title, link line, HTML escape |
| `backend/src/telegram/digest/send.js` | `parseMode: 'html'` |
| `backend/src/telegram/digest/run.js` | Pass `twentyApiUrl` into compute |
| Tests | label/render/fetch/compute/send (+ update run expectations if needed) |

---

### Task 1: Booking № + Twenty URL helpers

**Files:**
- Modify: `backend/src/telegram/digest/label.js`
- Modify: `backend/tests/telegram-digest-render.test.js` (or create `backend/tests/telegram-digest-label.test.js` if cleaner — prefer extending existing file that already imports `parseDealNameParts`)

**Interfaces:**
- Produces:
  - `bookingNoFromTonyUrl(url: string) → string`
  - `bookingNoFromName(name: string) → string`
  - `resolveBookingNo({ tonyUrl?, name? }) → string`
  - `twentyOpportunityUrl(apiUrl: string, opportunityId: string) → string`
- Consumes: existing `parseDealNameParts` (unchanged)

- [ ] **Step 1: Write failing tests**

Add to `backend/tests/telegram-digest-render.test.js` (or new label test file):

```js
import {
  parseDealNameParts,
  bookingNoFromTonyUrl,
  bookingNoFromName,
  resolveBookingNo,
  twentyOpportunityUrl,
} from '../src/telegram/digest/label.js';

describe('bookingNoFromTonyUrl', () => {
  it('reads id= from tony orders_edit URL', () => {
    expect(
      bookingNoFromTonyUrl('https://crm.apihide.com/orders/orders_edit/?id=178323'),
    ).toBe('178323');
  });
  it('returns empty when no id', () => {
    expect(bookingNoFromTonyUrl('https://example.com/x')).toBe('');
    expect(bookingNoFromTonyUrl('')).toBe('');
  });
});

describe('bookingNoFromName', () => {
  it('takes first 5+ digit run', () => {
    expect(bookingNoFromName('ProInteractive mess 178323 extra')).toBe('178323');
    expect(bookingNoFromName('no digits')).toBe('');
  });
});

describe('resolveBookingNo', () => {
  it('prefers tony URL over name', () => {
    expect(
      resolveBookingNo({
        tonyUrl: 'https://crm.apihide.com/orders/orders_edit/?id=111111',
        name: 'x/01.01/M/999999/z',
      }),
    ).toBe('111111');
  });
  it('falls back to name when tony missing', () => {
    expect(resolveBookingNo({ tonyUrl: '', name: 'Acme 222222' })).toBe('222222');
  });
});

describe('twentyOpportunityUrl', () => {
  it('uses origin from graphql and bare host URLs', () => {
    expect(
      twentyOpportunityUrl('https://crm.example.com/graphql', 'opp-1'),
    ).toBe('https://crm.example.com/object/opportunity/opp-1');
    expect(
      twentyOpportunityUrl('https://crm.example.com/', 'opp-1'),
    ).toBe('https://crm.example.com/object/opportunity/opp-1');
  });
  it('returns empty without id or bad url', () => {
    expect(twentyOpportunityUrl('https://crm.example.com/graphql', '')).toBe('');
    expect(twentyOpportunityUrl('not-a-url', 'opp-1')).toBe('');
  });
});
```

Keep existing `parseDealNameParts` test unchanged.

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd backend && npx vitest run tests/telegram-digest-render.test.js
```

Expected: FAIL — helpers not exported / not defined.

- [ ] **Step 3: Implement helpers in `label.js`**

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

export function bookingNoFromTonyUrl(url) {
  const m = String(url || '').match(/[?&]id=(\d{5,})/i);
  return m ? m[1] : '';
}

export function bookingNoFromName(name) {
  const m = String(name || '').match(/\d{5,}/);
  return m ? m[0] : '';
}

export function resolveBookingNo({ tonyUrl, name } = {}) {
  return bookingNoFromTonyUrl(tonyUrl) || bookingNoFromName(name) || '';
}

export function twentyOpportunityUrl(apiUrl, opportunityId) {
  const id = String(opportunityId || '').trim();
  if (!id) return '';
  try {
    const origin = new URL(String(apiUrl || '').trim()).origin;
    if (!origin || origin === 'null') return '';
    return `${origin}/object/opportunity/${id}`;
  } catch {
    return '';
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd backend && npx vitest run tests/telegram-digest-render.test.js
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/telegram/digest/label.js backend/tests/telegram-digest-render.test.js
git commit -m "feat(digest): helpers for booking № and Twenty opportunity URL"
```

---

### Task 2: Fetch `tonyLink` / `bitrixLink`

**Files:**
- Modify: `backend/src/telegram/digest/fetch.js`
- Modify: `backend/tests/telegram-digest-fetch.test.js`

**Interfaces:**
- Produces: each deal `{ id, name, stage, loadDate, amount, companyName, tonyUrl, bitrixUrl }`
- Consumes: existing `fetchDigestDayData(gqlClient, { gte, lt })`

- [ ] **Step 1: Write failing fetch test**

Extend the opportunity node mock and assertions:

```js
node: {
  id: 'o1',
  name: 'N',
  stage: 'NOVYY',
  loadDate: '2026-08-07',
  amount: { amountMicros: 1e6 },
  company: { name: 'Co' },
  tonyLink: { primaryLinkUrl: 'https://crm.apihide.com/orders/orders_edit/?id=178323' },
  bitrixLink: { primaryLinkUrl: 'https://prointeractive.bitrix24.ru/crm/deal/details/42/' },
},
// ...
expect(data.deals[0]).toMatchObject({
  companyName: 'Co',
  tonyUrl: 'https://crm.apihide.com/orders/orders_edit/?id=178323',
  bitrixUrl: 'https://prointeractive.bitrix24.ru/crm/deal/details/42/',
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd backend && npx vitest run tests/telegram-digest-fetch.test.js
```

Expected: FAIL — `tonyUrl`/`bitrixUrl` undefined.

- [ ] **Step 3: Update GraphQL + `mapOpportunity`**

In `DIGEST_OPPS` node selection add:

```
tonyLink { primaryLinkUrl }
bitrixLink { primaryLinkUrl }
```

```js
function mapOpportunity(node) {
  return {
    id: node.id,
    name: node.name,
    stage: node.stage,
    loadDate: node.loadDate,
    amount: node.amount,
    companyName: node.companyName ?? node.company?.name ?? '',
    tonyUrl: node.tonyLink?.primaryLinkUrl || node.tonyUrl || '',
    bitrixUrl: node.bitrixLink?.primaryLinkUrl || node.bitrixUrl || '',
  };
}
```

- [ ] **Step 4: Run — expect PASS**

```bash
cd backend && npx vitest run tests/telegram-digest-fetch.test.js
```

- [ ] **Step 5: Commit**

```bash
git add backend/src/telegram/digest/fetch.js backend/tests/telegram-digest-fetch.test.js
git commit -m "feat(digest): fetch tonyLink and bitrixLink for risks"
```

---

### Task 3: Compute attaches booking № + URLs

**Files:**
- Modify: `backend/src/telegram/digest/compute.js`
- Modify: `backend/src/telegram/digest/run.js`
- Modify: `backend/tests/telegram-digest-compute.test.js`

**Interfaces:**
- Consumes: `resolveBookingNo`, `twentyOpportunityUrl`, `parseDealNameParts` from `label.js`; deal `tonyUrl`/`bitrixUrl`
- Produces: risk fields `bookingNo`, `tonyUrl`, `bitrixUrl`, `twentyUrl` (+ keep `manager`/`companyName` for data, unused in title)
- Signature: `buildDigestModel({ deals, lineItemsByOppId }, { twentyApiUrl } = {})`

- [ ] **Step 1: Write failing compute tests**

Add:

```js
it('resolves bookingNo from tonyUrl and builds twentyUrl', () => {
  const deals = [
    {
      id: 'messy',
      name: 'ProInteractive something',
      stage: 'V_RABOTE',
      amount: rub(400_000),
      companyName: 'ProInteractive',
      tonyUrl: 'https://crm.apihide.com/orders/orders_edit/?id=178323',
      bitrixUrl: 'https://bitrix.example/deal/1/',
    },
  ];
  const lineItemsByOppId = {
    messy: [
      { id: 'a', opportunityId: 'messy', stage: 'NOVYY' },
      { id: 'b', opportunityId: 'messy', stage: 'NOVYY' },
    ],
  };
  const m = buildDigestModel(
    { deals, lineItemsByOppId },
    { twentyApiUrl: 'https://crm.example.com/graphql' },
  );
  const risk = m.risks.find((r) => r.opportunityId === 'messy');
  expect(risk.bookingNo).toBe('178323');
  expect(risk.tonyUrl).toContain('id=178323');
  expect(risk.bitrixUrl).toContain('bitrix.example');
  expect(risk.twentyUrl).toBe(
    'https://crm.example.com/object/opportunity/messy',
  );
});
```

Existing tests that assert risk shape may still pass if they only check scores; if any assert `bookingNo` from slash-name only, keep that behavior via name fallback (`\d{5,}` in `X/01.01/Mgr/100001/z`).

- [ ] **Step 2: Run — expect FAIL**

```bash
cd backend && npx vitest run tests/telegram-digest-compute.test.js
```

- [ ] **Step 3: Implement compute + wire run**

`compute.js` risk push:

```js
import { parseDealNameParts, resolveBookingNo, twentyOpportunityUrl } from './label.js';

export function buildDigestModel({ deals, lineItemsByOppId }, { twentyApiUrl } = {}) {
  // ... existing scoring loop ...
    const parsed = parseDealNameParts(d.name);
    const tonyUrl = d.tonyUrl || '';
    const bitrixUrl = d.bitrixUrl || '';
    risks.push({
      opportunityId: d.id,
      companyName: d.companyName || '',
      manager: parsed.manager,
      bookingNo: resolveBookingNo({ tonyUrl, name: d.name }),
      name: d.name || '',
      tonyUrl,
      bitrixUrl,
      twentyUrl: twentyOpportunityUrl(twentyApiUrl || '', d.id),
      ready: rdy,
      total,
      amountRubles: amount,
      labels,
      score,
    });
  // ...
}
```

`run.js`:

```js
const { apiUrl, apiToken } = requireTwentyConfig();
const gqlClient = createTwentyGqlClient(apiUrl, apiToken);
const raw = await fetchDigestDayData(gqlClient, { gte: meta.gte, lt: meta.lt });
const model = buildDigestModel(raw, { twentyApiUrl: apiUrl });
```

- [ ] **Step 4: Run compute (+ run suite if mocks break)**

```bash
cd backend && npx vitest run tests/telegram-digest-compute.test.js tests/telegram-digest-run.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/telegram/digest/compute.js backend/src/telegram/digest/run.js backend/tests/telegram-digest-compute.test.js
git commit -m "feat(digest): attach booking № and CRM URLs on risk model"
```

---

### Task 4: Render booking-first title + HTML link line

**Files:**
- Modify: `backend/src/telegram/digest/render.js`
- Modify: `backend/tests/telegram-digest-render.test.js`

**Interfaces:**
- Consumes: risk `bookingNo`, `name`, `tonyUrl`, `bitrixUrl`, `twentyUrl`, `reason`, `labels`
- Produces:
  - `escapeHtml(text) → string`
  - `formatRiskTitle(risk) → string` (plain: booking || name || `—`)
  - `formatRiskLinkLine(risk) → string` (HTML or `''`)
  - `renderDigestMessage` escapes plain segments; appends link line after each risk bullet

- [ ] **Step 1: Rewrite failing render tests**

Replace `formatRiskTitle` expectations:

```js
describe('formatRiskTitle', () => {
  it('uses booking № only', () => {
    expect(
      formatRiskTitle({
        companyName: 'Acme',
        manager: 'Ольга',
        bookingNo: '179037',
        name: 'fallback',
      }),
    ).toBe('179037');
    expect(
      formatRiskTitle({ companyName: '', manager: '', bookingNo: '', name: 'OnlyName' }),
    ).toBe('OnlyName');
    expect(
      formatRiskTitle({ companyName: '', manager: '', bookingNo: '', name: '' }),
    ).toBe('—');
  });
});
```

Update `renderDigestMessage` risk expectation from `• Big/Mgr/100001 · …` to:

```js
expect(text).toContain('• 100001 · 0/2 · ₽400к · риск · 0 готово');
```

Add:

```js
it('appends HTML link line and escapes plain text', () => {
  const text = renderDigestMessage(
    {
      totalDeals: 1,
      totalPositions: 2,
      ready: { deals: 0, positions: 0, amountRubles: 0 },
      notReady: { deals: 1, positions: 2, amountRubles: 400_000 },
      risks: [
        {
          bookingNo: '178323',
          name: 'x',
          ready: 0,
          total: 2,
          amountRubles: 400_000,
          labels: ['риск'],
          reason: 'a <b> & c',
          twentyUrl: 'https://crm.example.com/object/opportunity/o1',
          tonyUrl: 'https://crm.apihide.com/orders/orders_edit/?id=178323',
          bitrixUrl: '',
        },
      ],
    },
    { title: 'ЗАВТРА', dateLabel: '07.08' },
  );
  expect(text).toContain('• 178323 · 0/2 · ₽400к · риск · a &lt;b&gt; &amp; c');
  expect(text).toContain(
    '(<a href="https://crm.example.com/object/opportunity/o1">Twenty</a> | <a href="https://crm.apihide.com/orders/orders_edit/?id=178323">Tony</a>)',
  );
  expect(text).not.toContain('Bitrix');
});

it('omits link line when no URLs', () => {
  const text = renderDigestMessage(
    {
      totalDeals: 1,
      totalPositions: 1,
      ready: { deals: 0, positions: 0, amountRubles: 0 },
      notReady: { deals: 1, positions: 1, amountRubles: 1000 },
      risks: [
        {
          bookingNo: '1',
          ready: 0,
          total: 2,
          amountRubles: 400_000,
          labels: ['риск'],
        },
      ],
    },
    { title: 'ЗАВТРА', dateLabel: '07.08' },
  );
  expect(text).toContain('• 1 · 0/2 · ₽400к · риск');
  expect(text).not.toContain('<a href');
});
```

Update the existing “reason and notes” test so title uses booking `1` (already) and escape is OK if reason has no special chars.

- [ ] **Step 2: Run — expect FAIL**

```bash
cd backend && npx vitest run tests/telegram-digest-render.test.js
```

- [ ] **Step 3: Implement render**

```js
export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeHtmlAttr(s) {
  return escapeHtml(s).replace(/"/g, '&quot;');
}

export function formatRiskTitle(risk) {
  const booking = String(risk.bookingNo || '').trim();
  if (booking) return booking;
  const name = String(risk.name || '').trim();
  if (name) return name;
  return '—';
}

export function formatRiskLinkLine(risk) {
  const parts = [];
  if (risk.twentyUrl) {
    parts.push(`<a href="${escapeHtmlAttr(risk.twentyUrl)}">Twenty</a>`);
  }
  if (risk.tonyUrl) {
    parts.push(`<a href="${escapeHtmlAttr(risk.tonyUrl)}">Tony</a>`);
  }
  if (risk.bitrixUrl) {
    parts.push(`<a href="${escapeHtmlAttr(risk.bitrixUrl)}">Bitrix</a>`);
  }
  if (!parts.length) return '';
  return `(${parts.join(' | ')})`;
}

// inside renderDigestMessage risk loop:
for (const r of shown) {
  let line = `• ${escapeHtml(formatRiskTitle(r))} · ${r.ready}/${r.total} · ${escapeHtml(formatCompactRub(r.amountRubles))} · ${escapeHtml(r.labels.join(' · '))}`;
  if (r.reason) line += ` · ${escapeHtml(r.reason)}`;
  lines.push(line);
  const links = formatRiskLinkLine(r);
  if (links) lines.push(links);
}
```

Also escape header strings that could theoretically contain HTML? Spec only requires plain segments on risk lines — header can stay as today (no user HTML).

- [ ] **Step 4: Run — expect PASS**

```bash
cd backend && npx vitest run tests/telegram-digest-render.test.js
```

If Omni unit tests assert old title shape, update those that hard-code `Acme/Ольга/...`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/telegram/digest/render.js backend/tests/telegram-digest-render.test.js
git commit -m "feat(digest): booking-first risk title and HTML CRM links"
```

---

### Task 5: `sendDigestText` HTML parse mode

**Files:**
- Modify: `backend/src/telegram/digest/send.js`
- Create: `backend/tests/telegram-digest-send.test.js`

**Interfaces:**
- Produces: `sendDigestText({ client, chatId, threadId, text })` calls `client.sendMessage` with `parseMode: 'html'`

- [ ] **Step 1: Write failing send test**

```js
import { describe, expect, it, vi } from 'vitest';
import { sendDigestText } from '../src/telegram/digest/send.js';

describe('sendDigestText', () => {
  it('sends with html parseMode and replyTo when thread set', async () => {
    const client = { sendMessage: vi.fn(async () => ({})) };
    await sendDigestText({
      client,
      chatId: '-1001',
      threadId: 42,
      text: '• 1\n(<a href="https://x">Twenty</a>)',
    });
    expect(client.sendMessage).toHaveBeenCalledWith('-1001', {
      message: '• 1\n(<a href="https://x">Twenty</a>)',
      parseMode: 'html',
      replyTo: 42,
    });
  });

  it('omits replyTo when thread missing', async () => {
    const client = { sendMessage: vi.fn(async () => ({})) };
    await sendDigestText({ client, chatId: '-1001', threadId: null, text: 'hi' });
    expect(client.sendMessage).toHaveBeenCalledWith('-1001', {
      message: 'hi',
      parseMode: 'html',
    });
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd backend && npx vitest run tests/telegram-digest-send.test.js
```

Expected: FAIL — `parseMode` missing from call.

- [ ] **Step 3: Implement**

```js
export async function sendDigestText({ client, chatId, threadId, text }) {
  if (!client) throw new Error('userbot client required');
  const messageText = String(text ?? '');
  if (!messageText.trim()) return;
  const replyTo = Number.isInteger(threadId) && threadId > 0 ? threadId : undefined;
  await client.sendMessage(chatId, {
    message: messageText,
    parseMode: 'html',
    ...(replyTo ? { replyTo } : {}),
  });
}
```

- [ ] **Step 4: Run digest-related tests**

```bash
cd backend && npx vitest run tests/telegram-digest-*.test.js
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/telegram/digest/send.js backend/tests/telegram-digest-send.test.js
git commit -m "feat(digest): send risk links with HTML parse mode"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Fetch tonyLink/bitrixLink | 2 |
| bookingNo from tony `id=` then name `\d{5,}` | 1, 3 |
| twentyUrl from api origin | 1, 3 |
| Title = booking only; fallback name/`—` | 4 |
| Link line Twenty\|Tony\|Bitrix; omit missing | 4 |
| Escape HTML plain text | 4 |
| send parseMode html | 5 |
| Scoring/Omni/dest/transport unchanged | 3–5 (no score/omni/dest edits beyond apiUrl pass + parseMode) |

## Self-review notes

- No TBD placeholders.
- `formatRiskTitle` change also affects Omni candidate titles (desired: booking №).
- `parseDealNameParts` kept for `manager` field; title no longer uses it.
