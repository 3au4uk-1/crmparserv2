import express from 'express';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let testDb;
const listLineItemsForOpportunityMock = vi.fn();
const updateDealLineItemProductStreamsMock = vi.fn();
const requireTwentyConfigMock = vi.fn();
const gqlMock = vi.fn();
const planProductStreamBackfillMock = vi.fn();

vi.mock('../src/db/connection.js', () => ({
  getDb: () => testDb,
}));

vi.mock('../src/services/twenty-config.js', () => ({
  requireTwentyConfig: (...args) => requireTwentyConfigMock(...args),
}));

vi.mock('../src/services/twenty-gql.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    gql: (...args) => gqlMock(...args),
  };
});

vi.mock('../src/services/twenty-line-items-sync.js', () => ({
  listLineItemsForOpportunity: (...args) => listLineItemsForOpportunityMock(...args),
  updateDealLineItemProductStreams: (...args) => updateDealLineItemProductStreamsMock(...args),
}));

vi.mock('../src/services/product-stream-backfill.js', () => ({
  planProductStreamBackfill: (...args) => planProductStreamBackfillMock(...args),
}));

import dealsRouter from '../src/routes/deals.js';
import {
  createBulkResyncJob,
  resetBulkResyncJobsForTests,
} from '../src/services/bulk-resync-jobs.js';
import {
  countProductStreamBackfillDeals,
  createProductStreamBackfillJob,
  executeProductStreamBackfillJob,
  getActiveProductStreamBackfillJob,
  resetProductStreamBackfillJobsForTests,
} from '../src/services/product-stream-backfill-jobs.js';

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
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
      deals_skipped INTEGER DEFAULT 0,
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
      twenty_id TEXT,
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
    CREATE TABLE decor_blacklist_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern TEXT,
      match_type TEXT,
      source_name TEXT,
      created_at TEXT
    );
    CREATE TABLE mk_blacklist_items (
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

describe('product-stream-backfill-jobs', () => {
  beforeEach(() => {
    testDb = createDb();
    listLineItemsForOpportunityMock.mockReset();
    updateDealLineItemProductStreamsMock.mockReset();
    requireTwentyConfigMock.mockReset();
    gqlMock.mockReset();
    planProductStreamBackfillMock.mockReset();
    resetProductStreamBackfillJobsForTests();
    resetBulkResyncJobsForTests();
    requireTwentyConfigMock.mockReturnValue({
      apiUrl: 'https://twenty.test/graphql',
      apiToken: 'token',
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('countProductStreamBackfillDeals ignores rejected and empty twenty_id', () => {
    testDb.prepare("INSERT INTO deals (twenty_id, approval_status) VALUES ('opp-1', 'synced')").run();
    testDb.prepare("INSERT INTO deals (twenty_id, approval_status) VALUES ('opp-2', 'rejected')").run();
    testDb.prepare("INSERT INTO deals (twenty_id, approval_status) VALUES ('', 'synced')").run();
    testDb.prepare('INSERT INTO deals (twenty_id, approval_status) VALUES (NULL, ?)').run('approved');
    expect(countProductStreamBackfillDeals()).toBe(1);
  });

  it('executeProductStreamBackfillJob continues on failure and skips full resync', async () => {
    testDb.prepare("INSERT INTO deals (id, twenty_id, approval_status) VALUES (1, 'opp-1', 'synced')").run();
    testDb.prepare("INSERT INTO deals (id, twenty_id, approval_status) VALUES (2, 'opp-2', 'synced')").run();
    testDb.prepare("INSERT INTO deal_items (deal_id, name) VALUES (1, 'Баннер')").run();
    testDb.prepare("INSERT INTO deal_items (deal_id, name) VALUES (2, 'Декор')").run();

    listLineItemsForOpportunityMock
      .mockResolvedValueOnce([{ id: 'li-1', name: 'Баннер', productStream: 'BRANDING' }])
      .mockRejectedValueOnce(new Error('Twenty timeout'));

    planProductStreamBackfillMock.mockReturnValue({
      toUpdate: [{ twentyId: 'li-1', productStreams: ['BRANDING'], name: 'Баннер' }],
      skipped: 0,
    });
    updateDealLineItemProductStreamsMock.mockResolvedValue({ id: 'li-1' });

    const job = createProductStreamBackfillJob({ trigger: 'manual' });
    const promise = executeProductStreamBackfillJob(job.jobId);

    await vi.runAllTimersAsync();
    const finished = await promise;

    expect(requireTwentyConfigMock).toHaveBeenCalledTimes(1);
    expect(listLineItemsForOpportunityMock).toHaveBeenCalledTimes(2);
    expect(updateDealLineItemProductStreamsMock).toHaveBeenCalledTimes(1);
    expect(updateDealLineItemProductStreamsMock).toHaveBeenCalledWith(
      expect.any(Function),
      'https://twenty.test/graphql',
      'token',
      'li-1',
      ['BRANDING'],
      expect.any(Function),
      expect.any(Function),
    );
    expect(finished.dealsTotal).toBe(2);
    expect(finished.dealsDone).toBe(2);
    expect(finished.dealsUpdated).toBe(1);
    expect(finished.dealsFailed).toBe(1);
    expect(finished.status).toBe('completed_with_errors');
    expect(finished.errors).toEqual([{ dealId: 2, error: 'Twenty timeout' }]);
  });

  it('marks job failed when Twenty is not configured', async () => {
    requireTwentyConfigMock.mockImplementation(() => {
      throw new Error('Twenty CRM not configured');
    });
    testDb.prepare("INSERT INTO deals (twenty_id, approval_status) VALUES ('opp-1', 'synced')").run();

    const job = createProductStreamBackfillJob({ trigger: 'manual' });
    const finished = await executeProductStreamBackfillJob(job.jobId);

    expect(finished.status).toBe('failed');
    expect(finished.error).toBe('Twenty CRM not configured');
    expect(listLineItemsForOpportunityMock).not.toHaveBeenCalled();
  });
});

describe('product-stream-backfill routes', () => {
  beforeEach(() => {
    testDb = createDb();
    resetProductStreamBackfillJobsForTests();
    resetBulkResyncJobsForTests();
    requireTwentyConfigMock.mockReturnValue({
      apiUrl: 'https://twenty.test/graphql',
      apiToken: 'token',
    });
    listLineItemsForOpportunityMock.mockResolvedValue([]);
    planProductStreamBackfillMock.mockReturnValue({ toUpdate: [], skipped: 0 });
  });

  it('GET /product-stream-backfill/preview returns count', async () => {
    testDb.prepare("INSERT INTO deals (twenty_id, approval_status) VALUES ('opp-1', 'synced')").run();
    const app = express();
    app.use(express.json());
    app.use('/deals', dealsRouter);

    const result = await requestJson(app, 'GET', '/deals/product-stream-backfill/preview');
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ count: 1 });
  });

  it('POST /product-stream-backfill returns 409 when bulk-resync is queued', async () => {
    createBulkResyncJob({ trigger: 'manual' });

    const app = express();
    app.use(express.json());
    app.use('/deals', dealsRouter);

    const result = await requestJson(app, 'POST', '/deals/product-stream-backfill');
    expect(result.status).toBe(409);
  });

  it('POST /bulk-resync returns 409 when product-stream-backfill is active', async () => {
    createProductStreamBackfillJob({ trigger: 'manual' });
    expect(getActiveProductStreamBackfillJob()).not.toBeNull();

    const app = express();
    app.use(express.json());
    app.use('/deals', dealsRouter);

    const result = await requestJson(app, 'POST', '/deals/bulk-resync');
    expect(result.status).toBe(409);
  });

  it('POST /product-stream-backfill starts job when none active', async () => {
    const app = express();
    app.use(express.json());
    app.use('/deals', dealsRouter);

    const result = await requestJson(app, 'POST', '/deals/product-stream-backfill');
    expect(result.status).toBe(201);
    expect(result.body.jobId).toBeTruthy();
  });
});
