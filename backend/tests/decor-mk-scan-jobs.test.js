import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express from 'express';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let testDb;
const syncDealToTwentyMock = vi.fn();

vi.mock('../src/db/connection.js', () => ({
  getDb: () => testDb,
}));

vi.mock('../src/services/twenty-sync.js', () => ({
  syncDealToTwenty: (...args) => syncDealToTwentyMock(...args),
}));

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE deals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      load_date TEXT,
      approval_status TEXT,
      twenty_id TEXT,
      crm_event_id TEXT
    );
    CREATE TABLE deal_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_id INTEGER,
      name TEXT,
      classification TEXT,
      sync_override TEXT
    );
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE decor_mk_scan_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL DEFAULT 'queued',
      from_date TEXT NOT NULL,
      to_date TEXT NOT NULL,
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
    CREATE TABLE restore_missing_twenty_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL DEFAULT 'queued',
      trigger TEXT NOT NULL DEFAULT 'manual',
      started_at TEXT,
      finished_at TEXT,
      deals_total INTEGER DEFAULT 0,
      deals_done INTEGER DEFAULT 0,
      deals_restored INTEGER DEFAULT 0,
      deals_failed INTEGER DEFAULT 0,
      errors_json TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE product_stream_backfill_runs (
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
    CREATE TABLE blacklist_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern TEXT NOT NULL,
      match_type TEXT NOT NULL CHECK (match_type IN ('exact', 'substring')),
      source_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (pattern, match_type)
    );
    CREATE TABLE decor_blacklist_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern TEXT NOT NULL,
      match_type TEXT NOT NULL CHECK (match_type IN ('exact', 'substring')),
      source_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (pattern, match_type)
    );
    CREATE TABLE mk_blacklist_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern TEXT NOT NULL,
      match_type TEXT NOT NULL CHECK (match_type IN ('exact', 'substring')),
      source_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (pattern, match_type)
    );
  `);

  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(
    'keywords',
    JSON.stringify(['баннер']),
  );
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(
    'decor_keywords',
    JSON.stringify(['гирлянда']),
  );
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(
    'mk_keywords',
    JSON.stringify(['фотозона']),
  );

  return db;
}

function insertDeal({
  id,
  title = 'Deal',
  load_date = '2026-08-15',
  approval_status = 'approved',
  twenty_id = null,
  crm_event_id = null,
}) {
  testDb
    .prepare(
      `INSERT INTO deals (id, title, load_date, approval_status, twenty_id, crm_event_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, title, load_date, approval_status, twenty_id, crm_event_id);
}

function insertItem({ deal_id, name, classification = null, sync_override = null }) {
  testDb
    .prepare(
      `INSERT INTO deal_items (deal_id, name, classification, sync_override)
       VALUES (?, ?, ?, ?)`,
    )
    .run(deal_id, name, classification, sync_override);
}

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

