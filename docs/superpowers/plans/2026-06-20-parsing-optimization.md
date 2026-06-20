# Parsing Optimization (Parallel Prefetch) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut parse time from ~1000s to ~30–60s for ~200 Tony orders by parallelizing all network I/O behind a concurrency pool, while keeping DB/Twenty write logic sequential and behavior-identical.

**Architecture:** Split `runParsing` into two phases — a parallel, pool-limited **prefetch** of all calendar descriptions and Tony orders, then a sequential **apply** phase that runs the existing reconciliation/DB/Twenty logic reading from the prefetched data. Within one order, the page is fetched first (404 gate) then the ~9 category requests run in parallel. A `PARSE_PIPELINE` flag keeps the old sequential path for safe comparison/rollback.

**Tech Stack:** Node.js (ESM), axios, cheerio, better-sqlite3, vitest. Spec: `docs/superpowers/specs/2026-06-20-parsing-optimization-design.md`.

---

## File Structure

- **Create** `backend/src/services/fetch-pool.js` — concurrency limiter (`createPool`) and retry helper (`withRetry`). Single responsibility: rate/concurrency control.
- **Create** `backend/tests/fetch-pool.test.js` — unit tests for the pool and retry.
- **Modify** `backend/src/services/tony-client.js` — parallelize within-order category fetches; accept an injected `run` limiter.
- **Modify** `backend/tests/tony-client.test.js` — add a test asserting all 9 category/sklad requests are made; existing tests must still pass.
- **Modify** `backend/src/config.js` — add `fetchConcurrency`, `parsePipeline`.
- **Modify** `backend/src/services/parser.js` — extract `applyEvent` + `fetchEventData` (pure refactor), then add `prefetchAll` and the `PARSE_PIPELINE` branch.
- **Create** `backend/tests/parser-prefetch.test.js` — equivalence test: `prefetchAll` produces the same per-event data as the legacy sequential fetch.

---

## Task 1: Concurrency pool (`fetch-pool.js`)

**Files:**
- Create: `backend/src/services/fetch-pool.js`
- Test: `backend/tests/fetch-pool.test.js`

- [ ] **Step 1: Write the failing test**

```js
// backend/tests/fetch-pool.test.js
import { describe, it, expect } from 'vitest';
import { createPool } from '../src/services/fetch-pool.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

describe('createPool', () => {
  it('never runs more than `concurrency` tasks at once', async () => {
    const run = createPool({ concurrency: 3 });
    let active = 0;
    let maxActive = 0;
    const task = async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await sleep(20);
      active--;
      return active;
    };
    await Promise.all(Array.from({ length: 12 }, () => run(task)));
    expect(maxActive).toBe(3);
  });

  it('returns each task result and propagates rejections', async () => {
    const run = createPool({ concurrency: 2 });
    const ok = await run(async () => 42);
    expect(ok).toBe(42);
    await expect(run(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  });

  it('with concurrency 1 it serializes (FIFO)', async () => {
    const run = createPool({ concurrency: 1 });
    const order = [];
    await Promise.all([
      run(async () => { await sleep(15); order.push('a'); }),
      run(async () => { order.push('b'); }),
    ]);
    expect(order).toEqual(['a', 'b']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix backend -- fetch-pool`
Expected: FAIL with "Failed to resolve import '../src/services/fetch-pool.js'" / `createPool is not a function`.

- [ ] **Step 3: Write minimal implementation**

