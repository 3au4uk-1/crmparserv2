# Twenty Post-Parse Sync Speed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Post-parse Twenty sync (resync, cancel, restore, auto-approve) finishes in ≤ 5 minutes after Tony/SQLite by skipping no-op writes, batching mutations, running 6 deals at once, and raising the API-key limit to 800/min.

**Architecture:** Keep Tony prefetch and SQLite apply as they are. Add a post-parse runner that feeds deal queues through `createPool` (concurrency 6) under the existing token bucket. Identity + stage protection stay in `computeLineItemDiff`; a new field-skip filter drops unchanged updates. Line items go out as `createDealLineItems` / `deleteDealLineItems` / `upsertDealLineItems` (chunks of 60). Opportunity is written once from an in-memory amount, or not at all on full no-op. Print sheet runs once at the end.

**Tech Stack:** Node.js (crmparserv2 backend), Vitest, better-sqlite3, existing `fetch-pool.js` / `twenty-gql.js`, Dokploy compose for Twenty `API_RATE_LIMITING_LONG_LIMIT`.

**Spec:** `docs/superpowers/specs/2026-09-14-twenty-sync-speed-design.md`

## Global Constraints

- Do not change Tony reconcile, `content_hash`, eligibility, restoration / ne-nashe / tip rules, or stage protection semantics.
- Do not write `stage` on ordinary resync line-item updates.
- Empty local comment still does not clear Twenty `kommentariy`.
- Batch size is 60; aliased update fallback is at most 20 root fields per HTTP document.
- `createDealLineItems` ids map by index; length mismatch fails the deal (never match by name).
- Partial batch success is not a deal success.
- No `delay(1000)` between deals. `FETCH_CONCURRENCY` and `TONY_REQUEST_DELAY_MS` stay unchanged.
- Manual single-deal UI sync keeps `skipPrintSheetRefresh: false`.
- Client `TWENTY_API_RATE_LIMIT_MAX=720`, server `API_RATE_LIMITING_LONG_LIMIT=800`, `TWENTY_SYNC_CONCURRENCY=6`.
- Retry-an-entire-deal-from-scratch on one failed line item is out of scope.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `backend/src/config.js` | `twentySyncConcurrency`, default rate max 720 |
| `.env.example`, `docker-compose.yml` | env wiring |
| `backend/src/services/twenty-gql.js` | `gql_count` / `rate_limited` counters |
| `backend/src/services/twenty-line-items-sync.js` | list extra fields; `applyFieldSkip`; cancel batch |
| `backend/src/services/twenty-line-item.js` | `lineItemFieldsEqual` (desired payload vs Twenty node) |
| `backend/src/services/twenty-batch.js` | `chunk`, create/delete/upsert batches, aliased fallback |
| `backend/src/services/twenty-opportunity.js` | `opportunityFieldsEqual`; in-memory amount after diff |
| `backend/src/services/twenty-inflight-cache.js` | promise map for warehouse / company / person |
| `backend/src/services/twenty-sync.js` | one opportunity write; combo fetch; no second amount list |
| `backend/src/services/deal-sync-pool.js` | shared concurrency pool + settle-per-deal |
| `backend/src/services/post-parse-twenty-sync.js` | queues, print sheet once, summary log |
| `backend/src/services/auto-approve.js` | collect ids only |
| `backend/src/services/parser.js` | call runner instead of serial loops |
| `backend/src/services/bulk-resync-jobs.js` | pool, no delay |
| `backend/src/services/decor-mk-scan-jobs.js` | pool, no delay |
| `backend/src/services/restore-missing-twenty-jobs.js` | pool, no delay |
| `backend/src/services/product-stream-backfill-jobs.js` | pool, no delay |
| matching `backend/tests/*.test.js` | Vitest, no live Twenty |

---

### Task 1: Config defaults and GraphQL counters

**Files:**
- Modify: `backend/src/config.js`
- Modify: `.env.example`
- Modify: `docker-compose.yml`
- Modify: `backend/src/services/twenty-gql.js`
- Test: `backend/tests/twenty-gql-counters.test.js`
- Test: `backend/tests/config-twenty-sync.test.js`

**Interfaces:**
- Consumes: `process.env.TWENTY_API_RATE_LIMIT_MAX`, `TWENTY_SYNC_CONCURRENCY`
- Produces: `config.twentyApiRateLimitMax` default `720`; `config.twentySyncConcurrency` default `6`; `resetTwentyGqlCounters()`, `getTwentyGqlCounters()` → `{ gqlCount: number, rateLimitedCount: number }`

- [ ] **Step 1: Write failing config test**

Create `backend/tests/config-twenty-sync.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('twenty sync config defaults', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    delete process.env.TWENTY_API_RATE_LIMIT_MAX;
    delete process.env.TWENTY_SYNC_CONCURRENCY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('defaults rate max to 720 and concurrency to 6', async () => {
    const { config } = await import('../src/config.js');
    expect(config.twentyApiRateLimitMax).toBe(720);
    expect(config.twentySyncConcurrency).toBe(6);
  });

  it('reads TWENTY_SYNC_CONCURRENCY from env', async () => {
    process.env.TWENTY_SYNC_CONCURRENCY = '4';
    const { config } = await import('../src/config.js');
    expect(config.twentySyncConcurrency).toBe(4);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- config-twenty-sync.test.js`

Expected: FAIL — `twentySyncConcurrency` undefined and/or rate max is 95.

- [ ] **Step 3: Implement config + env**

In `backend/src/config.js` change:

```js
twentyApiRateLimitMax: parseInt(process.env.TWENTY_API_RATE_LIMIT_MAX || '720', 10),
twentyApiRateLimitWindowMs: parseInt(process.env.TWENTY_API_RATE_LIMIT_WINDOW_MS || '60000', 10),
twentySyncConcurrency: parseInt(process.env.TWENTY_SYNC_CONCURRENCY || '6', 10),
```

In `.env.example` replace the rate-limit comment/block with:

```
# Client token-bucket (keep below Twenty API_RATE_LIMITING_LONG_LIMIT, default 800)
TWENTY_API_RATE_LIMIT_MAX=720
TWENTY_API_RATE_LIMIT_WINDOW_MS=60000
TWENTY_SYNC_CONCURRENCY=6
```

In `docker-compose.yml` change the rate-limit default and add concurrency:

```
- TWENTY_API_RATE_LIMIT_MAX=${TWENTY_API_RATE_LIMIT_MAX:-720}
- TWENTY_API_RATE_LIMIT_WINDOW_MS=${TWENTY_API_RATE_LIMIT_WINDOW_MS:-60000}
- TWENTY_SYNC_CONCURRENCY=${TWENTY_SYNC_CONCURRENCY:-6}
```

- [ ] **Step 4: Write failing counter test**

Create `backend/tests/twenty-gql-counters.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('axios', () => ({ default: { post: vi.fn() } }));

describe('twenty gql counters', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('counts one logical gql call and a 429 retry as rate_limited', async () => {
    const axios = (await import('axios')).default;
    const {
      gql,
      resetTwentyGqlCounters,
      getTwentyGqlCounters,
    } = await import('../src/services/twenty-gql.js');

    resetTwentyGqlCounters();
    axios.post
      .mockResolvedValueOnce({
        status: 200,
        data: { errors: [{ message: 'Limit reached (100 tokens per 60000 ms)' }] },
      })
      .mockResolvedValueOnce({ status: 200, data: { data: { ok: true } } });

    await gql('http://t/graphql', 'tok', 'query { ping }');

    expect(getTwentyGqlCounters()).toEqual({ gqlCount: 1, rateLimitedCount: 1 });
    expect(axios.post).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 5: Run counter test to verify it fails**

Run: `cd backend && npm test -- twenty-gql-counters.test.js`

Expected: FAIL — exports missing.

- [ ] **Step 6: Implement counters**

At the top of `backend/src/services/twenty-gql.js` (after imports):

```js
let gqlCount = 0;
let rateLimitedCount = 0;

