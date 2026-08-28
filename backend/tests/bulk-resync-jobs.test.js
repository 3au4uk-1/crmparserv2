import express from 'express';
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

import dealsRouter from '../src/routes/deals.js';
import {
  countSyncedDeals,
  createBulkResyncJob,
  executeBulkResyncJob,
  getActiveBulkResyncJob,
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
      title TEXT,
      approval_status TEXT,
      start_date TEXT,
      crm_event_id TEXT,
      company_code TEXT,
      manager_name TEXT,
      budget TEXT,
      synced_at TEXT,
      twenty_error TEXT,
      twenty_stage TEXT,
      updated_at TEXT
    );
    CREATE TABLE deal_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_id INTEGER,
      name TEXT,
      price REAL,
      classification TEXT,
      sync_override TEXT
    );
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE sync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_id INTEGER,
      status TEXT,
      action TEXT,
      twenty_id TEXT,
      error TEXT,
      created_at TEXT
    );
    CREATE TABLE blacklist_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern TEXT,
      match_type TEXT,
      source_name TEXT,
      created_at TEXT
    );
    CREATE TABLE restoration_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern TEXT,
      match_type TEXT,
      source_name TEXT,
      created_at TEXT
    );
    CREATE TABLE podryad_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern TEXT,
      match_type TEXT,
      source_name TEXT,
      created_at TEXT
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
  `);
  return db;
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
      .mockRejectedValueOnce(new Error('Twenty timeout'));

    runPrintSheetRefreshMock.mockResolvedValue({ exported: 1 });

    const job = createBulkResyncJob({ trigger: 'manual' });
    const promise = executeBulkResyncJob(job.jobId);

    await vi.runAllTimersAsync();
    const finished = await promise;

    expect(syncDealToTwentyMock).toHaveBeenCalledTimes(2);
    expect(syncDealToTwentyMock).toHaveBeenNthCalledWith(1, 1, {
      skipPrintSheetRefresh: true,
      ignoreLineItemStageProtection: true,
    });
    expect(syncDealToTwentyMock).toHaveBeenNthCalledWith(2, 2, {
      skipPrintSheetRefresh: true,
      ignoreLineItemStageProtection: true,
    });
    expect(runPrintSheetRefreshMock).toHaveBeenCalledTimes(1);
    expect(finished.dealsTotal).toBe(2);
    expect(finished.dealsDone).toBe(2);
    expect(finished.dealsUpdated).toBe(1);
    expect(finished.dealsFailed).toBe(1);
    expect(finished.status).toBe('completed_with_errors');
    expect(finished.errors).toEqual([{ dealId: 2, error: 'Twenty timeout' }]);
  });
});

describe('bulk-resync routes', () => {
  beforeEach(() => {
    testDb = createDb();
    resetBulkResyncJobsForTests();
    syncDealToTwentyMock.mockReset();
    syncDealToTwentyMock.mockResolvedValue({ action: 'updated', twentyId: 'opp-1' });
    runPrintSheetRefreshMock.mockResolvedValue({ exported: 0 });
  });

  it('POST /bulk-resync returns 409 when job already active', async () => {
    createBulkResyncJob({ trigger: 'manual' });
    expect(getActiveBulkResyncJob()).not.toBeNull();

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

  it('POST /bulk-resync starts job when none active', async () => {
    const app = express();
    app.use(express.json());
    app.use('/deals', dealsRouter);

    const result = await requestJson(app, 'POST', '/deals/bulk-resync');
    expect(result.status).toBe(201);
    expect(result.body.jobId).toBeTruthy();
  });

  it('POST /bulk-resync returns 409 when decor-mk-scan is active', async () => {
    const { createDecorMkScanJob } = await import('../src/services/decor-mk-scan-jobs.js');
    createDecorMkScanJob({ from: '2026-08-01', to: '2026-08-31' });
    const app = express();
    app.use(express.json());
    app.use('/deals', dealsRouter);

    const result = await requestJson(app, 'POST', '/deals/bulk-resync');
    expect(result.status).toBe(409);
    expect(result.body.error).toBe('Проверка ключевых слов декора и МК уже выполняется');
  });
});