describe('decor-mk-scan-jobs', () => {
  let listDecorMkScanDealIds;
  let parseDecorMkScanRange;
  let createDecorMkScanJob;
  let executeDecorMkScanJob;
  let resetDecorMkScanJobsForTests;

  beforeEach(async () => {
    testDb = createDb();
    syncDealToTwentyMock.mockReset();
    vi.resetModules();
    vi.useFakeTimers();

    ({
      listDecorMkScanDealIds,
      parseDecorMkScanRange,
      createDecorMkScanJob,
      executeDecorMkScanJob,
      resetDecorMkScanJobsForTests,
    } = await import('../src/services/decor-mk-scan-jobs.js'));

    resetDecorMkScanJobsForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    testDb?.close?.();
  });

  it('listDecorMkScanDealIds includes deal with load_date in range and decor item Гирлянда', () => {
    insertDeal({ id: 1, load_date: '2026-08-15' });
    insertItem({ deal_id: 1, name: 'Гирлянда' });

    expect(listDecorMkScanDealIds('2026-08-01', '2026-08-31')).toEqual([1]);
  });

  it('excludes out-of-range, empty load_date, rejected, and branding-only deals', () => {
    insertDeal({ id: 1, load_date: '2026-07-31', title: 'outside' });
    insertItem({ deal_id: 1, name: 'Гирлянда' });

    insertDeal({ id: 2, load_date: '', title: 'empty' });
    insertItem({ deal_id: 2, name: 'Гирлянда' });

    insertDeal({ id: 3, load_date: '2026-08-15', approval_status: 'rejected', title: 'rejected' });
    insertItem({ deal_id: 3, name: 'Гирлянда' });

    insertDeal({ id: 4, load_date: '2026-08-15', title: 'branding' });
    insertItem({ deal_id: 4, name: 'Баннер' });

    expect(listDecorMkScanDealIds('2026-08-01', '2026-08-31')).toEqual([]);
  });

  it('excludes decor name that is on decor_blacklist_items', () => {
    insertDeal({ id: 1, load_date: '2026-08-15' });
    insertItem({ deal_id: 1, name: 'Гирлянда праздничная' });
    testDb
      .prepare(
        `INSERT INTO decor_blacklist_items (pattern, match_type, source_name)
         VALUES (?, ?, ?)`,
      )
      .run('гирлянда', 'substring', 'test');

    expect(listDecorMkScanDealIds('2026-08-01', '2026-08-31')).toEqual([]);
  });

  it('includes MK фотозона', () => {
    insertDeal({ id: 1, load_date: '2026-08-15' });
    insertItem({ deal_id: 1, name: 'Фотозона' });

    expect(listDecorMkScanDealIds('2026-08-01', '2026-08-31')).toEqual([1]);
  });

  it('includes deal whose item is both DECOR and BRANDING', () => {
    insertDeal({ id: 1, load_date: '2026-08-15' });
    insertItem({ deal_id: 1, name: 'Гирлянда баннер' });

    expect(listDecorMkScanDealIds('2026-08-01', '2026-08-31')).toEqual([1]);
  });

  it('does not select a deal when the matching decor item is sync_override exclude', () => {
    insertDeal({ id: 1, load_date: '2026-08-15' });
    insertItem({ deal_id: 1, name: 'Гирлянда', sync_override: 'exclude' });

    expect(listDecorMkScanDealIds('2026-08-01', '2026-08-31')).toEqual([]);
  });

  it('does not select a branding-only deal with sync_override include', () => {
    insertDeal({ id: 1, load_date: '2026-08-15' });
    insertItem({
      deal_id: 1,
      name: 'Баннер',
      classification: 'keyword_match',
      sync_override: 'include',
    });

    expect(listDecorMkScanDealIds('2026-08-01', '2026-08-31')).toEqual([]);
  });

  it('does not select a non-stream item with sync_override include', () => {
    insertDeal({ id: 1, load_date: '2026-08-15' });
    insertItem({
      deal_id: 1,
      name: 'Скотч',
      classification: 'unclassified',
      sync_override: 'include',
    });

    expect(listDecorMkScanDealIds('2026-08-01', '2026-08-31')).toEqual([]);
  });

  it('parseDecorMkScanRange throws statusCode 400 when from > to', () => {
    expect(() => parseDecorMkScanRange('2026-08-02', '2026-08-01')).toThrow();
    try {
      parseDecorMkScanRange('2026-08-02', '2026-08-01');
    } catch (err) {
      expect(err.statusCode).toBe(400);
      expect(err.message).toBe('Дата «с» не может быть позже «по»');
    }
  });

  it('marks job failed when listing deals throws', async () => {
    testDb.prepare("UPDATE settings SET value = ? WHERE key = 'keywords'").run('not-json');

    const job = createDecorMkScanJob({ from: '2026-08-01', to: '2026-08-31' });
    const finished = await executeDecorMkScanJob(job.jobId);

    expect(finished.status).toBe('failed');
    expect(finished.error).toBeTruthy();
  });

  it('executeDecorMkScanJob syncs with productStreams and does not count skipped as updated', async () => {
    insertDeal({ id: 1, load_date: '2026-08-15', twenty_id: 'opp-1' });
    insertItem({ deal_id: 1, name: 'Гирлянда' });

    syncDealToTwentyMock.mockResolvedValue({ action: 'skipped', itemCount: 0 });

    const job = createDecorMkScanJob({ from: '2026-08-01', to: '2026-08-31' });
    const promise = executeDecorMkScanJob(job.jobId);
    await vi.runAllTimersAsync();
    const finished = await promise;

    expect(syncDealToTwentyMock).toHaveBeenCalledWith(1, {
      skipPrintSheetRefresh: true,
      ignoreLineItemStageProtection: true,
      productStreams: ['DECOR', 'MK'],
    });
    expect(finished.dealsDone).toBe(1);
    expect(finished.dealsUpdated).toBe(0);
    expect(finished.status).toBe('completed');
  });

  it('does not delay 1s between deals and uses skipPrintSheetRefresh', async () => {
    insertDeal({ id: 1, load_date: '2026-08-15', twenty_id: 'opp-1' });
    insertItem({ deal_id: 1, name: 'Гирлянда' });
    insertDeal({ id: 2, load_date: '2026-08-16', twenty_id: 'opp-2' });
    insertItem({ deal_id: 2, name: 'Фотозона' });

    syncDealToTwentyMock.mockResolvedValue({ action: 'updated', twentyId: 'opp-1' });

    const started = Date.now();
    const job = createDecorMkScanJob({ from: '2026-08-01', to: '2026-08-31' });
    const promise = executeDecorMkScanJob(job.jobId);
    await vi.runAllTimersAsync();
    await promise;

    expect(Date.now() - started).toBeLessThan(500);
    expect(syncDealToTwentyMock).toHaveBeenCalledTimes(2);
    expect(syncDealToTwentyMock.mock.calls.every(([, opts]) => opts.skipPrintSheetRefresh)).toBe(true);
    expect(
      readFileSync(
        path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/services/decor-mk-scan-jobs.js'),
        'utf8',
      ),
    ).not.toMatch(/DELAY_MS/);
  });
});