export function resetTwentyGqlCounters() {
  gqlCount = 0;
  rateLimitedCount = 0;
}

export function getTwentyGqlCounters() {
  return { gqlCount, rateLimitedCount };
}
```

At the start of `gql()`, when `attempt === 0`, do `gqlCount += 1`.

Where a rate-limit error is detected (existing `rateLimitMessage` / status 429), do `rateLimitedCount += 1` before retry.

- [ ] **Step 7: Run both tests**

Run: `cd backend && npm test -- config-twenty-sync.test.js twenty-gql-counters.test.js twenty-config.test.js twenty-rate-limit.test.js`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/src/config.js backend/src/services/twenty-gql.js .env.example docker-compose.yml backend/tests/config-twenty-sync.test.js backend/tests/twenty-gql-counters.test.js
git commit -m "feat: raise parser Twenty client limit and add gql counters"
```

---

### Task 2: Field-level skip (identity unchanged)

**Files:**
- Modify: `backend/src/services/twenty-line-item.js`
- Modify: `backend/src/services/twenty-line-items-sync.js`
- Test: `backend/tests/twenty-line-item-fields-equal.test.js`
- Test: `backend/tests/twenty-line-items-sync.test.js` (add `applyFieldSkip` cases; do not change identity `computeLineItemDiff` expectations)

**Interfaces:**
- Consumes: `buildLineItemUpdateInput(item, options)`, `productStreamsEqual`, `sortProductStreams`, `coerceProductStreams`
- Produces: `lineItemFieldsEqual(existingNode, desiredInput) => boolean`; `applyFieldSkip(diff, existingLineItems, lineItemOptions) => diff`

- [ ] **Step 1: Write failing equality tests**

Create `backend/tests/twenty-line-item-fields-equal.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { buildLineItemUpdateInput } from '../src/services/twenty-line-item.js';
import { lineItemFieldsEqual } from '../src/services/twenty-line-item.js';

function existing(overrides = {}) {
  return {
    id: 'li-1',
    name: 'Баннер',
    stage: 'V_RABOTE',
    istochnik: 'PARSER',
    productStream: ['BRANDING'],
    kolichestvo: 2,
    amount: { amountMicros: 5_000_000, currencyCode: 'RUB' },
    kommentariy: 'old',
    tip: 'BANNERA',
    tipDetail: null,
    ...overrides,
  };
}

describe('lineItemFieldsEqual', () => {
  it('is true when payload fields match, ignoring stage', () => {
    const item = {
      name: 'Баннер',
      quantity_num: 2,
      price: 5,
      comment: '',
      productStreams: ['BRANDING'],
    };
    const desired = buildLineItemUpdateInput(item, {});
    expect(lineItemFieldsEqual(existing(), desired)).toBe(true);
  });

  it('is false when amount micros differ', () => {
    const item = {
      name: 'Баннер',
      quantity_num: 2,
      price: 6,
      comment: '',
      productStreams: ['BRANDING'],
    };
    const desired = buildLineItemUpdateInput(item, {});
    expect(lineItemFieldsEqual(existing(), desired)).toBe(false);
  });

  it('does not treat empty local comment as a change', () => {
    const item = {
      name: 'Баннер',
      quantity_num: 2,
      price: 5,
      comment: '',
      productStreams: ['BRANDING'],
    };
    const desired = buildLineItemUpdateInput(item, {});
    expect(desired.kommentariy).toBeUndefined();
    expect(lineItemFieldsEqual(existing({ kommentariy: 'kept' }), desired)).toBe(true);
  });
});
```

Add to `backend/tests/twenty-line-items-sync.test.js` inside a new describe:

```js
import { applyFieldSkip } from '../src/services/twenty-line-items-sync.js';

describe('applyFieldSkip', () => {
  it('drops identity updates whose payload fields already match', () => {
    const existing = [{
      id: 'li-1',
      name: 'Баннер',
      stage: 'NOVYY',
      istochnik: 'PARSER',
      productStream: ['BRANDING'],
      kolichestvo: 1,
      amount: { amountMicros: 100_000_000, currencyCode: 'RUB' },
      kommentariy: '',
    }];
    const item = {
      id: 10,
      name: 'Баннер',
      quantity_num: 1,
      price: 100,
      comment: '',
      productStreams: ['BRANDING'],
    };
    const identity = {
      toUpdate: [{ twentyId: 'li-1', item }],
      toCreate: [],
      toDelete: [],
      preserved: [],
    };
    const skipped = applyFieldSkip(identity, existing, {});
    expect(skipped.toUpdate).toEqual([]);
  });
});
```

Use the same `price`/`amount` relationship as `buildLineItemUpdateInput` in this repo (unlocked unit = line total / qty). If the first equality test fails on amount math, align the fixture micros with whatever `buildLineItemUpdateInput` actually emits for `price: 5`, `quantity_num: 2` — do not change the production formula.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npm test -- twenty-line-item-fields-equal.test.js twenty-line-items-sync.test.js -t applyFieldSkip`

Expected: FAIL — `lineItemFieldsEqual` / `applyFieldSkip` not exported.

- [ ] **Step 3: Implement equality + skip**

In `backend/src/services/twenty-line-item.js` add:

```js
import { productStreamsEqual, coerceProductStreams } from './product-stream.js';

export function lineItemFieldsEqual(existing, desired) {
  if (!existing) return false;
  if ((existing.kolichestvo ?? 1) !== (desired.kolichestvo ?? 1)) return false;
  if ((existing.amount?.amountMicros ?? 0) !== (desired.amount?.amountMicros ?? 0)) return false;
  if ((existing.istochnik || 'PARSER') !== (desired.istochnik || 'PARSER')) return false;
  if (!productStreamsEqual(
    coerceProductStreams(existing.productStream),
    coerceProductStreams(desired.productStream),
  )) return false;
  if (Object.prototype.hasOwnProperty.call(desired, 'kommentariy')) {
    if ((existing.kommentariy || '') !== (desired.kommentariy || '')) return false;
  }
  if (Object.prototype.hasOwnProperty.call(desired, 'tip')) {
    if ((existing.tip || null) !== (desired.tip || null)) return false;
  }
  if (Object.prototype.hasOwnProperty.call(desired, 'tipDetail')) {
    if ((existing.tipDetail || null) !== (desired.tipDetail || null)) return false;
  }
  return true;
}
```

In `backend/src/services/twenty-line-items-sync.js` add:

```js
import { buildLineItemUpdateInput, lineItemFieldsEqual } from './twenty-line-item.js';

