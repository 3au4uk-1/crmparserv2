# Bulk Resync Global Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manual button in Settings that runs a background job to resync all deals with `twenty_id`, re-applying blacklist, restoration, and podryad global filters in Twenty CRM.

**Architecture:** Mirror `expense-jobs.js`: SQLite job row, in-memory cache, async execution with progress polling. Reuse `syncDealToTwenty()` per deal with `skipPrintSheetRefresh: true`; run one `runPrintSheetCycle()` after the loop. Rate-limit 1 s between deals (same as `parser.js` post-parse resync).

**Tech Stack:** Node.js 20, Express 5, better-sqlite3, Vitest; React 18, TanStack Query, Tailwind CSS.

**Spec:** `docs/superpowers/specs/2026-07-03-bulk-resync-filters-design.md`

---

## File Structure

| File | Responsibility |
|------|----------------|
| `backend/src/db/schema.sql` | DDL for `bulk_resync_runs` |
| `backend/src/db/migrate.js` | `CREATE TABLE IF NOT EXISTS bulk_resync_runs` |
| `backend/src/services/twenty-sync.js` | `skipPrintSheetRefresh` option; export `runPrintSheetRefresh()` |
| `backend/src/services/bulk-resync-jobs.js` | Job CRUD, deal selection, execution loop |
| `backend/src/routes/deals.js` | Preview + start + poll endpoints |
| `backend/tests/twenty-sync.test.js` | Test skip print sheet flag |
| `backend/tests/bulk-resync-jobs.test.js` | Job service + route tests |
| `frontend/src/api.js` | React Query hooks |
| `frontend/src/pages/Settings.jsx` | Button, confirm, progress panel |

---

### Task 1: Database — `bulk_resync_runs` table

**Files:**
- Modify: `backend/src/db/schema.sql`
- Modify: `backend/src/db/migrate.js`

- [ ] **Step 1: Add table to schema**

