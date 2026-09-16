# Tony Parse Skip Unchanged Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Weekday-fast Tony prefetch drops from ~13 minutes to minutes by skipping `orders_edit`+category tables when `order_get_info.timestamps.updated_at` matches SQLite, and by raising `FETCH_CONCURRENCY` from 2/4 to 8.

**Architecture:** Parallel prefetch still runs first. For each booking, `fetchTonyOrderInfo` (one small POST) decides skip vs full `fetchTonyOrderHtml`. Skip omits the booking from `tonyOrders`; existing apply already preserves Tony-sourced deals in that case. Full fetches attach `tonyUpdatedAt` onto the parsed order so apply always persists `deals.tony_updated_at`, including content_hash matches.

**Tech Stack:** Node.js ESM, Vitest, better-sqlite3, existing `fetch-pool.js` / axios Tony session.

**Spec:** `docs/superpowers/specs/2026-09-15-tony-parse-skip-unchanged-design.md`

## Global Constraints

- Do not change `content_hash`, free-entry comments, reconcile, calendar cancel/restore, or Twenty post-parse.
- HTML tables remain the source of truth for items; `offers_summary` is not a parser.
- Probe only in `PARSE_PIPELINE=parallel`. Legacy, `import-by-booking`, and `attach-tony-booking` always full-fetch.
- `cal_description.php` still runs for every in-range event.
- Compare `updated_at` with string `===` (no TZ rewrite).
- Probe failure does not escalate to `orders_edit` (same as today's HTML failure: omit from `tonyOrders`).
- Empty parsed `items` does not write `tony_updated_at`.
- `TONY_UNCHANGED_PROBE` default true; `FETCH_CONCURRENCY` default 8.
- Print sheet / Google quota is out of scope.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `backend/src/config.js`, `.env.example`, `docker-compose.yml` | conc 8, probe flag |
| `backend/src/db/schema.sql`, `backend/src/db/migrate.js` | `deals.tony_updated_at` |
| `backend/src/services/tony-unchanged.js` | stamp map + skip predicate |
| `backend/src/services/tony-client.js` | `fetchTonyOrderInfo` |
| `backend/src/services/parser.js` | probe in prefetch; persist stamp in apply |
| `ops/perf/crmparser-throttle.md` | mark conc=2 as obsolete for Tony |
| `backend/tests/tony-unchanged.test.js` | skip predicate + stamp map |
| `backend/tests/tony-client.test.js` | get_info HTTP cases |
| `backend/tests/parser-prefetch.test.js` | skip vs full fetch |
| `backend/tests/parser-tony-stamp.test.js` | apply persist / skip preserve |

---

### Task 1: Config defaults

**Files:**
- Modify: `backend/src/config.js`
- Modify: `.env.example`
- Modify: `docker-compose.yml`
- Test: `backend/tests/config-tony-parse.test.js`

**Interfaces:**
- Consumes: `process.env.FETCH_CONCURRENCY`, `process.env.TONY_UNCHANGED_PROBE`
- Produces: `config.fetchConcurrency` default `8`; `config.tonyUnchangedProbe` default `true` (false when env is `0`/`false`/`no`)

- [ ] **Step 1: Write the failing test**

Create `backend/tests/config-tony-parse.test.js`:

```js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('tony parse config defaults', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    delete process.env.FETCH_CONCURRENCY;
    delete process.env.TONY_UNCHANGED_PROBE;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it('defaults FETCH_CONCURRENCY to 8 and probe on', async () => {
    const { config } = await import('../src/config.js');
    expect(config.fetchConcurrency).toBe(8);
    expect(config.tonyUnchangedProbe).toBe(true);
  });

  it('treats TONY_UNCHANGED_PROBE=false as off', async () => {
    process.env.TONY_UNCHANGED_PROBE = 'false';
    const { config } = await import('../src/config.js');
    expect(config.tonyUnchangedProbe).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix backend -- config-tony-parse`

Expected: FAIL (`fetchConcurrency` is 4 or `tonyUnchangedProbe` undefined).

- [ ] **Step 3: Implement config**

In `backend/src/config.js` replace `fetchConcurrency` and add probe next to it:

```js
  fetchConcurrency: parseInt(process.env.FETCH_CONCURRENCY || '8', 10),
  tonyUnchangedProbe: !['0', 'false', 'no'].includes(
    String(process.env.TONY_UNCHANGED_PROBE ?? 'true').trim().toLowerCase()
  ),
  parsePipeline: process.env.PARSE_PIPELINE || 'parallel',
```

In `.env.example` set `FETCH_CONCURRENCY=8` and add:

```
# Skip orders_edit + category tables when Tony timestamps.updated_at matches SQLite
TONY_UNCHANGED_PROBE=true
```

In `docker-compose.yml` set `FETCH_CONCURRENCY=${FETCH_CONCURRENCY:-8}` and add:

```
      - TONY_UNCHANGED_PROBE=${TONY_UNCHANGED_PROBE:-true}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --prefix backend -- config-tony-parse`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/config.js backend/tests/config-tony-parse.test.js .env.example docker-compose.yml
git commit -m "feat: default FETCH_CONCURRENCY=8 and Tony unchanged probe flag"
```

---

### Task 2: `deals.tony_updated_at` column

**Files:**
- Modify: `backend/src/db/schema.sql`
- Modify: `backend/src/db/migrate.js`
- Test: `backend/tests/migrate-tony-updated-at.test.js`

**Interfaces:**
- Consumes: `ensureColumn(db, table, column, definition)`
- Produces: column `deals.tony_updated_at TEXT` on fresh schema and existing DBs

- [ ] **Step 1: Write the failing test**

Create `backend/tests/migrate-tony-updated-at.test.js`:

```js
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../src/db/migrate.js';

describe('tony_updated_at migration', () => {
  it('adds tony_updated_at on migrate', () => {
    const db = new Database(':memory:');
    migrate(db);
    const cols = db.prepare('PRAGMA table_info(deals)').all().map((c) => c.name);
    expect(cols).toContain('tony_updated_at');
    db.close();
  });
});
```

If `migrate` needs `getDb` default, pass the in-memory db as the argument (it already accepts `db = getDb()`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix backend -- migrate-tony-updated-at`

Expected: FAIL (`tony_updated_at` missing).

- [ ] **Step 3: Add column**

In `backend/src/db/schema.sql` after `tony_order_id TEXT,` add:

```sql
  tony_updated_at TEXT,
```

In `backend/src/db/migrate.js` next to the other `ensureColumn(db, 'deals', ...)` calls add:

```js
  ensureColumn(db, 'deals', 'tony_updated_at', 'TEXT');
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test --prefix backend -- migrate-tony-updated-at`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/db/schema.sql backend/src/db/migrate.js backend/tests/migrate-tony-updated-at.test.js
git commit -m "feat: store Tony order updated_at on deals"
```

---

### Task 3: Probe client + skip predicate

**Files:**
- Create: `backend/src/services/tony-unchanged.js`
- Modify: `backend/src/services/tony-client.js`
- Test: `backend/tests/tony-unchanged.test.js`
- Test: `backend/tests/tony-client.test.js`

**Interfaces:**
- Consumes: `getTonyConfig`, `tonyRequestHeaders`, `handleRedirectStatus` (keep private in tony-client; info fetch lives in tony-client)
- Produces:
  - `fetchTonyOrderInfo(bookingNumber, { run } = {})` → `{ ok: true, updatedAt: string|null, deleted: boolean, notFound: boolean } | { ok: false, notFound: boolean, deleted: boolean }`
  - `shouldSkipTonyFullFetch({ probeEnabled, probe, existingStamp, dataSource })` → `boolean`
  - `loadTonyUpdatedAtMap(db)` → `Map<string, { stamp: string, dataSource: string }>`

- [ ] **Step 1: Write failing skip-predicate tests**

Create `backend/tests/tony-unchanged.test.js`:

```js
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { shouldSkipTonyFullFetch, loadTonyUpdatedAtMap } from '../src/services/tony-unchanged.js';

const base = {
  probeEnabled: true,
  probe: { ok: true, updatedAt: '2026-09-15 12:39:09', deleted: false, notFound: false },
  existingStamp: '2026-09-15 12:39:09',
  dataSource: 'tony',
};

describe('shouldSkipTonyFullFetch', () => {
  it('skips when stamp matches a tony deal', () => {
    expect(shouldSkipTonyFullFetch(base)).toBe(true);
  });

  it('does not skip a new booking (no stamp)', () => {
    expect(shouldSkipTonyFullFetch({ ...base, existingStamp: null })).toBe(false);
  });

  it('does not skip calendar-sourced deals', () => {
    expect(shouldSkipTonyFullFetch({ ...base, dataSource: 'calendar' })).toBe(false);
  });

  it('does not skip when flag is off', () => {
    expect(shouldSkipTonyFullFetch({ ...base, probeEnabled: false })).toBe(false);
  });

  it('does not skip notfound/deleted/failed probes', () => {
    expect(shouldSkipTonyFullFetch({ ...base, probe: { ...base.probe, notFound: true } })).toBe(false);
    expect(shouldSkipTonyFullFetch({ ...base, probe: { ...base.probe, deleted: true } })).toBe(false);
    expect(shouldSkipTonyFullFetch({ ...base, probe: { ok: false, notFound: false, deleted: false } })).toBe(false);
  });
});

describe('loadTonyUpdatedAtMap', () => {
  it('maps tony_order_id to stamp for tony deals', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE deals (
        id INTEGER PRIMARY KEY,
        data_source TEXT,
        tony_order_id TEXT,
        tony_updated_at TEXT
      );
    `);
    db.prepare("INSERT INTO deals (data_source, tony_order_id, tony_updated_at) VALUES ('tony', '158490', '2026-09-15 12:39:09')").run();
    db.prepare("INSERT INTO deals (data_source, tony_order_id, tony_updated_at) VALUES ('calendar', '111', '2026-01-01 00:00:00')").run();
    const map = loadTonyUpdatedAtMap(db);
    expect(map.get('158490')).toEqual({ stamp: '2026-09-15 12:39:09', dataSource: 'tony' });
    expect(map.has('111')).toBe(false);
    db.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix backend -- tony-unchanged`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `tony-unchanged.js`**

Create `backend/src/services/tony-unchanged.js`:

```js
export function shouldSkipTonyFullFetch({ probeEnabled, probe, existingStamp, dataSource }) {
  if (!probeEnabled) return false;
  if (!probe?.ok || probe.notFound || probe.deleted) return false;
  if (dataSource !== 'tony') return false;
  if (!existingStamp || !probe.updatedAt) return false;
  return existingStamp === probe.updatedAt;
}

export function loadTonyUpdatedAtMap(db) {
  const rows = db.prepare(`
    SELECT tony_order_id, tony_updated_at, data_source
    FROM deals
    WHERE data_source = 'tony'
      AND tony_order_id IS NOT NULL
      AND tony_order_id != ''
      AND tony_updated_at IS NOT NULL
      AND tony_updated_at != ''
  `).all();
  const map = new Map();
  for (const row of rows) {
    map.set(String(row.tony_order_id), {
      stamp: String(row.tony_updated_at),
      dataSource: row.data_source,
    });
  }
  return map;
}
```

- [ ] **Step 4: Run skip tests**

Run: `npm test --prefix backend -- tony-unchanged`

Expected: PASS

- [ ] **Step 5: Write failing `fetchTonyOrderInfo` tests**

Add to `backend/tests/tony-client.test.js` (keep existing HTML tests). Import `fetchTonyOrderInfo` from `../src/services/tony-client.js`.

```js
describe('fetchTonyOrderInfo', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns updatedAt from order_get_info JSON', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: { success: true, data: { timestamps: { updated_at: '2026-09-15 12:39:09' }, deleted: false } },
    });
    const probe = await fetchTonyOrderInfo('158490');
    expect(probe).toEqual({
      ok: true,
      updatedAt: '2026-09-15 12:39:09',
      deleted: false,
      notFound: false,
    });
    expect(axios.post).toHaveBeenCalledWith(
      'https://crm.apihide.com/ajax/order_get_info.php',
      'order_id=158490',
      expect.any(Object)
    );
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('returns notFound on HTTP 404', async () => {
    axios.post.mockResolvedValue({ status: 404, data: 'Not Found' });
    await expect(fetchTonyOrderInfo('999')).resolves.toMatchObject({ ok: false, notFound: true });
  });

  it('returns deleted when data.deleted is true', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: { success: true, data: { deleted: true, timestamps: { updated_at: '2026-01-01 00:00:00' } } },
    });
    await expect(fetchTonyOrderInfo('158490')).resolves.toMatchObject({
      ok: true,
      deleted: true,
      notFound: false,
    });
  });

  it('throws on login redirect', async () => {
    axios.post.mockResolvedValue({ status: 302, headers: { location: '/auth/' }, data: '' });
    await expect(fetchTonyOrderInfo('158490')).rejects.toThrow(/session/i);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test --prefix backend -- tony-client`

Expected: FAIL — `fetchTonyOrderInfo` is not exported.

- [ ] **Step 7: Implement `fetchTonyOrderInfo`**

Add to `backend/src/services/tony-client.js` (reuse `handleRedirectStatus`; POST shape same as `fetchTonyAjaxList`):

```js
export async function fetchTonyOrderInfo(bookingNumber, { run = (fn) => fn() } = {}) {
  return run(async () => {
    const { baseUrl } = getTonyConfig();
    const url = `${baseUrl.replace(/\/$/, '')}/ajax/order_get_info.php`;
    const resp = await axios.post(
      url,
      new URLSearchParams({ order_id: bookingNumber }).toString(),
      {
        headers: { ...tonyRequestHeaders(), 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: 30000,
        maxRedirects: 0,
        validateStatus: () => true,
      }
    );

    if (resp.status === 404) return { ok: false, notFound: true, deleted: false };
    const redirect = handleRedirectStatus(bookingNumber, resp.status, resp.headers?.location);
    if (redirect === null) return { ok: false, notFound: true, deleted: false };
    if (resp.status >= 400) {
      const err = new Error(`Tony order_get_info ${bookingNumber} returned HTTP ${resp.status}`);
      err.retryable = resp.status === 429 || resp.status >= 500;
      throw err;
    }

    const payload = resp.data;
    if (!payload || typeof payload !== 'object' || payload.success !== true || !payload.data) {
      return { ok: false, notFound: false, deleted: false };
    }
    const updatedAt = payload.data.timestamps?.updated_at;
    return {
      ok: true,
      updatedAt: updatedAt == null ? null : String(updatedAt),
      deleted: payload.data.deleted === true,
      notFound: false,
    };
  });
}
```

- [ ] **Step 8: Run tony-client tests**

Run: `npm test --prefix backend -- tony-client`

Expected: PASS (HTML tests still green; info tests green).

- [ ] **Step 9: Commit**

```bash
git add backend/src/services/tony-unchanged.js backend/src/services/tony-client.js backend/tests/tony-unchanged.test.js backend/tests/tony-client.test.js
git commit -m "feat: add Tony order_get_info probe and skip predicate"
```

---

### Task 4: Prefetch skip + apply stamp persist

**Files:**
- Modify: `backend/src/services/parser.js`
- Test: `backend/tests/parser-prefetch.test.js`
- Test: `backend/tests/parser-tony-stamp.test.js`

**Interfaces:**
- Consumes: `fetchTonyOrderInfo`, `shouldSkipTonyFullFetch`, `loadTonyUpdatedAtMap`, `config.tonyUnchangedProbe`
- Produces: prefetch omits unchanged bookings from `tonyOrders`; parsed orders may have `tonyUpdatedAt`; apply writes `tony_updated_at`

- [ ] **Step 1: Write failing prefetch skip test**

In `backend/tests/parser-prefetch.test.js` add `tonyUnchangedProbe: true` only in a new describe; keep the existing mock with `tonyUnchangedProbe: false` so the equivalence test still full-fetches.

Extend `wireAxios` so `order_get_info.php` returns JSON (needed once probe is on):

```js
    if (url.includes('order_get_info.php')) {
      return Promise.resolve({
        status: 200,
        data: { success: true, data: { timestamps: { updated_at: '2026-09-15 12:39:09' }, deleted: false } },
      });
    }
```

Add:

```js
describe('prefetchAll Tony unchanged skip', () => {
  it('does not fetch orders_edit or category tables when stamp matches', async () => {
    const { prefetchAll } = await import('../src/services/parser.js');
    const stamps = new Map([
      ['169120', { stamp: '2026-09-15 12:39:09', dataSource: 'tony' }],
    ]);
    const stats = { tony_probe: 0, tony_skip: 0, tony_full: 0, tony_probe_fail: 0 };
    const run = createPool({ concurrency: 4 });
    wireAxios();
    const map = await prefetchAll(events, true, start, end, run, {
      stamps,
      probeEnabled: true,
      stats,
    });
    expect(map.get('100').tonyOrders.has('169120')).toBe(false);
    expect(stats.tony_skip).toBe(1);
    expect(stats.tony_full).toBe(0);
    expect(axios.get.mock.calls.some((c) => String(c[0]).includes('orders_edit'))).toBe(false);
    const listPosts = axios.post.mock.calls.filter((c) => String(c[0]).includes('order_products_list.php'));
    expect(listPosts).toHaveLength(0);
    const descPosts = axios.post.mock.calls.filter((c) => String(c[0]).includes('cal_description.php'));
    expect(descPosts.length).toBeGreaterThan(0);
  });
});
```

If the test file already imported `prefetchAll` at top level, do not dynamic-import; pass `probeEnabled: true` via the 6th argument (do not read the flag from the mocked config for skip — the 6th argument is the source of truth in tests). Production `runParsing` passes `config.tonyUnchangedProbe`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test --prefix backend -- parser-prefetch`

Expected: FAIL — `prefetchAll` arity / still fetches HTML.

- [ ] **Step 3: Implement probe in `resolveTonyOrdersPooled`**

In `backend/src/services/parser.js` import:

```js
import { fetchTonyOrderHtml, fetchTonyOrderInfo } from './tony-client.js';
import { shouldSkipTonyFullFetch } from './tony-unchanged.js';
```

Replace `resolveTonyOrdersPooled` with:

```js
async function resolveTonyOrdersPooled(tonyReady, bookingNumbers, run, {
  stamps = new Map(),
  probeEnabled = false,
  stats = null,
} = {}) {
  const orders = new Map();
  if (!tonyReady) return orders;
  const retryRun = (fn) => run(() => withRetry(fn, {
    isRetryable: (e) => e.retryable || e.code === 'ECONNRESET' || e.code === 'ETIMEDOUT',
  }));
  await Promise.all(
    bookingNumbers.map(async (n) => {
      let probe = null;
      if (probeEnabled) {
        try {
          probe = await fetchTonyOrderInfo(n, { run: retryRun });
          if (stats && probe.ok) stats.tony_probe++;
        } catch (err) {
          console.error(`[tony] probe failed for order ${n}: ${err.message}`);
          if (stats) stats.tony_probe_fail++;
          return;
        }
        if (!probe.ok || probe.notFound || probe.deleted) return;
        const known = stamps.get(String(n));
        if (shouldSkipTonyFullFetch({
          probeEnabled: true,
          probe,
          existingStamp: known?.stamp ?? null,
          dataSource: known?.dataSource ?? null,
        })) {
          if (stats) stats.tony_skip++;
          return;
        }
      }
      try {
        const html = await fetchTonyOrderHtml(n, { run: retryRun });
        if (html) {
          const parsed = parseTonyOrder(html);
          if (probe?.updatedAt) parsed.tonyUpdatedAt = probe.updatedAt;
          orders.set(n, parsed);
          if (stats) stats.tony_full++;
        }
      } catch (err) {
        console.error(`[tony] failed to fetch order ${n}: ${err.message}`);
      }
    })
  );
  return orders;
}
```

Update `prefetchAll` signature to take the 6th `options` argument and pass it through. Keep `fetchEventData` / legacy `resolveTonyOrders` without probe.

In `runParsing` parallel branch:

```js
import { loadTonyUpdatedAtMap } from './tony-unchanged.js';
```

```js
      const tonyStats = { tony_probe: 0, tony_skip: 0, tony_full: 0, tony_probe_fail: 0 };
      prefetched = await prefetchAll(inRangeEvents, tonyReady, startDate, endDate, run, {
        stamps: loadTonyUpdatedAtMap(db),
        probeEnabled: config.tonyUnchangedProbe,
        stats: tonyStats,
      });
      console.log(
        `[parse] prefetch done {"events":${prefetched.size},"ms":${Date.now() - t0},` +
        `"tony_probe":${tonyStats.tony_probe},"tony_skip":${tonyStats.tony_skip},` +
        `"tony_full":${tonyStats.tony_full},"tony_probe_fail":${tonyStats.tony_probe_fail},` +
        `"concurrency":${config.fetchConcurrency}}`
      );
```

Remove the old one-line `prefetch done` log so there is a single summary.

- [ ] **Step 4: Run prefetch tests**

Run: `npm test --prefix backend -- parser-prefetch`

Expected: PASS (equivalence with probeEnabled default false; skip test green).

- [ ] **Step 5: Write failing apply stamp tests**

Create `backend/tests/parser-tony-stamp.test.js`. Use an in-memory sqlite schema subset and call `applyEvent` with a mocked classifier if needed. Simplest path: spy is unnecessary if `classifyItems` is not reached on hash-match / skip.

Minimal deals table for apply (copy columns `applyEvent` reads/writes). If this is too heavy, test a tiny helper `persistTonyUpdatedAt(db, dealId, stamp)` extracted in `parser.js` (or `tony-unchanged.js`) and used from both hash-match and update/insert.

**Prefer extracting to `tony-unchanged.js`:**

```js
export function persistTonyUpdatedAt(db, dealId, stamp) {
  if (!dealId || stamp == null || stamp === '') return;
  db.prepare('UPDATE deals SET tony_updated_at = ? WHERE id = ?').run(String(stamp), dealId);
}
```

Test that instead of full `applyEvent` for hash-match. Still wire `applyEvent` hash-match branch to call it, and INSERT/UPDATE to include the column.

`backend/tests/parser-tony-stamp.test.js`:

```js
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { persistTonyUpdatedAt } from '../src/services/tony-unchanged.js';

describe('persistTonyUpdatedAt', () => {
  it('writes stamp onto the deal', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE deals (id INTEGER PRIMARY KEY, tony_updated_at TEXT);`);
    db.prepare('INSERT INTO deals (id) VALUES (1)').run();
    persistTonyUpdatedAt(db, 1, '2026-09-15 12:39:09');
    expect(db.prepare('SELECT tony_updated_at FROM deals WHERE id = 1').get().tony_updated_at)
      .toBe('2026-09-15 12:39:09');
    db.close();
  });
});
```

- [ ] **Step 6: Run helper test (fail then implement persist export)**

Run: `npm test --prefix backend -- parser-tony-stamp`

Expected: FAIL until `persistTonyUpdatedAt` exists; then PASS.

- [ ] **Step 7: Persist stamp from `applyEvent`**

Import `persistTonyUpdatedAt` in `parser.js`.

On Tony hash-match (`existing && existing.content_hash === hash`), **before** `continue`, call `persistTonyUpdatedAt(db, existing.id, order.tonyUpdatedAt)`.

On Tony UPDATE, add `tony_updated_at = ?` next to `content_hash` (value `order.tonyUpdatedAt ?? null`).

On Tony INSERT, add `tony_updated_at` to the column list and values (`order.tonyUpdatedAt ?? null`). Keep parameter count in sync.

Empty items branch: do not persist stamp (already `continue` before hash).

- [ ] **Step 8: Run related tests**

Run: `npm test --prefix backend -- parser-tony-stamp parser-prefetch tony-unchanged tony-client`

Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add backend/src/services/parser.js backend/src/services/tony-unchanged.js backend/tests/parser-prefetch.test.js backend/tests/parser-tony-stamp.test.js
git commit -m "feat: skip unchanged Tony HTML fetches using order_get_info stamp"
```

---

### Task 5: Throttle doc + prod env note

**Files:**
- Modify: `ops/perf/crmparser-throttle.md`

**Interfaces:** none (docs)

- [ ] **Step 1: Mark FETCH_CONCURRENCY=2 as obsolete for Tony**

At the top of `ops/perf/crmparser-throttle.md` (after the Twenty API-key supersede section) add:

```markdown
## Superseded for Tony fetch (2026-09-15)

Do **not** keep prod `FETCH_CONCURRENCY=2`. That value was an anti-Twenty throttle. Tony prefetch is now the bottleneck (`order_get_info` probe + HTML only on stamp change). Prod should match repo: `FETCH_CONCURRENCY=8`, `TONY_UNCHANGED_PROBE=true`.
```

Leave the historical 2026-07-31 table intact.

- [ ] **Step 2: Commit**

```bash
git add ops/perf/crmparser-throttle.md
git commit -m "docs: stop recommending FETCH_CONCURRENCY=2 for Tony prefetch"
```

---

### Task 6: Full test run + prod checklist

- [ ] **Step 1: Run backend tests**

Run: `npm test --prefix backend`

Expected: all PASS

- [ ] **Step 2: Prod env (manual, after merge)**

Dokploy compose `crmparser` (`JWIhULvt6slzDxT8AQXyWz`):

```
FETCH_CONCURRENCY=8
TONY_UNCHANGED_PROBE=true
```

Redeploy. On the **second** weekday-fast after deploy, grep:

```
[parse] prefetch done
```

Success: `ms` well below 776591; `tony_skip` > 0. If `tony_probe` ≈ events and `tony_skip=0`, set `TONY_UNCHANGED_PROBE=false` and leave conc=8.

Rollback:

```
TONY_UNCHANGED_PROBE=false
FETCH_CONCURRENCY=4
```

- [ ] **Step 3: Commit spec status if not already**

In `docs/superpowers/specs/2026-09-15-tony-parse-skip-unchanged-design.md` set status to implemented after the code tasks land (not before).

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| FETCH_CONCURRENCY default/prod 8 | 1, 6 |
| TONY_UNCHANGED_PROBE flag | 1 |
| `tony_updated_at` column | 2 |
| `fetchTonyOrderInfo` + HTTP cases | 3 |
| Skip predicate + stamp map | 3 |
| Prefetch skip / full / calendar still fetched | 4 |
| Persist stamp on hash-match and write paths | 4 |
| Probe fail does not hit orders_edit | 4 (`return` after probe catch) |
| Prefetch log counters | 4 |
| import/attach/legacy untouched | (no file changes) |
| Throttle doc | 5 |
| Prod verify / rollback | 6 |
| Print sheet | out of scope |

No placeholders; signatures match across tasks (`probe.updatedAt`, `stamps.get(n).stamp`, `persistTonyUpdatedAt`).