export function applyFieldSkip(diff, existingLineItems, lineItemOptions = {}) {
  const byId = new Map((existingLineItems || []).map((li) => [li.id, li]));
  const toUpdate = (diff.toUpdate || []).filter(({ twentyId, item }) => {
    const current = byId.get(twentyId);
    const desired = buildLineItemUpdateInput(item, lineItemOptions);
    return !lineItemFieldsEqual(current, desired);
  });
  return { ...diff, toUpdate };
}
```

Expand `listLineItemsForOpportunity` selection to:

```
id name stage istochnik productStream kolichestvo kommentariy tip tipDetail
amount { amountMicros currencyCode }
```

Do **not** change `computeLineItemDiff` (existing identity tests must stay green).

- [ ] **Step 4: Call applyFieldSkip from syncLineItemsDiff**

Immediately after `computeLineItemDiff(...)` in `syncLineItemsDiff`, replace `const { toUpdate, ...}` with:

```js
  const identity = computeLineItemDiff(/* same args as today */);
  const { toUpdate, toCreate, toDelete, preserved } = applyFieldSkip(
    identity,
    existingLineItems,
    {
      deal,
      restorationList,
      neNasheBrandingList,
      neNasheDecorMkList,
      tipRules,
    },
  );
```

- [ ] **Step 5: Run tests**

Run: `cd backend && npm test -- twenty-line-item-fields-equal.test.js twenty-line-items-sync.test.js twenty-line-item.test.js`

Expected: PASS. If `twenty-line-item.test.js` does not exist, omit it.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/twenty-line-item.js backend/src/services/twenty-line-items-sync.js backend/tests/twenty-line-item-fields-equal.test.js backend/tests/twenty-line-items-sync.test.js
git commit -m "feat: skip unchanged Twenty line-item updates"
```

---

### Task 3: Batch create / delete / upsert

**Files:**
- Create: `backend/src/services/twenty-batch.js`
- Modify: `backend/src/services/twenty-line-items-sync.js`
- Test: `backend/tests/twenty-batch.test.js`

**Interfaces:**
- Consumes: `gql(apiUrl, apiToken, query, variables)`, `assertHttpSuccess`, `assertGqlSuccess`
- Produces:
  - `TWENTY_BATCH_SIZE = 60`
  - `TWENTY_ALIAS_UPDATE_MAX = 20`
  - `chunk(items, size) => items[][]`
  - `isSchemaBatchError(err) => boolean` — true when message matches `/unknown argument|cannot query field|upsertDealLineItems/i` or `/did not exist/i`, and not 429/5xx
  - `createDealLineItemsBatch({ gql, apiUrl, apiToken, inputs, assertHttpSuccess, assertGqlSuccess }) => { id: string }[]`
  - `deleteDealLineItemsBatch({ gql, apiUrl, apiToken, ids, assertHttpSuccess, assertGqlSuccess })`
  - `upsertDealLineItemsBatch({ gql, apiUrl, apiToken, rows, assertHttpSuccess, assertGqlSuccess, allowAliasFallback })` where `rows` is `{ id, data }[]`

- [ ] **Step 1: Write failing batch tests**

Create `backend/tests/twenty-batch.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';
import {
  chunk,
  TWENTY_BATCH_SIZE,
  TWENTY_ALIAS_UPDATE_MAX,
  createDealLineItemsBatch,
  deleteDealLineItemsBatch,
  upsertDealLineItemsBatch,
  isSchemaBatchError,
} from '../src/services/twenty-batch.js';

describe('chunk', () => {
  it('splits to 60', () => {
    const items = Array.from({ length: 61 }, (_, i) => i);
    const parts = chunk(items, TWENTY_BATCH_SIZE);
    expect(parts).toHaveLength(2);
    expect(parts[0]).toHaveLength(60);
    expect(parts[1]).toHaveLength(1);
  });
});

describe('createDealLineItemsBatch', () => {
  it('sends one mutation and maps ids by index', async () => {
    const gql = vi.fn().mockResolvedValue({
      status: 200,
      data: { data: { createDealLineItems: [{ id: 'a' }, { id: 'b' }] } },
    });
    const ids = await createDealLineItemsBatch({
      gql,
      apiUrl: 'http://t',
      apiToken: 'tok',
      inputs: [{ name: 'A' }, { name: 'B' }],
      assertHttpSuccess: () => {},
      assertGqlSuccess: () => {},
    });
    expect(ids.map((x) => x.id)).toEqual(['a', 'b']);
    expect(gql).toHaveBeenCalledTimes(1);
    expect(gql.mock.calls[0][2]).toMatch(/createDealLineItems/);
  });

  it('fails the deal when response length mismatches', async () => {
    const gql = vi.fn().mockResolvedValue({
      status: 200,
      data: { data: { createDealLineItems: [{ id: 'a' }] } },
    });
    await expect(createDealLineItemsBatch({
      gql,
      apiUrl: 'http://t',
      apiToken: 'tok',
      inputs: [{ name: 'A' }, { name: 'B' }],
      assertHttpSuccess: () => {},
      assertGqlSuccess: () => {},
    })).rejects.toThrow(/length/);
  });
});

describe('upsertDealLineItemsBatch', () => {
  it('does not use updateMany with a single shared body', async () => {
    const gql = vi.fn().mockResolvedValue({
      status: 200,
      data: { data: { upsertDealLineItems: [{ id: '1' }, { id: '2' }] } },
    });
    await upsertDealLineItemsBatch({
      gql,
      apiUrl: 'http://t',
      apiToken: 'tok',
      rows: [
        { id: '1', data: { amount: { amountMicros: 1, currencyCode: 'RUB' } } },
        { id: '2', data: { amount: { amountMicros: 2, currencyCode: 'RUB' } } },
      ],
      assertHttpSuccess: () => {},
      assertGqlSuccess: () => {},
      allowAliasFallback: false,
    });
    const query = gql.mock.calls[0][2];
    expect(query).toMatch(/upsertDealLineItems/);
    expect(query).not.toMatch(/updateDealLineItems\(/);
  });

  it('falls back to at most 20 aliased updates on schema error', async () => {
    const gql = vi.fn()
      .mockRejectedValueOnce(new Error('Cannot query field upsertDealLineItems'))
      .mockResolvedValue({
        status: 200,
        data: { data: { u0: { id: '1' }, u1: { id: '2' } } },
      });
    await upsertDealLineItemsBatch({
      gql,
      apiUrl: 'http://t',
      apiToken: 'tok',
      rows: [
        { id: '1', data: { kolichestvo: 1 } },
        { id: '2', data: { kolichestvo: 2 } },
      ],
      assertHttpSuccess: () => {},
      assertGqlSuccess: () => {},
      allowAliasFallback: true,
    });
    const aliasQuery = gql.mock.calls[1][2];
    expect((aliasQuery.match(/updateDealLineItem/g) || []).length).toBe(2);
    expect((aliasQuery.match(/updateDealLineItem/g) || []).length).toBeLessThanOrEqual(TWENTY_ALIAS_UPDATE_MAX);
  });
});

describe('isSchemaBatchError', () => {
  it('is true for missing field, false for 429', () => {
    expect(isSchemaBatchError(new Error('Cannot query field upsertDealLineItems'))).toBe(true);
    expect(isSchemaBatchError(new Error('Limit reached (100 tokens per 60000 ms)'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- twenty-batch.test.js`

Expected: FAIL — module missing.

- [ ] **Step 3: Implement `twenty-batch.js`**

