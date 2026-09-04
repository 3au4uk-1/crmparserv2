import express from 'express';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let testDb;
const syncDealToTwentyMock = vi.fn();
const runPrintSheetRefreshMock = vi.fn();
const opportunityExistsInTwentyMock = vi.fn();
const findTwentyOpportunityIdByBookingMock = vi.fn();

vi.mock('../src/db/connection.js', () => ({
  getDb: () => testDb,
}));

vi.mock('../src/services/twenty-sync.js', () => ({
  syncDealToTwenty: (...args) => syncDealToTwentyMock(...args),
  runPrintSheetRefresh: (...args) => runPrintSheetRefreshMock(...args),
}));

vi.mock('../src/services/twenty-lookup.js', () => ({
  opportunityExistsInTwenty: (...args) => opportunityExistsInTwentyMock(...args),
  findTwentyOpportunityIdByBooking: (...args) => findTwentyOpportunityIdByBookingMock(...args),
}));

import dealsRouter from '../src/routes/deals.js';
import {
  countSyncedDealsForRestore,
  createRestoreMissingTwentyJob,
  executeRestoreMissingTwentyJob,
  resetRestoreMissingTwentyJobsForTests,
  recoverStaleRestoreMissingTwentyJobs,
  restoreMissingDealInTwenty,
} from '../src/services/restore-missing-twenty-jobs.js';

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
    CREATE TABLE deals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      twenty_id TEXT,
      tony_order_id TEXT,
      title TEXT,
      approval_status TEXT,
      twenty_stage TEXT,
      twenty_error TEXT,
      updated_at TEXT
    );
    CREATE TABLE deal_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_id INTEGER,
      twenty_id TEXT,
      name TEXT
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