```js
// backend/src/services/fetch-pool.js

/**
 * Create a concurrency limiter. `run(fn)` queues `fn` and resolves with its result,
 * guaranteeing no more than `concurrency` `fn`s are in flight at once (FIFO).
 * `minSpacingMs` (optional) enforces a minimum gap between successive task *starts*;
 * leave at 0 for pure concurrency limiting (spacing throttles total throughput).
 */
export function createPool({ concurrency = 4, minSpacingMs = 0 } = {}) {
  let active = 0;
  let lastStart = 0;
  const queue = [];

  function schedule() {
    if (active >= concurrency || queue.length === 0) return;
    const { fn, resolve, reject } = queue.shift();
    active++;
    (async () => {
      if (minSpacingMs > 0) {
        const wait = Math.max(0, lastStart + minSpacingMs - Date.now());
        lastStart = Date.now() + wait;
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      }
      try {
        resolve(await fn());
      } catch (err) {
        reject(err);
      } finally {
        active--;
        schedule();
      }
    })();
  }

  return function run(fn) {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      schedule();
    });
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --prefix backend -- fetch-pool`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/fetch-pool.js backend/tests/fetch-pool.test.js
git commit -m "feat: add concurrency pool for parallel fetching"
```

---

## Task 2: Parallelize within-order Tony fetch (`tony-client.js`)

Page is fetched first (keeps the 404/redirect short-circuit), then the 8 product categories + sklad run in parallel through an injected `run` limiter. Default `run` is identity so existing callers/tests are unaffected. The artificial inter-request `setTimeout` delays are removed (concurrency now controls load).

**Files:**
- Modify: `backend/src/services/tony-client.js:48-106`
- Test: `backend/tests/tony-client.test.js`

- [ ] **Step 1: Write the failing test** (append to existing `describe`)

```js
  it('requests all 8 product categories plus sklad in one order fetch', async () => {
    axios.get.mockResolvedValue({ status: 200, data: '<html>Заказ №169120</html>' });
    axios.post.mockResolvedValue({ status: 200, data: { success: true, html: ROW_HTML } });

    await fetchTonyOrderHtml('169120');

    // 8 PRODUCT_CATEGORIES + 1 sklad = 9 POSTs
    expect(axios.post).toHaveBeenCalledTimes(9);
    const actionVars = axios.post.mock.calls.map(
      (c) => new URLSearchParams(c[1]).get('actionVar')
    );
    expect(actionVars).toEqual(
      expect.arrayContaining(['food', 'products', 'tech', 'personnel', 'services', 'assembly', 'transport', 'expense'])
    );
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix backend -- tony-client`
Expected: FAIL — current sequential code still passes count, but if `tonyRequestDelayMs` mock changed, fails. If it already passes, proceed (the goal here is the parallel refactor below, verified by all tests staying green).

- [ ] **Step 3: Write the implementation** — replace lines 48–106 of `tony-client.js`

```js
async function fetchTonyAjaxList(src, bookingNumber, actionVar = '') {
  const { baseUrl } = getTonyConfig();
  const url = `${baseUrl.replace(/\/$/, '')}/ajax/${src}.php`;

  const resp = await axios.post(
    url,
    new URLSearchParams({ id: bookingNumber, actionVar }).toString(),
    {
      headers: { ...tonyRequestHeaders(), 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 30000,
      maxRedirects: 0,
      validateStatus: () => true,
    }
  );

  if (resp.status === 404) return '';
  const redirect = handleRedirectStatus(bookingNumber, resp.status, resp.headers?.location);
  if (redirect === null) return '';
  if (resp.status >= 400) {
    throw new Error(`Tony ${src} ${bookingNumber} returned HTTP ${resp.status}`);
  }

  const data = resp.data;
  if (data && typeof data === 'object' && typeof data.html === 'string') {
    return data.html;
  }
  return '';
}

function wrapCategoryTable(dataSrc, category, rowsHtml) {
  if (!rowsHtml?.trim()) return '';
  return `<table data-src="${dataSrc}" data-var="${category}"><tbody>${rowsHtml}</tbody></table>`;
}

async function fetchTonyProductTables(bookingNumber, run) {
  const productJobs = PRODUCT_CATEGORIES.map((category) =>
    run(() => fetchTonyAjaxList('order_products_list', bookingNumber, category)).then((rows) =>
      wrapCategoryTable('order_products_list', category, rows)
    )
  );
  const skladJob = run(() => fetchTonyAjaxList('order_sklad_list', bookingNumber, '')).then((rows) =>
    wrapCategoryTable('order_sklad_list', 'sklad', rows)
  );
  const chunks = await Promise.all([...productJobs, skladJob]);
  return chunks.filter(Boolean).join('');
}

/**
 * Fetch a Tony order page by booking number, including AJAX-loaded position tables.
 * Returns HTML string (page shell + category fragments), or null when the order does not exist.
 * `run` is a concurrency limiter from fetch-pool (defaults to running immediately).
 */
export async function fetchTonyOrderHtml(bookingNumber, { run = (fn) => fn() } = {}) {
  const pageHtml = await run(() => fetchTonyOrderPage(bookingNumber));
  if (!pageHtml) return null;

  const productTables = await fetchTonyProductTables(bookingNumber, run);
  return pageHtml + productTables;
}
```

- [ ] **Step 4: Remove the now-unused config import**

At the top of `tony-client.js`, delete `import { config } from '../config.js';` (the only use was the removed delay). Keep `getTonyConfig` and `tonyRequestHeaders` imports.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test --prefix backend -- tony-client`
Expected: PASS — all existing tests (page HTML + categories, 404 → null & no posts, notfound redirect, login redirect throws) plus the new 9-request test.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/tony-client.js backend/tests/tony-client.test.js
git commit -m "perf: fetch Tony order categories in parallel via injected limiter"
```

---

## Task 3: Config flags (`config.js`)

**Files:**
- Modify: `backend/src/config.js:18` (near `tonyRequestDelayMs`)

- [ ] **Step 1: Add the two config fields**

Insert after the `tonyRequestDelayMs` line inside the `config` object:

```js
  fetchConcurrency: parseInt(process.env.FETCH_CONCURRENCY || '4', 10),
  parsePipeline: process.env.PARSE_PIPELINE || 'parallel',
```

- [ ] **Step 2: Verify the app still boots / config parses**

Run: `node -e "import('./backend/src/config.js').then(m => console.log(m.config.fetchConcurrency, m.config.parsePipeline))"`
Expected: prints `4 parallel`.

- [ ] **Step 3: Commit**

```bash
git add backend/src/config.js
git commit -m "feat: add FETCH_CONCURRENCY and PARSE_PIPELINE config"
```

---

## Task 4: Refactor `runParsing` into `fetchEventData` + `applyEvent` (no behavior change)

This is a pure refactor: still sequential, still legacy behavior. It isolates "acquire per-event data" from "apply per-event data" so both pipelines can share the apply logic. Verified by all existing tests staying green and by the equivalence test added later.

**Files:**
- Modify: `backend/src/services/parser.js:118-336` (the `runParsing` body and the per-event loop)

- [ ] **Step 1: Add `fetchEventData` helper** (insert above `runParsing`, after `resolveTonyOrders`)

```js
/** Acquire all network-derived data for one event (legacy sequential path, with delays). */
async function fetchEventData(event, eventId, tonyReady) {
  const bookingNumbers = extractBookingNumbers(event.title || '');

  await delay(350);

  let descJson;
  try {
    descJson = await fetchDescription(eventId);
  } catch (err) {
    console.error(`Failed to fetch description for event ${eventId}:`, err.message);
    return null;
  }

  const descHtml = typeof descJson === 'string'
    ? JSON.parse(descJson).description
    : descJson.description;

  if (!descHtml) return null;

  const tonyOrders = await resolveTonyOrders(tonyReady, bookingNumbers);
  const calParsed = parseDealDescription(descHtml);

  return { bookingNumbers, descHtml, calParsed, tonyOrders };
}
```

- [ ] **Step 2: Add `applyEvent` helper** (insert below `fetchEventData`)

Move the existing per-event body (reconciliation + writes) verbatim into this function, reading inputs from `data` and `ctx` instead of local variables. Full function:

```js
/** Apply one event's prefetched data to the DB (reconciliation + writes + per-event cancels). */
async function applyEvent(db, event, eventId, data, ctx) {
  const { knownCodes, keywords, llmPrompt, counters, dealsToResync } = ctx;
  const { bookingNumbers, descHtml, calParsed, tonyOrders } = data;

  const titleInfo = parseDealTitle(event.title || '', knownCodes);
  const plan = planEventReconciliation(db, eventId, bookingNumbers);

  if (plan.relink) {
    db.prepare('UPDATE deals SET deal_key = ?, tony_order_id = ? WHERE id = ?')
      .run(plan.relink.newDealKey, plan.relink.bookingNumber, plan.relink.dealId);
  }

  const calContact = calParsed.contact;

  for (const target of plan.desired) {
    const existing = db.prepare('SELECT * FROM deals WHERE deal_key = ?').get(target.dealKey);
    const order = target.bookingNumber ? tonyOrders.get(target.bookingNumber) : undefined;

    if (order) {
      if (order.items.length === 0) {
        console.warn(`[tony] order ${target.bookingNumber} has no parsed items, skipping update`);
        counters.skippedDeals++;
        continue;
      }
      const hash = tonyContentHash(order);
      if (existing && existing.content_hash === hash) { counters.skippedDeals++; continue; }

      const fields = buildTonyDealFields(order);
      const classifiedItems = await classifyItems(buildTonyItems(order), keywords, llmPrompt);

      if (existing) {
        const wasCancelled = existing.twenty_stage === CANCELLED_OPPORTUNITY_STAGE;
        db.prepare(`
          UPDATE deals SET
            title = ?, company_code = ?, manager_name = ?,
            start_date = ?, end_date = ?, department = ?,
            contact_name = ?, contact_email = ?, contact_company = ?, contact_phone = ?,
            address = ?, work_time = ?, arrival_time = ?, dismantle_time = ?,
            load_date = ?, load_time = ?, budget = ?,
            content_hash = ?, data_source = 'tony', tony_order_id = ?, crm_lead_id = ?,
            twenty_stage = CASE WHEN ? THEN NULL ELSE twenty_stage END,
            updated_at = datetime('now')
          WHERE id = ?
        `).run(
          event.title, titleInfo.companyCode, titleInfo.managerName,
          fields.start_date, fields.end_date, event.department,
          calContact.name, calContact.email, calContact.company, calContact.phone,
          fields.address, fields.work_time, fields.arrival_time, fields.dismantle_time,
          fields.load_date, fields.load_time, fields.budget,
          hash, target.bookingNumber, event.leadid,
          wasCancelled ? 1 : 0, existing.id
        );
        const existingItems = db.prepare('SELECT * FROM deal_items WHERE deal_id = ?').all(existing.id);
        replaceDealItemsPreservingOverrides(db, existing.id, classifiedItems, buildOverrideMap(existingItems));
        if (existing.twenty_id) dealsToResync.push(existing.id);
        counters.updatedDeals++;
      } else {
        const insert = db.prepare(`
          INSERT INTO deals (
            crm_event_id, deal_key, data_source, crm_lead_id, title, company_code, manager_name,
            start_date, end_date, department, contact_name, contact_email, contact_company, contact_phone,
            address, work_time, arrival_time, dismantle_time, load_date, load_time, budget,
            tony_order_id, content_hash, raw_description
          ) VALUES (?, ?, 'tony', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          eventId, target.dealKey, event.leadid, event.title, titleInfo.companyCode, titleInfo.managerName,
          fields.start_date, fields.end_date, event.department, calContact.name, calContact.email, calContact.company, calContact.phone,
          fields.address, fields.work_time, fields.arrival_time, fields.dismantle_time, fields.load_date, fields.load_time, fields.budget,
          target.bookingNumber, hash, descHtml
        );
        const dealId = insert.lastInsertRowid;
        for (const item of classifiedItems) {
          db.prepare(`INSERT INTO deal_items (deal_id, name, price, quantity, discount, classification, classification_confidence) VALUES (?, ?, ?, ?, ?, ?, ?)`)
            .run(dealId, item.name, item.price, item.quantity, item.discount, item.classification, item.classification_confidence);
        }
        counters.newDeals++;
      }
    } else {
      if (existing && existing.data_source === 'tony') { counters.skippedDeals++; continue; }

      const calTonyOrderId = target.bookingNumber || titleInfo.tonyOrderId || null;
      const hash = contentHash(descHtml);
      if (existing && existing.content_hash === hash) { counters.skippedDeals++; continue; }

      const parsed = calParsed;
      const classifiedItems = await classifyItems(parsed.items, keywords, llmPrompt);

      if (existing) {
        const wasCancelled = existing.twenty_stage === CANCELLED_OPPORTUNITY_STAGE;
        db.prepare(`
          UPDATE deals SET
            title = ?, company_code = ?, manager_name = ?, start_date = ?, end_date = ?, department = ?,
            status = ?, legal_entity = ?, invoice_number = ?, budget = ?, discount = ?,
            contact_name = ?, contact_email = ?, contact_company = ?, contact_phone = ?,
            address = ?, venue_type = ?, arrival_time = ?, ready_time = ?, work_time = ?, dismantle_time = ?,
            content_hash = ?, raw_description = ?, crm_lead_id = ?, tony_order_id = ?, data_source = 'calendar',
            twenty_stage = CASE WHEN ? THEN NULL ELSE twenty_stage END, updated_at = datetime('now')
          WHERE id = ?
        `).run(
          event.title, titleInfo.companyCode, titleInfo.managerName, event.start, event.end, event.department,
          parsed.meta.status, parsed.meta.legalEntity, parsed.meta.invoiceNumber, parsed.meta.budget, parsed.meta.discount,
          parsed.contact.name, parsed.contact.email, parsed.contact.company, parsed.contact.phone,
          parsed.event.address, parsed.event.venueType, parsed.event.arrivalTime || null, parsed.event.readyTime || null,
          parsed.event.workTime || null, parsed.event.dismantleTime || null,
          hash, descHtml, event.leadid, calTonyOrderId, wasCancelled ? 1 : 0, existing.id
        );
        const existingItems = db.prepare('SELECT * FROM deal_items WHERE deal_id = ?').all(existing.id);
        replaceDealItemsPreservingOverrides(db, existing.id, classifiedItems, buildOverrideMap(existingItems));
        if (existing.twenty_id) dealsToResync.push(existing.id);
        counters.updatedDeals++;
      } else {
        const insert = db.prepare(`
          INSERT INTO deals (
            crm_event_id, deal_key, data_source, crm_lead_id, title, company_code, manager_name,
            start_date, end_date, department, status, legal_entity, invoice_number, budget, discount,
            contact_name, contact_email, contact_company, contact_phone, address, venue_type,
            arrival_time, ready_time, work_time, dismantle_time, tony_order_id, content_hash, raw_description
          ) VALUES (?, ?, 'calendar', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          eventId, target.dealKey, event.leadid, event.title, titleInfo.companyCode, titleInfo.managerName,
          event.start, event.end, event.department, parsed.meta.status, parsed.meta.legalEntity, parsed.meta.invoiceNumber,
          parsed.meta.budget, parsed.meta.discount, parsed.contact.name, parsed.contact.email, parsed.contact.company, parsed.contact.phone,
          parsed.event.address, parsed.event.venueType, parsed.event.arrivalTime || null, parsed.event.readyTime || null,
          parsed.event.workTime || null, parsed.event.dismantleTime || null, calTonyOrderId, hash, descHtml
        );
        const dealId = insert.lastInsertRowid;
        for (const item of classifiedItems) {
          db.prepare(`INSERT INTO deal_items (deal_id, name, price, quantity, discount, classification, classification_confidence) VALUES (?, ?, ?, ?, ?, ?, ?)`)
            .run(dealId, item.name, item.price, item.quantity, item.discount, item.classification, item.classification_confidence);
        }
        counters.newDeals++;
      }
    }
  }

  for (const removeId of plan.removeDealIds) {
    const row = db.prepare('SELECT twenty_id FROM deals WHERE id = ?').get(removeId);
    if (row && row.twenty_id) {
      try {
        const result = await cancelDealInTwenty(removeId);
        if (result && !result.skipped) counters.cancelledDeals++;
      } catch (err) {
        console.error(`[tony] cancel failed for deal ${removeId}: ${err.message}`);
      }
    }
  }
}
```

- [ ] **Step 3: Replace the per-event loop inside `runParsing`** (lines ~150–336)

Replace the counter declarations and the `for (const event of events) { ... }` block with:

```js
    const counters = { newDeals: 0, updatedDeals: 0, skippedDeals: 0, cancelledDeals: 0 };
    let outOfRange = 0;
    const dealsToResync = [];
    const ctx = { knownCodes, keywords, llmPrompt, counters, dealsToResync };

    for (const event of events) {
      if (!isEventInRange(event, startDate, endDate)) { outOfRange++; continue; }
      const eventId = String(event.original_id || event.id);
      if (!eventId) continue;

      const data = await fetchEventData(event, eventId, tonyReady);
      if (!data) continue;

      await applyEvent(db, event, eventId, data, ctx);
    }
```

- [ ] **Step 4: Update the post-loop references** to use `counters.*`

Replace the later uses of the old loose variables: `newDeals` → `counters.newDeals`, `updatedDeals` → `counters.updatedDeals`, `skippedDeals` → `counters.skippedDeals`, `cancelledDeals` → `counters.cancelledDeals`. These appear in the `UPDATE parse_runs ...` call and the missing-deal cancel loop and the final `return { ... }`. The `cancelledDeals++` in the missing-deals loop becomes `counters.cancelledDeals++`.

- [ ] **Step 5: Run the full backend test suite**

Run: `npm test --prefix backend`
Expected: PASS — same set of tests as before this task (no behavior change).

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/parser.js
git commit -m "refactor: split runParsing into fetchEventData and applyEvent"
```

---

## Task 5: Parallel prefetch pipeline + `PARSE_PIPELINE` branch (`parser.js`)

**Files:**
- Modify: `backend/src/services/parser.js` (imports, add `resolveTonyOrdersPooled` + `prefetchAll`, branch in `runParsing`)

- [ ] **Step 1: Add imports** at the top of `parser.js`

```js
import { createPool } from './fetch-pool.js';
```

- [ ] **Step 2: Add a pooled Tony resolver and `prefetchAll`** (insert below `fetchEventData`)

```js
/** Pooled, delay-free variant of resolveTonyOrders for the parallel pipeline. */
async function resolveTonyOrdersPooled(tonyReady, bookingNumbers, run) {
  const orders = new Map();
  if (!tonyReady) return orders;
  await Promise.all(
    bookingNumbers.map(async (n) => {
      try {
        const html = await fetchTonyOrderHtml(n, { run });
        if (html) orders.set(n, parseTonyOrder(html));
      } catch (err) {
        console.error(`[tony] failed to fetch order ${n}: ${err.message}`);
      }
    })
  );
  return orders;
}

/** Parallel prefetch of all in-range events' network data. Returns Map<eventId, data>. */
async function prefetchAll(events, tonyReady, startDate, endDate, run) {
  const map = new Map();
  await Promise.all(
    events.map(async (event) => {
      if (!isEventInRange(event, startDate, endDate)) return;
      const eventId = String(event.original_id || event.id);
      if (!eventId) return;

      const bookingNumbers = extractBookingNumbers(event.title || '');

      let descJson;
      try {
        descJson = await run(() => fetchDescription(eventId));
      } catch (err) {
        console.error(`Failed to fetch description for event ${eventId}:`, err.message);
        return;
      }
      const descHtml = typeof descJson === 'string'
        ? JSON.parse(descJson).description
        : descJson.description;
      if (!descHtml) return;

      const tonyOrders = await resolveTonyOrdersPooled(tonyReady, bookingNumbers, run);
      const calParsed = parseDealDescription(descHtml);

      map.set(eventId, { bookingNumbers, descHtml, calParsed, tonyOrders });
    })
  );
  return map;
}
```

- [ ] **Step 3: Branch the per-event loop in `runParsing`** on `config.parsePipeline`

Replace the loop added in Task 4 Step 3 with:

```js
    const counters = { newDeals: 0, updatedDeals: 0, skippedDeals: 0, cancelledDeals: 0 };
    let outOfRange = 0;
    const dealsToResync = [];
    const ctx = { knownCodes, keywords, llmPrompt, counters, dealsToResync };

    let prefetched = null;
    if (config.parsePipeline === 'parallel') {
      const run = createPool({ concurrency: config.fetchConcurrency });
      console.log(`[parse] prefetch start {"pipeline":"parallel","concurrency":${config.fetchConcurrency}}`);
      const t0 = Date.now();
      prefetched = await prefetchAll(events, tonyReady, startDate, endDate, run);
      console.log(`[parse] prefetch done {"events":${prefetched.size},"ms":${Date.now() - t0}}`);
    }

    for (const event of events) {
      if (!isEventInRange(event, startDate, endDate)) { outOfRange++; continue; }
      const eventId = String(event.original_id || event.id);
      if (!eventId) continue;

      const data = prefetched
        ? prefetched.get(eventId)
        : await fetchEventData(event, eventId, tonyReady);
      if (!data) continue;

      await applyEvent(db, event, eventId, data, ctx);
    }
```

- [ ] **Step 4: Run the full backend test suite (default = parallel)**

Run: `npm test --prefix backend`
Expected: PASS. (Existing parser-dependent tests run under the default `parallel` pipeline; if any test asserts legacy sequential delay behavior, set `PARSE_PIPELINE=legacy` for that test or update it.)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/parser.js
git commit -m "perf: add parallel prefetch pipeline behind PARSE_PIPELINE flag"
```

---

## Task 6: Equivalence test — prefetch matches legacy fetch

Proves the risky parallel part produces identical per-event data. (The apply phase is the same `applyEvent` function in both modes, so equivalence reduces to fetch equivalence.)

**Files:**
- Create: `backend/tests/parser-prefetch.test.js`
- Modify: `backend/src/services/parser.js` — export `fetchEventData` and `prefetchAll` for testing.

- [ ] **Step 1: Export the helpers** — change their declarations in `parser.js` to `export async function fetchEventData(...)` and `export async function prefetchAll(...)`.

- [ ] **Step 2: Write the test**

```js
// backend/tests/parser-prefetch.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

vi.mock('axios');
vi.mock('../src/services/auth.js', () => ({
  getCalToken: () => 'tok',
  getCrmRequestHeaders: () => ({}),
}));
vi.mock('../src/services/tony-auth.js', () => ({
  getTonyConfig: () => ({ baseUrl: 'https://crm.apihide.com', login: 'u', password: 'p' }),
  tonyRequestHeaders: () => ({ Cookie: 'PHPSESSID=abc' }),
}));
vi.mock('../src/config.js', () => ({
  config: { crmBaseUrl: 'https://apihide.com/bitrix/calendar/', fetchConcurrency: 4, parsePipeline: 'parallel' },
}));

import { createPool } from '../src/services/fetch-pool.js';
import { fetchEventData, prefetchAll } from '../src/services/parser.js';

const DESC = JSON.stringify({ description: '<div>contact</div>' });
const PAGE = '<html><input name="date_install" value="01.01.2026"></html>';
const ROW = '<tr data-id="1" data-price="100" data-sum="200"><td><input class="custom_name_value" value="Баннер"></td><td><input class="orders_custom_edit" value="2"></td></tr>';

function wireAxios() {
  axios.post.mockImplementation((url) => {
    if (url.includes('cal_description.php')) return Promise.resolve({ status: 200, data: DESC });
    if (url.includes('order_products_list.php')) return Promise.resolve({ status: 200, data: { html: ROW } });
    if (url.includes('order_sklad_list.php')) return Promise.resolve({ status: 200, data: { html: '' } });
    return Promise.resolve({ status: 200, data: {} });
  });
  axios.get.mockResolvedValue({ status: 200, data: PAGE });
}

const events = [{ id: 100, title: 'ООО Ромашка 169120', start: '2026-01-01', end: '2026-01-02' }];
const start = new Date('2026-01-01T00:00:00+03:00');
const end = new Date('2026-01-03T00:00:00+03:00');

describe('prefetchAll vs fetchEventData equivalence', () => {
  beforeEach(() => { vi.clearAllMocks(); wireAxios(); });

  it('produces the same per-event data as the legacy sequential fetch', async () => {
    const legacy = await fetchEventData(events[0], '100', true);

    vi.clearAllMocks(); wireAxios();
    const run = createPool({ concurrency: 4 });
    const map = await prefetchAll(events, true, start, end, run);
    const parallel = map.get('100');

    expect(parallel.descHtml).toBe(legacy.descHtml);
    expect(parallel.bookingNumbers).toEqual(legacy.bookingNumbers);
    expect([...parallel.tonyOrders.keys()]).toEqual([...legacy.tonyOrders.keys()]);
    expect(parallel.tonyOrders.get('169120').items).toEqual(legacy.tonyOrders.get('169120').items);
    expect(parallel.calParsed.contact).toEqual(legacy.calParsed.contact);
  });
});
```

> NOTE: `fetchEventData` includes `await delay(350)`; the test still completes quickly (one event). If the mock for `delay` is desired, it is not necessary here.

- [ ] **Step 3: Run the test**

Run: `npm test --prefix backend -- parser-prefetch`
Expected: PASS. If `isEventInRange`/date parsing rejects the sample event, adjust the `start`/`end`/`event.start` values to a known in-range triple (check `backend/src/utils/crm-dates.js` `isEventInRange`).

- [ ] **Step 4: Commit**

```bash
git add backend/src/services/parser.js backend/tests/parser-prefetch.test.js
git commit -m "test: assert parallel prefetch matches legacy fetch output"
```

---

## Task 7: Retry/backoff on transient errors (`withRetry`)

Adds bounded retry with exponential backoff + jitter for 429/5xx/network errors, applied to the per-call fetches inside the pool. Login-redirect (expired session) keeps current behavior (per-order failure → calendar fallback/skip).

**Files:**
- Modify: `backend/src/services/fetch-pool.js` (add `withRetry`)
- Modify: `backend/tests/fetch-pool.test.js` (add tests)
- Modify: `backend/src/services/parser.js` (wrap `fetchDescription` + Tony fetch calls in `withRetry`)

- [ ] **Step 1: Write the failing test** (append to `fetch-pool.test.js`)

```js
import { withRetry } from '../src/services/fetch-pool.js';

describe('withRetry', () => {
  it('retries retryable failures then succeeds', async () => {
    let n = 0;
    const result = await withRetry(
      async () => { n++; if (n < 3) { const e = new Error('429'); e.retryable = true; throw e; } return 'ok'; },
      { retries: 3, baseDelayMs: 1, isRetryable: (e) => e.retryable }
    );
    expect(result).toBe('ok');
    expect(n).toBe(3);
  });

  it('does not retry non-retryable failures', async () => {
    let n = 0;
    await expect(
      withRetry(async () => { n++; throw new Error('login'); }, { retries: 3, baseDelayMs: 1, isRetryable: () => false })
    ).rejects.toThrow('login');
    expect(n).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix backend -- fetch-pool`
Expected: FAIL — `withRetry is not a function`.

- [ ] **Step 3: Implement `withRetry`** (append to `fetch-pool.js`)

```js
/** Retry `fn` on retryable errors with exponential backoff + jitter. */
export async function withRetry(fn, { retries = 3, baseDelayMs = 500, isRetryable = () => true } = {}) {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      if (attempt > retries || !isRetryable(err)) throw err;
      const backoff = baseDelayMs * 2 ** (attempt - 1);
      const jitter = Math.random() * baseDelayMs;
      await new Promise((r) => setTimeout(r, backoff + jitter));
    }
  }
}
```

- [ ] **Step 4: Mark HTTP 429/5xx errors retryable in `tony-client.js`**

In `fetchTonyOrderPage` and `fetchTonyAjaxList`, change the `throw new Error(... returned HTTP ${resp.status})` lines to attach a flag:

```js
    const err = new Error(`Tony order ${bookingNumber} returned HTTP ${resp.status}`);
    err.retryable = resp.status === 429 || resp.status >= 500;
    throw err;
```

(Apply the analogous change in `fetchTonyAjaxList` with its message.)

- [ ] **Step 5: Wrap pooled calls with retry in `parser.js` `prefetchAll`**

Wrap the description fetch:

```js
        descJson = await run(() => withRetry(() => fetchDescription(eventId), {
          isRetryable: (e) => e.retryable || e.code === 'ECONNRESET' || e.code === 'ETIMEDOUT',
        }));
```

And inside `fetchTonyOrderHtml`, the page/category calls already go through `run`; wrap their inner fns with `withRetry` by passing a retrying `run`. Simplest: in `resolveTonyOrdersPooled`, build a retrying limiter wrapper:

```js
import { createPool, withRetry } from './fetch-pool.js';
// ...
const retryRun = (fn) => run(() => withRetry(fn, {
  isRetryable: (e) => e.retryable || e.code === 'ECONNRESET' || e.code === 'ETIMEDOUT',
}));
const html = await fetchTonyOrderHtml(n, { run: retryRun });
```

- [ ] **Step 6: Run the full backend test suite**

Run: `npm test --prefix backend`
Expected: PASS (all tests, including new `withRetry` tests and unchanged equivalence/tony-client tests).

- [ ] **Step 7: Commit**

```bash
git add backend/src/services/fetch-pool.js backend/tests/fetch-pool.test.js backend/src/services/tony-client.js backend/src/services/parser.js
git commit -m "feat: retry transient fetch failures with backoff"
```

---

## Task 8: Manual verification on real data (local)

**Files:** none (operational).

- [ ] **Step 1: Baseline (legacy) timing**

Run a real parse with `PARSE_PIPELINE=legacy` over a known small range; note `parse_runs` duration and `new/updated/skipped` counts.

- [ ] **Step 2: Parallel timing + result match**

Run the same range with `PARSE_PIPELINE=parallel` and `FETCH_CONCURRENCY=4`. Confirm: (a) duration dramatically lower, (b) `new/updated/skipped` counts and resulting `deals`/`deal_items` match the legacy run, (c) no 429 / login-redirect errors in logs.

- [ ] **Step 3: Tune concurrency**

If clean, try `FETCH_CONCURRENCY=6` / `8` and watch logs for `429`/login-redirects/latency. Pick the highest stable value; record it in `.env`. If errors appear, drop back to `4`.

---

## Self-Review notes

- **Spec coverage:** two-phase pipeline (T4–T5), within-order parallel + page gate (T2), shared pool (T1/T5), config flags (T3), backoff (T7), equivalence test (T6), manual tuning (T8). Classification stays in apply per spec; LLM batching/reauth/change-detection are spec "Future work" and intentionally excluded.
- **Type/name consistency:** `createPool`/`run`, `withRetry`, `fetchEventData`/`prefetchAll`/`applyEvent`, `counters.{newDeals,updatedDeals,skippedDeals,cancelledDeals}`, `resolveTonyOrdersPooled` used consistently across tasks.