```js
export const TWENTY_BATCH_SIZE = 60;
export const TWENTY_ALIAS_UPDATE_MAX = 20;

export function chunk(items, size = TWENTY_BATCH_SIZE) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function isSchemaBatchError(err) {
  const message = err?.message || String(err);
  if (/limit reached|tokens per|429/i.test(message)) return false;
  if (/\b5\d\d\b/.test(message)) return false;
  return /cannot query field|unknown argument|upsertDealLineItems|did not exist|Cannot query/i.test(message);
}

export async function createDealLineItemsBatch({
  gql, apiUrl, apiToken, inputs, assertHttpSuccess, assertGqlSuccess,
}) {
  const created = [];
  for (const part of chunk(inputs, TWENTY_BATCH_SIZE)) {
    const resp = await gql(
      apiUrl,
      apiToken,
      `mutation CreateDealLineItems($data: [DealLineItemCreateInput!]!) {
        createDealLineItems(data: $data) { id }
      }`,
      { data: part },
    );
    assertHttpSuccess(resp, apiUrl);
    assertGqlSuccess(resp, 'Failed to create deal line items in Twenty');
    const rows = resp.data?.data?.createDealLineItems || [];
    if (rows.length !== part.length) {
      throw new Error(`createDealLineItems length mismatch: sent ${part.length}, got ${rows.length}`);
    }
    created.push(...rows);
  }
  return created;
}

export async function deleteDealLineItemsBatch({
  gql, apiUrl, apiToken, ids, assertHttpSuccess, assertGqlSuccess,
}) {
  for (const part of chunk(ids, TWENTY_BATCH_SIZE)) {
    const resp = await gql(
      apiUrl,
      apiToken,
      `mutation DeleteDealLineItems($ids: [ID!]!) {
        deleteDealLineItems(filter: { id: { in: $ids } }) { id }
      }`,
      { ids: part },
    );
    assertHttpSuccess(resp, apiUrl);
    assertGqlSuccess(resp, 'Failed to delete deal line items in Twenty');
  }
}

async function upsertOnce({ gql, apiUrl, apiToken, part, assertHttpSuccess, assertGqlSuccess }) {
  const resp = await gql(
    apiUrl,
    apiToken,
    `mutation UpsertDealLineItems($data: [DealLineItemUpsertInput!]!) {
      upsertDealLineItems(data: $data) { id }
    }`,
    { data: part.map((row) => ({ ...row.data, id: row.id })) },
  );
  assertHttpSuccess(resp, apiUrl);
  assertGqlSuccess(resp, 'Failed to upsert deal line items in Twenty');
  return resp;
}

async function aliasedUpdates({ gql, apiUrl, apiToken, rows, assertHttpSuccess, assertGqlSuccess }) {
  for (const part of chunk(rows, TWENTY_ALIAS_UPDATE_MAX)) {
    const fields = part.map((row, i) => (
      `u${i}: updateDealLineItem(id: $id${i}, data: $data${i}) { id }`
    )).join('\n');
    const varDefs = part.map((_, i) => `$id${i}: ID!, $data${i}: DealLineItemUpdateInput!`).join(', ');
    const variables = {};
    part.forEach((row, i) => {
      variables[`id${i}`] = row.id;
      variables[`data${i}`] = row.data;
    });
    const resp = await gql(apiUrl, apiToken, `mutation AliasedUpdates(${varDefs}) { ${fields} }`, variables);
    assertHttpSuccess(resp, apiUrl);
    assertGqlSuccess(resp, 'Failed to update deal line items in Twenty');
  }
}

export async function upsertDealLineItemsBatch(args) {
  const { allowAliasFallback = true } = args;
  for (const part of chunk(args.rows, TWENTY_BATCH_SIZE)) {
    try {
      await upsertOnce({ ...args, part });
    } catch (err) {
      if (!allowAliasFallback || !isSchemaBatchError(err)) throw err;
      await aliasedUpdates({ ...args, rows: part });
    }
  }
}

export async function updateDealLineItemsSameDataBatch({
  gql, apiUrl, apiToken, ids, data, assertHttpSuccess, assertGqlSuccess,
}) {
  for (const part of chunk(ids, TWENTY_BATCH_SIZE)) {
    const resp = await gql(
      apiUrl,
      apiToken,
      `mutation UpdateDealLineItems($ids: [ID!]!, $data: DealLineItemUpdateInput!) {
        updateDealLineItems(filter: { id: { in: $ids } }, data: $data) { id }
      }`,
      { ids: part, data },
    );
    assertHttpSuccess(resp, apiUrl);
    assertGqlSuccess(resp, 'Failed to batch-update deal line items in Twenty');
  }
}
```

If prod schema uses a different upsert input type name, keep the GraphQL above first; schema-error fallback covers it. Do not invent a second upsert shape in this task.

- [ ] **Step 4: Rewrite syncLineItemsDiff write loops to batches**

Replace the three `for` loops in `syncLineItemsDiff` with:

1. `deleteDealLineItemsBatch` for `toDelete`, then `publishDealLineItemEvent('DELETED', ...)` per id.
2. `upsertDealLineItemsBatch` with `rows = toUpdate.map(({ twentyId, item }) => ({ id: twentyId, data: buildLineItemUpdateInput(item, lineItemOptions) }))`, then SQLite `twenty_id` + UPDATED events per row.
3. Resolve warehouse ids (still per unique name), build `inputs` via `buildLineItemCreateInput` (position `first` for index 0 else index), `createDealLineItemsBatch`, map `created[i].id` → `toCreate[i]`. On length mismatch the helper already throws.

Keep existing log steps (`line_items.delete` / `update` / `create`) at batch start with counts, not per row, except events stay per id.

- [ ] **Step 5: Batch cancel and restore**

In `cancelLineItemsForOpportunity`, collect ids where `stage !== cancelledStage`, then one `updateDealLineItemsSameDataBatch` with `{ stage: cancelledStage, amount: ZERO_RUB_AMOUNT }`. If that mutation is a schema error, fall back to `upsertDealLineItemsBatch` / aliased updates with the same per-id data. Do not leave the old per-item loop as the happy path.

In `restoreDealInTwenty` (`backend/src/services/twenty-sync.js`), replace the per-entry `updateDealLineItem` loop with `upsertDealLineItemsBatch` rows `{ id, data: { stage: entry.stage ?? null } }` for snapshot entries that exist in `existingLineItemIds`. Skip missing ids as today.

- [ ] **Step 6: Run tests**

Run: `cd backend && npm test -- twenty-batch.test.js twenty-line-items-sync.test.js twenty-sync.test.js`

Expected: PASS. Fix any mocks that assumed per-item `updateDealLineItem` / `createDealLineItem` strings — they must accept the batch operation names.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/twenty-batch.js backend/src/services/twenty-line-items-sync.js backend/tests/twenty-batch.test.js backend/tests/twenty-line-items-sync.test.js backend/tests/twenty-sync.test.js
git commit -m "feat: batch Twenty line-item create, update, and delete"
```

---

### Task 4: One opportunity write and no-op skip

**Files:**
- Modify: `backend/src/services/twenty-opportunity.js`
- Modify: `backend/src/services/twenty-sync.js`
- Modify: `backend/src/services/twenty-line-items-sync.js` (combo fetch)
- Test: `backend/tests/twenty-opportunity-equal.test.js`
- Test: `backend/tests/twenty-sync.test.js`

**Interfaces:**
- Consumes: `buildOpportunityInput`, `buildOpportunityAmountInputFromLineItems`, `applyFieldSkip` result
- Produces:
  - `opportunityFieldsEqual(existingOpp, nextInput) => boolean`
  - `applyLineItemMutationsInMemory(existingLineItems, { toUpdate, toCreate, toDelete, createdNodes }) => lineItems`
  - `fetchOpportunityAndLineItems(gql, apiUrl, apiToken, oppId) => { opportunity, lineItems }`
  - `syncDealToTwenty` may return `{ action: 'noop', twentyId }` when no writes

- [ ] **Step 1: Write failing opportunity-equal + no-op tests**

Create `backend/tests/twenty-opportunity-equal.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { opportunityFieldsEqual } from '../src/services/twenty-opportunity.js';