describe('decor-mk-scan routes', () => {
  let dealsRouter;
  let createDecorMkScanJob;
  let createBulkResyncJob;
  let resetDecorMkScanJobsForTests;
  let resetBulkResyncJobsForTests;
  let resetRestoreMissingTwentyJobsForTests;

  beforeEach(async () => {
    testDb = createDb();
    syncDealToTwentyMock.mockReset();
    syncDealToTwentyMock.mockResolvedValue({ action: 'updated', twentyId: 'opp-1' });
    vi.resetModules();

    dealsRouter = (await import('../src/routes/deals.js')).default;
    ({
      createDecorMkScanJob,
      resetDecorMkScanJobsForTests,
    } = await import('../src/services/decor-mk-scan-jobs.js'));
    ({
      createBulkResyncJob,
      resetBulkResyncJobsForTests,
    } = await import('../src/services/bulk-resync-jobs.js'));
    ({
      resetRestoreMissingTwentyJobsForTests,
    } = await import('../src/services/restore-missing-twenty-jobs.js'));

    resetDecorMkScanJobsForTests();
    resetBulkResyncJobsForTests();
    resetRestoreMissingTwentyJobsForTests();
  });

  afterEach(() => {
    testDb?.close?.();
  });

  function mountApp() {
    const app = express();
    app.use(express.json());
    app.use('/deals', dealsRouter);
    return app;
  }

  it('GET preview without dates returns 400', async () => {
    const result = await requestJson(mountApp(), 'GET', '/deals/decor-mk-scan/preview');
    expect(result.status).toBe(400);
  });

  it('GET preview with valid range returns count', async () => {
    insertDeal({ id: 1, load_date: '2026-08-15' });
    insertItem({ deal_id: 1, name: 'Гирлянда' });

    const result = await requestJson(
      mountApp(),
      'GET',
      '/deals/decor-mk-scan/preview?from=2026-08-01&to=2026-08-31',
    );
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      count: 1,
      from: '2026-08-01',
      to: '2026-08-31',
    });
  });

  it('POST without body dates returns 400', async () => {
    const result = await requestJson(mountApp(), 'POST', '/deals/decor-mk-scan', {});
    expect(result.status).toBe(400);
  });

  it('POST returns 409 when decor-mk-scan already active', async () => {
    createDecorMkScanJob({ from: '2026-08-01', to: '2026-08-31' });
    const result = await requestJson(mountApp(), 'POST', '/deals/decor-mk-scan', {
      from: '2026-08-01',
      to: '2026-08-31',
    });
    expect(result.status).toBe(409);
    expect(result.body.error).toBe('Проверка ключевых слов декора и МК уже выполняется');
  });

  it('POST returns 409 when bulk-resync is active', async () => {
    createBulkResyncJob({ trigger: 'manual' });
    const result = await requestJson(mountApp(), 'POST', '/deals/decor-mk-scan', {
      from: '2026-08-01',
      to: '2026-08-31',
    });
    expect(result.status).toBe(409);
    expect(result.body.error).toBe('Массовая пересинхронизация уже выполняется');
  });

  it('POST when idle returns 201 with jobId', async () => {
    const result = await requestJson(mountApp(), 'POST', '/deals/decor-mk-scan', {
      from: '2026-08-01',
      to: '2026-08-31',
    });
    expect(result.status).toBe(201);
    expect(result.body.jobId).toBeTruthy();
  });

  it('GET missing job id returns 404', async () => {
    const result = await requestJson(mountApp(), 'GET', '/deals/decor-mk-scan/jobs/999');
    expect(result.status).toBe(404);
    expect(result.body.error).toBe('Задача не найдена');
  });
});