describe('restore-missing-twenty-jobs', () => {
  beforeEach(() => {
    testDb = createDb();
    resetRestoreMissingTwentyJobsForTests();
    syncDealToTwentyMock.mockReset();
    runPrintSheetRefreshMock.mockReset();
    opportunityExistsInTwentyMock.mockReset();
    findTwentyOpportunityIdByBookingMock.mockReset();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts synced deals for restore preview', () => {
    testDb.prepare("INSERT INTO deals (twenty_id) VALUES ('opp-1')").run();
    testDb.prepare("INSERT INTO deals (twenty_id) VALUES ('opp-2')").run();
    testDb.prepare('INSERT INTO deals (twenty_id) VALUES (NULL)').run();
    expect(countSyncedDealsForRestore()).toBe(2);
  });

  it('skips deals that still exist in Twenty', async () => {
    testDb.prepare("INSERT INTO deals (twenty_id, tony_order_id) VALUES ('opp-1', '169120')").run();
    opportunityExistsInTwentyMock.mockResolvedValue(true);

    const result = await restoreMissingDealInTwenty(1);
    expect(result).toEqual({ action: 'skipped', reason: 'exists_in_twenty' });
    expect(syncDealToTwentyMock).not.toHaveBeenCalled();
  });

  it('adopts existing opportunity by booking when stored id is stale', async () => {
    testDb.prepare("INSERT INTO deals (twenty_id, tony_order_id) VALUES ('opp-old', '169120')").run();
    opportunityExistsInTwentyMock.mockResolvedValue(false);
    findTwentyOpportunityIdByBookingMock.mockResolvedValue('opp-new');
    syncDealToTwentyMock.mockResolvedValue({ twentyId: 'opp-new', action: 'updated' });

    const result = await restoreMissingDealInTwenty(1);
    expect(result).toEqual({ action: 'adopted', twentyId: 'opp-new' });
    expect(testDb.prepare('SELECT twenty_id FROM deals WHERE id = 1').get().twenty_id).toBe('opp-new');
    expect(syncDealToTwentyMock).toHaveBeenCalledWith(1);
  });

  it('recreates opportunity when missing in Twenty', async () => {
    testDb.prepare("INSERT INTO deals (twenty_id, tony_order_id) VALUES ('opp-gone', '169120')").run();
    testDb.prepare("INSERT INTO deal_items (deal_id, twenty_id, name) VALUES (1, 'li-1', 'Banner')").run();
    opportunityExistsInTwentyMock.mockResolvedValue(false);
    findTwentyOpportunityIdByBookingMock.mockResolvedValue(null);
    syncDealToTwentyMock.mockResolvedValue({ twentyId: 'opp-created', action: 'created' });

    const result = await restoreMissingDealInTwenty(1);
    expect(result).toEqual({ action: 'created', twentyId: 'opp-created' });
    expect(testDb.prepare('SELECT twenty_id FROM deals WHERE id = 1').get().twenty_id).toBeNull();
    expect(testDb.prepare('SELECT twenty_id FROM deal_items WHERE deal_id = 1').get().twenty_id).toBeNull();
    expect(syncDealToTwentyMock).toHaveBeenCalledWith(1);
  });

  it('recovers stale running jobs on startup', () => {
    testDb.prepare("INSERT INTO restore_missing_twenty_runs (status) VALUES ('running')").run();
    testDb.prepare("INSERT INTO restore_missing_twenty_runs (status) VALUES ('queued')").run();
    testDb.prepare("INSERT INTO restore_missing_twenty_runs (status) VALUES ('completed')").run();

    const changes = recoverStaleRestoreMissingTwentyJobs(testDb);
    expect(changes).toBe(2);

    const rows = testDb
      .prepare('SELECT status, error FROM restore_missing_twenty_runs ORDER BY id ASC')
      .all();
    expect(rows[0].status).toBe('failed');
    expect(rows[1].status).toBe('failed');
    expect(rows[2].status).toBe('completed');
  });

  it('executes restore job and tracks progress', async () => {
    testDb.prepare("INSERT INTO deals (twenty_id) VALUES ('opp-1')").run();
    testDb.prepare("INSERT INTO deals (twenty_id) VALUES ('opp-2')").run();
    opportunityExistsInTwentyMock.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    findTwentyOpportunityIdByBookingMock.mockResolvedValue(null);
    syncDealToTwentyMock.mockResolvedValue({ twentyId: 'opp-new', action: 'created' });

    const job = createRestoreMissingTwentyJob({ trigger: 'manual' });
    const promise = executeRestoreMissingTwentyJob(job.jobId);
    await vi.runAllTimersAsync();
    const finished = await promise;

    expect(finished.status).toBe('completed');
    expect(finished.dealsTotal).toBe(2);
    expect(finished.dealsDone).toBe(2);
    expect(finished.dealsSkipped).toBe(1);
    expect(finished.dealsRestored).toBe(1);
    expect(runPrintSheetRefreshMock).toHaveBeenCalledOnce();
  });
});

describe('restore-missing-twenty routes', () => {
  beforeEach(() => {
    testDb = createDb();
    resetRestoreMissingTwentyJobsForTests();
    syncDealToTwentyMock.mockReset();
    opportunityExistsInTwentyMock.mockResolvedValue(true);
    findTwentyOpportunityIdByBookingMock.mockResolvedValue(null);
  });

  it('returns preview count', async () => {
    testDb.prepare("INSERT INTO deals (twenty_id) VALUES ('opp-1')").run();
    const app = express().use('/deals', dealsRouter);
    const { status, body } = await requestJson(app, 'GET', '/deals/restore-missing-twenty/preview');
    expect(status).toBe(200);
    expect(body.count).toBe(1);
  });

  it('starts restore job', async () => {
    testDb.prepare("INSERT INTO deals (twenty_id) VALUES ('opp-1')").run();
    const app = express().use(express.json()).use('/deals', dealsRouter);
    const { status, body } = await requestJson(app, 'POST', '/deals/restore-missing-twenty');
    expect(status).toBe(201);
    expect(body.jobId).toBeTruthy();
  });
});