describe('opportunityFieldsEqual', () => {
  const next = {
    name: 'Deal A',
    amount: { amountMicros: 10_000_000, currencyCode: 'RUB' },
    companyId: 'c1',
    closeDate: '2026-09-14',
  };

  it('matches when name, amount, company, and closeDate agree', () => {
    expect(opportunityFieldsEqual({
      name: 'Deal A',
      amount: { amountMicros: 10_000_000 },
      companyId: 'c1',
      closeDate: '2026-09-14',
    }, next)).toBe(true);
  });

  it('detects amount change', () => {
    expect(opportunityFieldsEqual({
      name: 'Deal A',
      amount: { amountMicros: 1 },
      companyId: 'c1',
      closeDate: '2026-09-14',
    }, next)).toBe(false);
  });
});
```

In `backend/tests/twenty-sync.test.js` add (mirror existing axios/gql mock style already in that file):

```js
  it('returns noop and does not updateOpportunity when fields and line items match', async () => {
    // Arrange a synced deal whose listed Twenty line items already match local eligible items
    // and whose opportunity name/amount/company match buildOpportunityInput.
    const result = await syncDealToTwenty(dealId, { skipPrintSheetRefresh: true });
    expect(result.action).toBe('noop');
    expect(axiosPost.mock.calls.some(([, body]) => String(body.query).includes('updateOpportunity'))).toBe(false);
    expect(axiosPost.mock.calls.some(([, body]) => String(body.query).includes('updateOpportunityAmount'))).toBe(false);
  });

  it('does not list line items a second time after syncLineItemsDiff', async () => {
    // Use an existing update-path test fixture that performs at least one line-item write.
    const listCalls = axiosPost.mock.calls.filter(([, body]) => String(body.query).includes('dealLineItems'));
    expect(listCalls.length).toBe(1);
  });
```

Wire the first new test with the same `gqlOk` / `axiosPost` helpers already in `twenty-sync.test.js`. If the current helper names differ, use those — do not invent a second mock stack.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npm test -- twenty-opportunity-equal.test.js twenty-sync.test.js -t "returns noop"`

Expected: FAIL.

- [ ] **Step 3: Implement compare + in-memory amount**

In `backend/src/services/twenty-opportunity.js`:

```js
function linkUrl(value) {
  return value?.primaryLinkUrl || value || null;
}

export function opportunityFieldsEqual(existing, next) {
  if (!existing) return false;
  if ((existing.name || '') !== (next.name || '')) return false;
  if ((existing.amount?.amountMicros ?? 0) !== (next.amount?.amountMicros ?? 0)) return false;
  if ((existing.companyId || null) !== (next.companyId || null)) return false;
  if ((existing.pointOfContactId || null) !== (next.pointOfContactId || null)) return false;
  if ((existing.closeDate || '') !== (next.closeDate || '')) return false;
  if ((existing.arrivalTime || null) !== (next.arrivalTime || null)) return false;
  if ((existing.readyTime || null) !== (next.readyTime || null)) return false;
  if ((existing.workTime || null) !== (next.workTime || null)) return false;
  if ((existing.dismantleTime || null) !== (next.dismantleTime || null)) return false;
  if ((existing.loadDate || null) !== (next.loadDate || null)) return false;
  if (linkUrl(existing.tonyLink) !== linkUrl(next.tonyLink)) return false;
  if (linkUrl(existing.bitrixLink) !== linkUrl(next.bitrixLink)) return false;
  return true;
}

export function applyLineItemMutationsInMemory(existingLineItems, {
  toUpdate = [],
  toDelete = [],
  createdNodes = [],
} = {}) {
  const deleted = new Set(toDelete);
  const updates = new Map(toUpdate.map(({ twentyId, item, data }) => [twentyId, data || item]));
  const next = [];
  for (const li of existingLineItems || []) {
    if (deleted.has(li.id)) continue;
    const patch = updates.get(li.id);
    if (!patch) {
      next.push(li);
      continue;
    }
    next.push({
      ...li,
      kolichestvo: patch.kolichestvo ?? li.kolichestvo,
      amount: patch.amount ?? li.amount,
      stage: li.stage,
    });
  }
  for (const node of createdNodes) next.push(node);
  return next;
}
```

- [ ] **Step 4: Combo fetch + updateDealInTwenty**

Add `fetchOpportunityAndLineItems` in `twenty-line-items-sync.js`:

```js
export async function fetchOpportunityAndLineItems(
  gql, apiUrl, apiToken, oppId, assertHttpSuccess, assertGqlSuccess,
) {
  const resp = await gql(
    apiUrl,
    apiToken,
    `query OpportunityAndLineItems($oppId: ID!) {
      opportunities(filter: { id: { eq: $oppId } }, first: 1) {
        edges {
          node {
            id name companyId pointOfContactId closeDate
            arrivalTime readyTime workTime dismantleTime loadDate
            amount { amountMicros currencyCode }
            tonyLink { primaryLinkUrl }
            bitrixLink { primaryLinkUrl }
          }
        }
      }
      dealLineItems(filter: { opportunityId: { eq: $oppId } }) {
        edges {
          node {
            id name stage istochnik productStream kolichestvo kommentariy tip tipDetail
            amount { amountMicros currencyCode }
          }
        }
      }
    }`,
    { oppId },
  );
  assertHttpSuccess(resp, apiUrl);
  assertGqlSuccess(resp, 'Failed to load opportunity and line items');
  return {
    opportunity: resp.data?.data?.opportunities?.edges?.[0]?.node || null,
    lineItems: resp.data?.data?.dealLineItems?.edges?.map((e) => e.node) || [],
  };
}
```

In `updateDealInTwenty`:

1. Delete `updateOpportunityAmountFromLineItems` and all call sites (update and create).
2. Non-scoped: `fetchOpportunityAndLineItems` instead of `listLineItemsForOpportunity`.
3. Run identity + `applyFieldSkip` + batches as today via `syncLineItemsDiff`.
4. Build `oppInput` from `buildOpportunityInput` but set `amount` from `buildOpportunityAmountInputFromLineItems(applyLineItemMutationsInMemory(...))` after the diff (include created nodes with `amount`/`kolichestvo` from create input and `stage: DEFAULT_OPPORTUNITY_STAGE`).
5. If `toUpdate/toCreate/toDelete` are all empty **and** `opportunityFieldsEqual(fetched, oppInput)` → return `{ twentyId: oppId, action: 'noop' }` without `updateOpportunity`.
6. Otherwise one `updateOpportunity` (skip this write on scoped sync except when line items changed — then amount-only patch).
7. Create path: `createOpportunity` already has amount; do not follow with a second amount mutation.

`syncDealToTwenty` must propagate `action: 'noop'`.

- [ ] **Step 5: Run tests**

Run: `cd backend && npm test -- twenty-opportunity-equal.test.js twenty-opportunity.test.js twenty-sync.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/twenty-opportunity.js backend/src/services/twenty-sync.js backend/src/services/twenty-line-items-sync.js backend/tests/twenty-opportunity-equal.test.js backend/tests/twenty-sync.test.js
git commit -m "feat: skip no-op opportunity writes and drop second amount update"
```

---

### Task 5: In-flight cache and deal sync pool