Append before the `INSERT OR IGNORE INTO companies` block in `backend/src/db/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS bulk_resync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL DEFAULT 'queued',
  trigger TEXT NOT NULL DEFAULT 'manual',
  started_at TEXT,
  finished_at TEXT,
  deals_total INTEGER DEFAULT 0,
  deals_done INTEGER DEFAULT 0,
  deals_updated INTEGER DEFAULT 0,
  deals_failed INTEGER DEFAULT 0,
  errors_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- [ ] **Step 2: Add migration**

In `backend/src/db/migrate.js`, after the `expense_beznal_uploads` block, add:

```js
  db.exec(`
    CREATE TABLE IF NOT EXISTS bulk_resync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL DEFAULT 'queued',
      trigger TEXT NOT NULL DEFAULT 'manual',
      started_at TEXT,
      finished_at TEXT,
      deals_total INTEGER DEFAULT 0,
      deals_done INTEGER DEFAULT 0,
      deals_updated INTEGER DEFAULT 0,
      deals_failed INTEGER DEFAULT 0,
      errors_json TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
```

- [ ] **Step 3: Verify migration**

Run:

```bash
cd backend && npm test -- migrate 2>&1 | head -20
node -e "import('./src/db/connection.js').then(m => { m.initDb(); import('./src/db/migrate.js').then(x => x.migrate()); const db = m.getDb(); console.log(db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='bulk_resync_runs'`).get()); })"
```

Expected: `{ name: 'bulk_resync_runs' }`

- [ ] **Step 4: Commit**

```bash
git add backend/src/db/schema.sql backend/src/db/migrate.js
git commit -m "feat: add bulk_resync_runs table for filter resync jobs"
```

---

### Task 2: `syncDealToTwenty` — skip print sheet + exported refresh helper

**Files:**
- Modify: `backend/src/services/twenty-sync.js`
- Modify: `backend/tests/twenty-sync.test.js`

- [ ] **Step 1: Write failing test for skipPrintSheetRefresh**

Add to `backend/tests/twenty-sync.test.js` inside the `syncDealToTwenty` describe block:

```js
  it('skips print sheet refresh when skipPrintSheetRefresh is true', async () => {
    const dealId = dbMock.__seedDeal({
      id: 2,
      twenty_id: 'opp-skip-print',
      approval_status: 'synced',
      title: 'Deal skip print',
      start_date: '2026-06-10',
      crm_event_id: 'e2',
    });
    dbMock.__seedItem({
      deal_id: dealId,
      name: 'Баннер',
      price: 1000,
      classification: 'keyword_match',
      sync_override: null,
    });

    axiosPost
      .mockResolvedValueOnce(gqlOk({ updateOpportunity: { id: 'opp-skip-print' } }))
      .mockResolvedValueOnce(gqlOk({
        dealLineItems: { edges: [{ node: { id: 'li-1', name: 'Баннер', stage: 'NOVYY' } }] },
      }))
      .mockResolvedValueOnce(gqlOk({ updateDealLineItem: { id: 'li-1' } }));

    runPrintSheetCycleMock.mockResolvedValue({ exported: 0, readbackUpdated: 0, sessionsCleared: 0 });

    await syncDealToTwenty(dealId, { skipPrintSheetRefresh: true });

    expect(runPrintSheetCycleMock).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend && npm test -- twenty-sync.test.js -t "skips print sheet"
```

Expected: FAIL — `syncDealToTwenty` ignores unknown second argument

- [ ] **Step 3: Implement skip flag and export refresh helper**

In `backend/src/services/twenty-sync.js`:

1. Keep `refreshPrintSheetAfterSync(twenty, oppId)` as-is for single-deal sync, and add exported helper:

```js
export async function runPrintSheetRefresh() {
  const twenty = requireTwentyConfig();
  try {
    const gqlClient = createTwentyGqlClient(twenty.apiUrl, twenty.apiToken);
    const result = await runPrintSheetCycle(gqlClient);
    logTwentyStep('print_sheet.refresh.done', { bulk: true, ...result });
    return result;
  } catch (err) {
    logTwenty('warn', 'print_sheet.refresh.failed', { bulk: true, error: err.message });
    throw err;
  }
}
```

2. Update `syncDealToTwenty` signature:

```js
export async function syncDealToTwenty(dealId, { skipPrintSheetRefresh = false } = {}) {
```

3. Replace the print sheet call at end of try block:

```js
    if (!skipPrintSheetRefresh) {
      await refreshPrintSheetAfterSync(twenty, result.twentyId);
    }
    return result;
```

- [ ] **Step 4: Run tests**

Run:

```bash
cd backend && npm test -- twenty-sync.test.js
```

Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/twenty-sync.js backend/tests/twenty-sync.test.js
git commit -m "feat: allow syncDealToTwenty to skip per-deal print sheet refresh"
```

---

### Task 3: Bulk resync job service

**Files:**
- Create: `backend/src/services/bulk-resync-jobs.js`
- Create: `backend/tests/bulk-resync-jobs.test.js`

- [ ] **Step 1: Write failing tests**

Create `backend/tests/bulk-resync-jobs.test.js`:

```js
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let testDb;
const syncDealToTwentyMock = vi.fn();
const runPrintSheetRefreshMock = vi.fn();

vi.mock('../src/db/connection.js', () => ({
  getDb: () => testDb,
}));

vi.mock('../src/services/twenty-sync.js', () => ({
  syncDealToTwenty: (...args) => syncDealToTwentyMock(...args),
  runPrintSheetRefresh: (...args) => runPrintSheetRefreshMock(...args),
}));

import {
  countSyncedDeals,
  listSyncedDealIds,
  createBulkResyncJob,
  executeBulkResyncJob,
  getBulkResyncJob,
  resetBulkResyncJobsForTests,
} from '../src/services/bulk-resync-jobs.js';

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE bulk_resync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL DEFAULT 'queued',
      trigger TEXT NOT NULL DEFAULT 'manual',
      started_at TEXT,
      finished_at TEXT,
      deals_total INTEGER DEFAULT 0,
      deals_done INTEGER DEFAULT 0,
      deals_updated INTEGER DEFAULT 0,
      deals_failed INTEGER DEFAULT 0,
      errors_json TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE deals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      twenty_id TEXT,
      title TEXT
    );
  `);
  return db;
}

describe('bulk-resync-jobs', () => {
  beforeEach(() => {
    testDb = createDb();
    syncDealToTwentyMock.mockReset();
    runPrintSheetRefreshMock.mockReset();
    resetBulkResyncJobsForTests();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('countSyncedDeals counts only non-empty twenty_id', () => {
    testDb.prepare('INSERT INTO deals (twenty_id, title) VALUES (?, ?)').run('opp-1', 'A');
    testDb.prepare('INSERT INTO deals (twenty_id, title) VALUES (?, ?)').run('', 'B');
    testDb.prepare('INSERT INTO deals (twenty_id, title) VALUES (?, ?)').run(null, 'C');
    expect(countSyncedDeals()).toBe(1);
  });

  it('executeBulkResyncJob continues on failure and runs print sheet once', async () => {
    testDb.prepare('INSERT INTO deals (id, twenty_id, title) VALUES (1, ?, ?)').run('opp-1', 'Deal 1');
    testDb.prepare('INSERT INTO deals (id, twenty_id, title) VALUES (2, ?, ?)').run('opp-2', 'Deal 2');

    syncDealToTwentyMock
      .mockResolvedValueOnce({ action: 'updated', twentyId: 'opp-1' })
      .mockRejectedValueOnce(new Error('Twenty timeout'))
      .mockResolvedValueOnce({ action: 'updated_empty', twentyId: 'opp-2' });

    runPrintSheetRefreshMock.mockResolvedValue({ exported: 1 });

    const job = createBulkResyncJob({ trigger: 'manual' });
    const promise = executeBulkResyncJob(job.jobId);

    await vi.runAllTimersAsync();
    const finished = await promise;

    expect(syncDealToTwentyMock).toHaveBeenCalledTimes(2);
    expect(syncDealToTwentyMock).toHaveBeenNthCalledWith(1, 1, { skipPrintSheetRefresh: true });
    expect(syncDealToTwentyMock).toHaveBeenNthCalledWith(2, 2, { skipPrintSheetRefresh: true });
    expect(runPrintSheetRefreshMock).toHaveBeenCalledTimes(1);
    expect(finished.dealsTotal).toBe(2);
    expect(finished.dealsDone).toBe(2);
    expect(finished.dealsUpdated).toBe(2);
    expect(finished.dealsFailed).toBe(1);
    expect(finished.status).toBe('completed_with_errors');
    expect(finished.errors).toEqual([{ dealId: 2, error: 'Twenty timeout' }]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
cd backend && npm test -- bulk-resync-jobs.test.js
```

Expected: FAIL — module not found

- [ ] **Step 3: Implement service**

Create `backend/src/services/bulk-resync-jobs.js`:

```js
import { getDb } from '../db/connection.js';
import { syncDealToTwenty, runPrintSheetRefresh } from './twenty-sync.js';

const ACTIVE_STATUSES = new Set(['queued', 'running']);
const MAX_ERRORS = 50;
const DELAY_MS = 1000;

const jobs = new Map();

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseErrorsJson(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mapBulkResyncRunRow(row) {
  if (!row) return null;
  return {
    jobId: String(row.id),
    status: row.status,
    trigger: row.trigger,
    startedAt: row.started_at ?? null,
    finishedAt: row.finished_at ?? null,
    dealsTotal: row.deals_total ?? 0,
    dealsDone: row.deals_done ?? 0,
    dealsUpdated: row.deals_updated ?? 0,
    dealsFailed: row.deals_failed ?? 0,
    errors: parseErrorsJson(row.errors_json),
    error: row.error ?? null,
    createdAt: row.created_at ?? null,
  };
}

function storeJob(job) {
  jobs.set(job.jobId, job);
  return job;
}

function updateJob(jobId, patch) {
  const job = jobs.get(String(jobId));
  if (!job) return null;
  Object.assign(job, patch);
  return job;
}

function persistJobProgress(db, jobId, job) {
  db.prepare(
    `UPDATE bulk_resync_runs
     SET deals_total = ?,
         deals_done = ?,
         deals_updated = ?,
         deals_failed = ?,
         errors_json = ?
     WHERE id = ?`,
  ).run(
    job.dealsTotal,
    job.dealsDone,
    job.dealsUpdated,
    job.dealsFailed,
    JSON.stringify(job.errors),
    Number(jobId),
  );
}

export function resetBulkResyncJobsForTests() {
  jobs.clear();
}

export function countSyncedDeals() {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM deals
       WHERE twenty_id IS NOT NULL AND TRIM(twenty_id) != ''`,
    )
    .get();
  return row?.count ?? 0;
}

export function listSyncedDealIds() {
  const db = getDb();
  return db
    .prepare(
      `SELECT id
       FROM deals
       WHERE twenty_id IS NOT NULL AND TRIM(twenty_id) != ''
       ORDER BY id ASC`,
    )
    .all()
    .map((row) => row.id);
}

export function createBulkResyncJob({ trigger = 'manual' } = {}) {
  const db = getDb();
  const result = db
    .prepare('INSERT INTO bulk_resync_runs (status, trigger) VALUES (?, ?)')
    .run('queued', trigger);

  const row = db
    .prepare('SELECT * FROM bulk_resync_runs WHERE id = ?')
    .get(Number(result.lastInsertRowid));

  return storeJob(mapBulkResyncRunRow(row));
}

export function getBulkResyncJob(jobId) {
  const normalizedJobId = String(jobId);
  if (jobs.has(normalizedJobId)) {
    return jobs.get(normalizedJobId);
  }

  const db = getDb();
  const row = db
    .prepare('SELECT * FROM bulk_resync_runs WHERE id = ?')
    .get(Number(normalizedJobId));
  if (!row) return null;

  return storeJob(mapBulkResyncRunRow(row));
}

export function getActiveBulkResyncJob() {
  for (const job of jobs.values()) {
    if (ACTIVE_STATUSES.has(job.status)) {
      return job;
    }
  }

  const db = getDb();
  const row = db
    .prepare(
      `SELECT *
       FROM bulk_resync_runs
       WHERE status IN ('queued', 'running')
       ORDER BY id DESC
       LIMIT 1`,
    )
    .get();

  if (!row) return null;
  return storeJob(mapBulkResyncRunRow(row));
}

export async function executeBulkResyncJob(jobId) {
  const job = getBulkResyncJob(jobId);
  if (!job) return null;

  const db = getDb();
  const startedAt = new Date().toISOString();
  const dealIds = listSyncedDealIds();

  updateJob(job.jobId, {
    status: 'running',
    startedAt,
    finishedAt: null,
    error: null,
    dealsTotal: dealIds.length,
    dealsDone: 0,
    dealsUpdated: 0,
    dealsFailed: 0,
    errors: [],
  });

  db.prepare(
    `UPDATE bulk_resync_runs
     SET status = ?, started_at = ?, finished_at = NULL, error = NULL, deals_total = ?
     WHERE id = ?`,
  ).run('running', startedAt, dealIds.length, Number(job.jobId));

  let anyUpdated = false;

  try {
    for (let i = 0; i < dealIds.length; i++) {
      if (i > 0) await delay(DELAY_MS);
      const dealId = dealIds[i];

      try {
        const result = await syncDealToTwenty(dealId, { skipPrintSheetRefresh: true });
        if (result?.action === 'updated' || result?.action === 'updated_empty') {
          job.dealsUpdated += 1;
          anyUpdated = true;
        }
      } catch (err) {
        job.dealsFailed += 1;
        if (job.errors.length < MAX_ERRORS) {
          job.errors.push({
            dealId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        console.error(`[bulk-resync] deal ${dealId} failed:`, err.message);
      }

      job.dealsDone += 1;
      persistJobProgress(db, job.jobId, job);
    }

    if (anyUpdated) {
      try {
        await runPrintSheetRefresh();
      } catch (err) {
        console.warn('[bulk-resync] print sheet refresh failed:', err.message);
      }
    }

    const finishedAt = new Date().toISOString();
    const status = job.dealsFailed > 0 ? 'completed_with_errors' : 'completed';

    updateJob(job.jobId, { status, finishedAt });
    db.prepare(
      `UPDATE bulk_resync_runs
       SET status = ?, finished_at = ?, deals_done = ?, deals_updated = ?, deals_failed = ?, errors_json = ?
       WHERE id = ?`,
    ).run(
      status,
      finishedAt,
      job.dealsDone,
      job.dealsUpdated,
      job.dealsFailed,
      JSON.stringify(job.errors),
      Number(job.jobId),
    );
  } catch (err) {
    const finishedAt = new Date().toISOString();
    const error = err instanceof Error ? err.message : String(err);

    updateJob(job.jobId, { status: 'failed', finishedAt, error });
    db.prepare(
      `UPDATE bulk_resync_runs
       SET status = ?, finished_at = ?, error = ?
       WHERE id = ?`,
    ).run('failed', finishedAt, error, Number(job.jobId));
  }

  return getBulkResyncJob(job.jobId);
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
cd backend && npm test -- bulk-resync-jobs.test.js
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/bulk-resync-jobs.js backend/tests/bulk-resync-jobs.test.js
git commit -m "feat: add bulk resync job service for synced deals"
```

---

### Task 4: API routes

**Files:**
- Modify: `backend/src/routes/deals.js`
- Modify: `backend/tests/bulk-resync-jobs.test.js` (append route tests)

- [ ] **Step 1: Write failing route test**

Append to `backend/tests/bulk-resync-jobs.test.js`:

```js
import express from 'express';

const executeBulkResyncJobMock = vi.fn();

vi.mock('../src/services/bulk-resync-jobs.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    executeBulkResyncJob: (...args) => executeBulkResyncJobMock(...args),
  };
});

import dealsRouter from '../src/routes/deals.js';
import { createBulkResyncJob, getActiveBulkResyncJob, resetBulkResyncJobsForTests } from '../src/services/bulk-resync-jobs.js';

async function requestJson(app, method, path, body) {
  const server = app.listen(0);
  const { port } = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe('bulk-resync routes', () => {
  beforeEach(() => {
    testDb = createDb();
    resetBulkResyncJobsForTests();
    executeBulkResyncJobMock.mockReset();
    executeBulkResyncJobMock.mockResolvedValue({ jobId: '1', status: 'completed' });
  });

  it('POST /bulk-resync returns 409 when job already active', async () => {
    createBulkResyncJob({ trigger: 'manual' });
    const app = express();
    app.use(express.json());
    app.use('/deals', dealsRouter);

    const result = await requestJson(app, 'POST', '/deals/bulk-resync');
    expect(result.status).toBe(409);
  });

  it('GET /bulk-resync/preview returns count', async () => {
    testDb.prepare('INSERT INTO deals (twenty_id, title) VALUES (?, ?)').run('opp-1', 'A');
    const app = express();
    app.use(express.json());
    app.use('/deals', dealsRouter);

    const result = await requestJson(app, 'GET', '/deals/bulk-resync/preview');
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ count: 1 });
  });
});
```

**Note:** Move the `vi.mock` for bulk-resync-jobs with `importOriginal` to the top of the file and merge with the existing mock — only one mock factory per module. Refactor tests into two describe blocks sharing `createDb()`.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
cd backend && npm test -- bulk-resync-jobs.test.js -t "bulk-resync routes"
```

Expected: FAIL — 404

- [ ] **Step 3: Add routes to deals.js**

Add import at top of `backend/src/routes/deals.js`:

```js
import {
  countSyncedDeals,
  createBulkResyncJob,
  executeBulkResyncJob,
  getActiveBulkResyncJob,
  getBulkResyncJob,
} from '../services/bulk-resync-jobs.js';
```

Insert **after** `router.get('/stats', ...)` and **before** `router.post('/import-by-booking', ...)`:

```js
router.get('/bulk-resync/preview', (req, res) => {
  res.json({ count: countSyncedDeals() });
});

router.post('/bulk-resync', (req, res) => {
  if (getActiveBulkResyncJob()) {
    return res.status(409).json({ error: 'Массовая пересинхронизация уже выполняется' });
  }

  const requestedTrigger = req.body?.trigger;
  const trigger =
    typeof requestedTrigger === 'string' && requestedTrigger.trim()
      ? requestedTrigger.trim()
      : 'manual';

  const job = createBulkResyncJob({ trigger });
  executeBulkResyncJob(job.jobId).catch((err) => {
    console.error(`[bulk-resync] job ${job.jobId} failed:`, err.message);
  });

  res.status(201).json({ jobId: job.jobId });
});

router.get('/bulk-resync/jobs/active', (req, res) => {
  res.json(getActiveBulkResyncJob() ?? null);
});

router.get('/bulk-resync/jobs/:id', (req, res) => {
  const job = getBulkResyncJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Задача не найдена' });
  res.json(job);
});
```

- [ ] **Step 4: Run tests**

Run:

```bash
cd backend && npm test -- bulk-resync-jobs.test.js
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/deals.js backend/tests/bulk-resync-jobs.test.js
git commit -m "feat: add bulk resync API routes"
```

---

### Task 5: Frontend API hooks

**Files:**
- Modify: `frontend/src/api.js`

- [ ] **Step 1: Add hooks**

Append after the expense job hooks in `frontend/src/api.js`:

```js
function isBulkResyncJobRunning(status) {
  return status === 'queued' || status === 'running';
}

export function useBulkResyncPreview() {
  return useQuery({
    queryKey: ['bulk-resync-preview'],
    queryFn: () => api.get('/deals/bulk-resync/preview').then((r) => r.data),
    enabled: false,
  });
}

export function useStartBulkResync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/deals/bulk-resync').then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bulk-resync-active-job'] });
    },
  });
}

export function useActiveBulkResyncJob() {
  return useQuery({
    queryKey: ['bulk-resync-active-job'],
    queryFn: () => api.get('/deals/bulk-resync/jobs/active').then((r) => r.data),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return isBulkResyncJobRunning(status) ? 2000 : false;
    },
  });
}

export function useBulkResyncJob(jobId, { enabled = true } = {}) {
  return useQuery({
    queryKey: ['bulk-resync-job', jobId],
    queryFn: () => api.get(`/deals/bulk-resync/jobs/${jobId}`).then((r) => r.data),
    enabled: enabled && !!jobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return isBulkResyncJobRunning(status) ? 2000 : false;
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/api.js
git commit -m "feat: add React Query hooks for bulk resync job"
```

---

### Task 6: Settings UI

**Files:**
- Modify: `frontend/src/pages/Settings.jsx`

- [ ] **Step 1: Add imports and sub-component**

At top of `frontend/src/pages/Settings.jsx`, extend imports:

```js
import {
  // ...existing imports...
  useStartBulkResync,
  useActiveBulkResyncJob,
  useBulkResyncJob,
  api,
} from '../api';
```

Add helper + component before `export default function Settings()`:

```js
function isBulkResyncRunning(status) {
  return status === 'queued' || status === 'running';
}

function BulkResyncPanel() {
  const [jobId, setJobId] = useState('');
  const [startError, setStartError] = useState('');

  const startBulkResync = useStartBulkResync();
  const { data: activeJob } = useActiveBulkResyncJob();
  const { data: job, error: jobError } = useBulkResyncJob(jobId, { enabled: !!jobId });

  useEffect(() => {
    if (!activeJob?.jobId || jobId) return;
    setJobId(activeJob.jobId);
  }, [activeJob, jobId]);

  const status = job?.status || activeJob?.status;
  const running = startBulkResync.isPending || isBulkResyncRunning(status);
  const details = job || activeJob || {};

  async function onStartBulkResync() {
    setStartError('');
    try {
      const preview = await api.get('/deals/bulk-resync/preview').then((r) => r.data);
      const count = preview?.count ?? 0;
      if (count === 0) {
        setStartError('Нет синхронизированных сделок для пересинхронизации');
        return;
      }
      const confirmed = window.confirm(
        `Будет пересинхронизировано ${count} сделок. Актуальные фильтры (блеклист, реставрация, подряд) будут применены в Twenty. Продолжить?`,
      );
      if (!confirmed) return;

      startBulkResync.mutate(undefined, {
        onSuccess: (data) => {
          if (data?.jobId) setJobId(String(data.jobId));
        },
        onError: (err) => {
          if (err.response?.status === 409) {
            setStartError('Массовая пересинхронизация уже выполняется');
            return;
          }
          setStartError(err.response?.data?.error || err.message || 'Не удалось запустить пересинхронизацию');
        },
      });
    } catch (err) {
      setStartError(err.response?.data?.error || err.message || 'Не удалось получить количество сделок');
    }
  }

  return (
    <div className="mt-6 pt-6 border-t border-surface-border">
      <h4 className="text-sm font-semibold text-ink mb-1">Применить фильтры к синхронизированным сделкам</h4>
      <p className="text-xs text-ink-muted mb-3 max-w-xl leading-relaxed">
        Пересинхронизирует все сделки с Twenty, применяя текущие списки блеклиста, реставрации и подряда.
        Позиции в Twenty со стадией дальше «Новый» не изменяются.
      </p>
      <button type="button" onClick={onStartBulkResync} disabled={running} className="btn-secondary">
        {running ? 'Пересинхронизация выполняется…' : 'Применить фильтры ко всем синхронизированным сделкам'}
      </button>

      {(jobId || activeJob?.jobId) && (
        <div className="mt-4 space-y-1 text-sm text-ink-muted">
          <p>
            Статус: <span className="font-medium text-ink">{status || 'unknown'}</span>
          </p>
          <p>
            Прогресс:{' '}
            <span className="font-medium tabular-nums text-ink">
              {details.dealsDone ?? 0} / {details.dealsTotal ?? 0}
            </span>
          </p>
          <p>
            Обновлено: <span className="font-medium tabular-nums text-ink">{details.dealsUpdated ?? 0}</span>
            {' · '}
            Ошибок: <span className="font-medium tabular-nums text-ink">{details.dealsFailed ?? 0}</span>
          </p>
          {Array.isArray(details.errors) && details.errors.length > 0 && (
            <ul className="mt-2 text-xs text-pastel-red-text bg-pastel-red-bg px-3 py-2 rounded-md space-y-1">
              {details.errors.map((entry) => (
                <li key={`${entry.dealId}-${entry.error}`}>
                  Сделка #{entry.dealId}: {entry.error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {startError && (
        <p className="mt-3 text-sm text-pastel-red-text bg-pastel-red-bg px-3 py-2 rounded-md">{startError}</p>
      )}
      {jobError && (
        <p className="mt-3 text-sm text-pastel-red-text bg-pastel-red-bg px-3 py-2 rounded-md">
          {jobError.response?.data?.error || jobError.message || 'Не удалось получить статус задачи'}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Render panel inside Twenty CRM section**

Inside the Twenty CRM `<Section>`, after the closing `</div>` of the stage selector block and before `</Section>`:

```jsx
              <BulkResyncPanel />
```

- [ ] **Step 3: Manual smoke test**

1. Start backend + frontend dev servers.
2. Open Settings → Integrations → Twenty CRM.
3. Confirm button appears; with 0 synced deals shows error on click.
4. With synced deals: confirm dialog shows count; job progress updates.

- [ ] **Step 4: Run full backend test suite**

Run:

```bash
cd backend && npm test
```

Expected: all PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Settings.jsx
git commit -m "feat: add bulk resync filters button to Settings"
```

---

## Spec Coverage Checklist

| Spec requirement | Task |
|------------------|------|
| Manual button in Settings | Task 6 |
| All deals with `twenty_id` | Task 3 `listSyncedDealIds` |
| Reuse `syncDealToTwenty` | Task 3 loop |
| Background job + progress | Tasks 3–4, 6 |
| One active job (409) | Task 4 |
| Continue on errors | Task 3 |
| Preview count before start | Task 4 + Task 6 confirm |
| 1 s delay between deals | Task 3 `DELAY_MS` |
| Single print sheet at end | Task 2 + Task 3 |
| Stage protection unchanged | No code change (existing) |
| Tests | Tasks 2–4 |

---

## Manual Verification Checklist

- [ ] Add a pattern to blacklist in Settings.
- [ ] Run bulk resync; confirm affected synced deal loses/gains line items in Twenty.
- [ ] Confirm restoration item syncs with 0 ₽ after adding to restoration list.
- [ ] Confirm podryad item gets `tip = PODRYAD` after adding to podryad list.
- [ ] Confirm second start while running returns 409 / UI error message.