**Files:**
- Create: `backend/src/services/twenty-inflight-cache.js`
- Create: `backend/src/services/deal-sync-pool.js`
- Modify: `backend/src/services/twenty-sync.js` (`findOrCreateWarehouseItem` / company / person)
- Test: `backend/tests/twenty-inflight-cache.test.js`
- Test: `backend/tests/deal-sync-pool.test.js`

**Interfaces:**
- Consumes: `createPool` from `fetch-pool.js`, `config.twentySyncConcurrency`
- Produces:
  - `createInFlightCache() => { getOrStart(key, fn): Promise<T> }`
  - `runDealSyncPool(dealIds, worker, { concurrency, onDealSettled }) => Promise<void>`
  - Optional module-level `setTwentySyncCaches({ warehouse, company, person })` used by the runner; `findOrCreateWarehouseItem` uses `warehouse.getOrStart(name, ...)`

- [ ] **Step 1: Write failing cache + pool tests**

```js
// backend/tests/twenty-inflight-cache.test.js
import { describe, it, expect, vi } from 'vitest';
import { createInFlightCache } from '../src/services/twenty-inflight-cache.js';

describe('createInFlightCache', () => {
  it('shares one in-flight promise per key', async () => {
    const cache = createInFlightCache();
    let starts = 0;
    const fn = () => {
      starts += 1;
      return new Promise((resolve) => setTimeout(() => resolve('id-1'), 20));
    };
    const [a, b] = await Promise.all([
      cache.getOrStart('Баннер', fn),
      cache.getOrStart('Баннер', fn),
    ]);
    expect(a).toBe('id-1');
    expect(b).toBe('id-1');
    expect(starts).toBe(1);
  });
});
```

```js
// backend/tests/deal-sync-pool.test.js
import { describe, it, expect } from 'vitest';
import { runDealSyncPool } from '../src/services/deal-sync-pool.js';

describe('runDealSyncPool', () => {
  it('runs two deals overlapping when concurrency is 2', async () => {
    let inFlight = 0;
    let max = 0;
    const started = [];
    await runDealSyncPool([1, 2], async (id) => {
      started.push(id);
      inFlight += 1;
      max = Math.max(max, inFlight);
      await new Promise((r) => setTimeout(r, 30));
      inFlight -= 1;
      return id;
    }, { concurrency: 2 });
    expect(max).toBe(2);
    expect(started).toHaveLength(2);
  });

  it('continues after a failed deal and reports settle', async () => {
    const settled = [];
    await runDealSyncPool([1, 2], async (id) => {
      if (id === 1) throw new Error('boom');
      return { action: 'updated' };
    }, {
      concurrency: 2,
      onDealSettled: (event) => settled.push(event),
    });
    expect(settled).toHaveLength(2);
    expect(settled.filter((e) => !e.ok)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npm test -- twenty-inflight-cache.test.js deal-sync-pool.test.js`

Expected: FAIL.

- [ ] **Step 3: Implement cache + pool**

`backend/src/services/twenty-inflight-cache.js`:

```js
export function createInFlightCache() {
  const map = new Map();
  return {
    getOrStart(key, fn) {
      if (!map.has(key)) {
        map.set(key, Promise.resolve().then(fn));
      }
      return map.get(key);
    },
  };
}
```

`backend/src/services/deal-sync-pool.js`:

```js
import { config } from '../config.js';
import { createPool } from './fetch-pool.js';

export async function runDealSyncPool(
  dealIds,
  worker,
  { concurrency = config.twentySyncConcurrency, onDealSettled } = {},
) {
  const run = createPool({ concurrency });
  await Promise.all((dealIds || []).map((dealId) => run(async () => {
    try {
      const result = await worker(dealId);
      onDealSettled?.({ dealId, ok: true, result, error: null });
    } catch (error) {
      onDealSettled?.({ dealId, ok: false, result: null, error });
    }
  })));
}
```

- [ ] **Step 4: Hook warehouse / company / person**

Add to `twenty-sync.js`:

```js
import { createInFlightCache } from './twenty-inflight-cache.js';

let warehouseCacheRef = createInFlightCache();
let companyCacheRef = createInFlightCache();
let personCacheRef = createInFlightCache();

export function setTwentySyncInFlightCaches({ warehouse, company, person } = {}) {
  if (warehouse) warehouseCacheRef = warehouse;
  if (company) companyCacheRef = company;
  if (person) personCacheRef = person;
}

export function resetTwentySyncInFlightCaches() {
  warehouseCacheRef = createInFlightCache();
  companyCacheRef = createInFlightCache();
  personCacheRef = createInFlightCache();
}
```

Wrap `findOrCreateWarehouseItem` body in `warehouseCacheRef.getOrStart(name, async () => { /* existing search+create */ })`.

Wrap `findOrCreateCompany` in `companyCacheRef.getOrStart(code, ...)`.

Wrap `findOrCreatePerson` in `personCacheRef.getOrStart(`${managerName}|${companyTwentyId || ''}`, ...)`.

Keep the SQLite `twenty_id` short-circuit **inside** the factory so a cached id is reused.

- [ ] **Step 5: Run tests**

Run: `cd backend && npm test -- twenty-inflight-cache.test.js deal-sync-pool.test.js twenty-sync.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/twenty-inflight-cache.js backend/src/services/deal-sync-pool.js backend/src/services/twenty-sync.js backend/tests/twenty-inflight-cache.test.js backend/tests/deal-sync-pool.test.js
git commit -m "feat: share warehouse lookups and run deal syncs on a pool"
```

---

### Task 6: Post-parse runner, parser, auto-approve

**Files:**
- Create: `backend/src/services/post-parse-twenty-sync.js`
- Modify: `backend/src/services/auto-approve.js`
- Modify: `backend/src/services/parser.js`
- Test: `backend/tests/post-parse-twenty-sync.test.js`
- Test: `backend/tests/auto-approve.test.js`

**Interfaces:**
- Consumes: `runDealSyncPool`, `syncDealToTwenty`, `cancelDealInTwenty`, `restoreDealInTwenty`, `collectAutoApproveDealIds`, `runPrintSheetRefresh`, `resetTwentyGqlCounters`, `getTwentyGqlCounters`, `setTwentySyncInFlightCaches`, `createInFlightCache`
- Produces:
  - `collectAutoApproveDealIds() => number[]`
  - `runPostParseTwentySync({ resyncDealIds, cancelDealIds, restoreDealIds, autoApproveDealIds }) => { deals, skipped_noop, gql_count, rate_limited, failed, duration_ms }`

- [ ] **Step 1: Write failing runner + collector tests**

```js
// backend/tests/post-parse-twenty-sync.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

const syncDealToTwenty = vi.fn();
const cancelDealInTwenty = vi.fn();
const restoreDealInTwenty = vi.fn();
const runPrintSheetRefresh = vi.fn();

vi.mock('../src/services/twenty-sync.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    syncDealToTwenty: (...args) => syncDealToTwenty(...args),
    cancelDealInTwenty: (...args) => cancelDealInTwenty(...args),
    restoreDealInTwenty: (...args) => restoreDealInTwenty(...args),
    runPrintSheetRefresh: (...args) => runPrintSheetRefresh(...args),
    setTwentySyncInFlightCaches: actual.setTwentySyncInFlightCaches ?? vi.fn(),
  };
});

vi.mock('../src/services/twenty-gql.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    resetTwentyGqlCounters: vi.fn(),
    getTwentyGqlCounters: () => ({ gqlCount: 3, rateLimitedCount: 1 }),
  };
});

import { runPostParseTwentySync } from '../src/services/post-parse-twenty-sync.js';

describe('runPostParseTwentySync', () => {
  beforeEach(() => {
    syncDealToTwenty.mockReset().mockResolvedValue({ action: 'updated' });
    cancelDealInTwenty.mockReset().mockResolvedValue({ action: 'cancelled' });
    restoreDealInTwenty.mockReset().mockResolvedValue({ action: 'restored' });
    runPrintSheetRefresh.mockReset().mockResolvedValue({});
  });

  it('syncs with skipPrintSheetRefresh and refreshes print sheet once after failures', async () => {
    syncDealToTwenty
      .mockResolvedValueOnce({ action: 'noop' })
      .mockRejectedValueOnce(new Error('fail'));
    const summary = await runPostParseTwentySync({
      resyncDealIds: [1, 2],
      cancelDealIds: [],
      restoreDealIds: [],
      autoApproveDealIds: [],
    });
    expect(syncDealToTwenty).toHaveBeenNthCalledWith(1, 1, { skipPrintSheetRefresh: true });
    expect(syncDealToTwenty).toHaveBeenNthCalledWith(2, 2, { skipPrintSheetRefresh: true });
    expect(runPrintSheetRefresh).toHaveBeenCalledTimes(1);
    expect(summary.skipped_noop).toBe(1);
    expect(summary.failed).toBe(1);
    expect(summary.deals).toBe(2);
  });

  it('runs queues in order resync, cancel, restore, auto-approve', async () => {
    const order = [];
    syncDealToTwenty.mockImplementation(async (id) => {
      order.push(`s${id}`);
      return { action: 'updated' };
    });
    cancelDealInTwenty.mockImplementation(async (id) => {
      order.push(`c${id}`);
      return { action: 'cancelled' };
    });
    restoreDealInTwenty.mockImplementation(async (id) => {
      order.push(`r${id}`);
      return { action: 'restored' };
    });
    await runPostParseTwentySync({
      resyncDealIds: [1],
      cancelDealIds: [2],
      restoreDealIds: [3],
      autoApproveDealIds: [4],
    });
    expect(order).toEqual(['s1', 'c2', 'r3', 's4']);
  });
});
```

Keep `backend/tests/auto-approve.test.js` focused on `shouldAutoApproveDeal` (existing cases). Do not add a SQLite collector test here — `runPostParseTwentySync` already covers that auto-approve ids are synced with `skipPrintSheetRefresh: true`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npm test -- post-parse-twenty-sync.test.js`

Expected: FAIL — module missing.

- [ ] **Step 3: Implement collector**

Replace the body of `processAutoApprovals` in `backend/src/services/auto-approve.js`:

```js
export function collectAutoApproveDealIds() {
  const mode = getSetting('approval_mode');
  if (mode !== 'auto' && mode !== 'semi') return [];
  const db = getDb();
  const blacklist = loadBlacklist(db);
  const pending = db.prepare("SELECT id FROM deals WHERE approval_status = 'pending'").all();
  const ids = [];
  for (const { id } of pending) {
    const items = db.prepare('SELECT * FROM deal_items WHERE deal_id = ?').all(id);
    if (shouldAutoApproveDeal(items, blacklist, mode)) ids.push(id);
  }
  return ids;
}

export function processAutoApprovals() {
  const mode = getSetting('approval_mode');
  const dealIds = collectAutoApproveDealIds();
  return {
    mode,
    processed: 0,
    synced: 0,
    failed: 0,
    skipped: 0,
    errors: [],
    dealIds,
  };
}
```

Remove `delay` from this file.

- [ ] **Step 4: Implement runner**

`backend/src/services/post-parse-twenty-sync.js`:

```js
import { runDealSyncPool } from './deal-sync-pool.js';
import {
  syncDealToTwenty,
  cancelDealInTwenty,
  restoreDealInTwenty,
  runPrintSheetRefresh,
  setTwentySyncInFlightCaches,
  resetTwentySyncInFlightCaches,
} from './twenty-sync.js';
import { createInFlightCache } from './twenty-inflight-cache.js';
import { resetTwentyGqlCounters, getTwentyGqlCounters } from './twenty-gql.js';

export async function runPostParseTwentySync({
  resyncDealIds = [],
  cancelDealIds = [],
  restoreDealIds = [],
  autoApproveDealIds = [],
} = {}) {
  const started = Date.now();
  resetTwentyGqlCounters();
  setTwentySyncInFlightCaches({
    warehouse: createInFlightCache(),
    company: createInFlightCache(),
    person: createInFlightCache(),
  });

  let skipped_noop = 0;
  let failed = 0;
  const deals =
    resyncDealIds.length + cancelDealIds.length + restoreDealIds.length + autoApproveDealIds.length;

  const onSettle = ({ ok, result }) => {
    if (!ok) failed += 1;
    else if (result?.action === 'noop') skipped_noop += 1;
  };

  await runDealSyncPool(resyncDealIds, (id) => syncDealToTwenty(id, { skipPrintSheetRefresh: true }), { onDealSettled: onSettle });
  await runDealSyncPool(cancelDealIds, (id) => cancelDealInTwenty(id), { onDealSettled: onSettle });
  await runDealSyncPool(restoreDealIds, (id) => restoreDealInTwenty(id), { onDealSettled: onSettle });
  await runDealSyncPool(autoApproveDealIds, (id) => syncDealToTwenty(id, { skipPrintSheetRefresh: true }), { onDealSettled: onSettle });

  try {
    await runPrintSheetRefresh();
  } catch (err) {
    console.warn('[twenty-sync] print_sheet.refresh.failed', err.message);
  }

  const counters = getTwentyGqlCounters();
  const summary = {
    deals,
    skipped_noop,
    gql_count: counters.gqlCount,
    rate_limited: counters.rateLimitedCount,
    failed,
    duration_ms: Date.now() - started,
  };
  console.log(`[twenty-sync] ${new Date().toISOString()} post_parse.done ${JSON.stringify(summary)}`);
  resetTwentySyncInFlightCaches();
  return summary;
}
```

- [ ] **Step 5: Wire parser.js**

Remove the three `for` loops with `delay(1000)` and the `processAutoApprovals()` sync. After `dealsToResync` / missing / restored are collected:

```js
import { collectAutoApproveDealIds } from './auto-approve.js';
import { runPostParseTwentySync } from './post-parse-twenty-sync.js';

const autoApproveDealIds = collectAutoApproveDealIds();
const postParse = await runPostParseTwentySync({
  resyncDealIds: dealsToResync,
  cancelDealIds: inRangeCount === 0 ? [] : missingDeals.map((d) => d.id),
  restoreDealIds: inRangeCount === 0 ? [] : restoredDeals.map((d) => d.id),
  autoApproveDealIds,
});
```

Keep the existing skip of cancel/restore when `inRangeCount === 0` (same as today). Keep per-deal start/done logs if cheap; they are optional now that the summary exists.

Parser return `autoApprove` as `{ mode, dealIds: autoApproveDealIds, postParse }`. Do not report `synced: autoApproveDealIds.length` — that would claim success for failed ids.

- [ ] **Step 6: Run tests**

Run: `cd backend && npm test -- post-parse-twenty-sync.test.js auto-approve.test.js`

Also run any parser tests if present: `cd backend && npm test -- parser`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/post-parse-twenty-sync.js backend/src/services/auto-approve.js backend/src/services/parser.js backend/tests/post-parse-twenty-sync.test.js backend/tests/auto-approve.test.js
git commit -m "feat: run post-parse Twenty sync on a shared pool"
```

---

### Task 7: Bulk jobs drop the 1s delay

**Files:**
- Modify: `backend/src/services/bulk-resync-jobs.js`
- Modify: `backend/src/services/decor-mk-scan-jobs.js`
- Modify: `backend/src/services/restore-missing-twenty-jobs.js`
- Modify: `backend/src/services/product-stream-backfill-jobs.js`
- Test: `backend/tests/bulk-resync-jobs.test.js`
- Test: `backend/tests/decor-mk-scan-jobs.test.js`
- Test: `backend/tests/restore-missing-twenty-jobs.test.js`
- Test: `backend/tests/product-stream-backfill-jobs.test.js` (if it asserts delay or serial order)

**Interfaces:**
- Consumes: `runDealSyncPool`, `syncDealToTwenty(..., { skipPrintSheetRefresh: true })`, `runPrintSheetRefresh`
- Produces: same job progress fields; `dealsDone` increments in `onDealSettled`

- [ ] **Step 1: Write failing assertion that delay is gone**

In `backend/tests/bulk-resync-jobs.test.js` add:

```js
it('does not delay 1s between deals and uses skipPrintSheetRefresh', async () => {
  // start a job with two deal ids using existing test db helpers
  const started = Date.now();
  await /* wait for job completion the same way current tests do */;
  expect(Date.now() - started).toBeLessThan(500);
  expect(syncDealToTwentyMock.mock.calls.every(([, opts]) => opts.skipPrintSheetRefresh)).toBe(true);
  expect(runPrintSheetRefreshMock).toHaveBeenCalledTimes(1);
});
```

Use the same job-start helper already in `bulk-resync-jobs.test.js`. Assert `syncDealToTwenty` was called twice with `{ skipPrintSheetRefresh: true }` and `runPrintSheetRefresh` once. Also add `expect(readFileSync('backend/src/services/bulk-resync-jobs.js','utf8')).not.toMatch(/DELAY_MS/)` (and the same for the other three job files in their tests).

- [ ] **Step 2: Run the new test to see it fail**

Run: `cd backend && npm test -- bulk-resync-jobs.test.js -t "does not delay"`

Expected: FAIL while `DELAY_MS` still exists **or** the timing assertion fails because of the 1s sleep.

- [ ] **Step 3: Replace loops**

In each of the four job files, delete `DELAY_MS`, `delay()`, and `if (i > 0) await delay(...)`.

Replace the `for` loop with:

```js
await runDealSyncPool(dealIds, async (dealId) => {
  return syncDealToTwenty(dealId, {
    skipPrintSheetRefresh: true,
    ignoreLineItemStageProtection: true, // only where the file already passed this
    productStreams: ['DECOR', 'MK'],     // only decor-mk-scan-jobs.js
  });
}, {
  onDealSettled: ({ dealId, ok, result, error }) => {
    job.dealsDone += 1;
    if (ok && (result?.action === 'updated' || result?.action === 'updated_empty')) {
      job.dealsUpdated += 1;
    }
    if (!ok) {
      job.dealsFailed += 1;
      if (job.errors.length < MAX_ERRORS) {
        job.errors.push({ dealId, error: error instanceof Error ? error.message : String(error) });
      }
    }
    persistJobProgress(db, job.jobId, job);
  },
});
```

Keep each file's existing success-action checks (`created` for restore-missing, etc.). Keep `runPrintSheetRefresh()` once after the pool, including when `dealsFailed > 0`.

`product-stream-backfill-jobs.js` does not call `syncDealToTwenty`. There, wrap the existing per-deal body in `runDealSyncPool` and remove only the 1s delay. Do not force it through `runPostParseTwentySync`.

- [ ] **Step 4: Run job tests**

Run: `cd backend && npm test -- bulk-resync-jobs.test.js decor-mk-scan-jobs.test.js restore-missing-twenty-jobs.test.js product-stream-backfill-jobs.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/bulk-resync-jobs.js backend/src/services/decor-mk-scan-jobs.js backend/src/services/restore-missing-twenty-jobs.js backend/src/services/product-stream-backfill-jobs.js backend/tests/bulk-resync-jobs.test.js backend/tests/decor-mk-scan-jobs.test.js backend/tests/restore-missing-twenty-jobs.test.js backend/tests/product-stream-backfill-jobs.test.js
git commit -m "feat: run bulk Twenty jobs on the shared deal pool"
```

---

### Task 8: Raise Twenty server API-key limit

**Files:**
- No crmparserv2 source. Dokploy compose for Twenty prod (`oI7-NCBTpfyrxJBitrJrd0` from `BrandingTwentyView` notes) and the staging Twenty compose.
- Optional note: `ops/perf/crmparser-throttle.md` — add a short “superseded for API-key limit” line so the old “leave 55 for UI” advice is not followed.

**Interfaces:**
- Consumes: Dokploy `compose.one` / `compose.update` / `compose.deploy`
- Produces: `twenty-server` env `API_RATE_LIMITING_LONG_LIMIT=800` (TTL stays 60000)

- [ ] **Step 1: Read current Twenty env**

Use Dokploy MCP or `ops/backup/lib/dokploy-client.js`: `compose.one` for prod Twenty. Confirm `API_RATE_LIMITING_LONG_LIMIT` is unset or 100.

- [ ] **Step 2: Patch and deploy Twenty**

Set `API_RATE_LIMITING_LONG_LIMIT=800` on `twenty-server` (and worker only if it also serves GraphQL; default is server-only). Redeploy. Do **not** change `API_RATE_LIMITING_SHORT_*`.

Repeat for staging Twenty.

- [ ] **Step 3: Verify**

```bash
# from Twenty host / docker
docker exec twenty-server printenv API_RATE_LIMITING_LONG_LIMIT
```

Expected: `800`.

Then deploy crmparser with `TWENTY_API_RATE_LIMIT_MAX=720` and `TWENTY_SYNC_CONCURRENCY=6` (Task 1 defaults). Order: Twenty first, parser second.

- [ ] **Step 4: Watch one weekday-fast**

In crmparser logs, find `post_parse.done`. Success: `duration_ms <= 300000`. If higher, inspect `skipped_noop` vs `gql_count` before touching the 800 limit.

- [ ] **Step 5: Commit the ops note only if you edit the repo**

```bash
git add ops/perf/crmparser-throttle.md
git commit -m "docs: Twenty API-key limit is 800; parser client stays at 720"
```

If you did not touch that file, skip the commit.

---

## Self-review (plan vs spec)

| Spec requirement | Task |
|------------------|------|
| Field skip + extra list fields | 2 |
| Batches 60, upsert not updateMany, alias ≤ 20, index map, cancel + restore batches | 3 |
| One opportunity write, in-memory amount, combo fetch, create without second amount | 4 |
| Warehouse/company/person in-flight cache | 5 |
| Pool concurrency 6 | 1 + 5 |
| Runner queues + print sheet once + summary log | 6 |
| Auto-approve collect-only | 6 |
| Parser no 1s delay | 6 |
| Bulk jobs same pool | 7 |
| Client 720 / server 800 | 1 + 8 |
| gql_count / rate_limited | 1 + 6 |
| Manual UI print sheet unchanged | 6 (runner not used there) |
| No Tony/hash/protection changes | all tasks avoid those files’ semantics |
