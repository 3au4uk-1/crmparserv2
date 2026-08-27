import express from 'express';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let testDb;
const runExpenseSyncMock = vi.fn();

vi.mock('../src/db/connection.js', () => ({
  getDb: () => testDb,
}));

vi.mock('../src/services/expense-sync.js', () => ({
  runExpenseSync: (...args) => runExpenseSyncMock(...args),
}));

import expensesRouter from '../src/routes/expenses.js';
import {
  createExpenseJob,
  executeExpenseJob,
  getActiveExpenseJob,
  getExpenseJob,
  recoverStaleExpenseRuns,
  resetExpenseJobsForTests,
} from '../src/services/expense-jobs.js';

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE expense_sync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL DEFAULT 'queued',
      trigger TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      deals_targeted INTEGER DEFAULT 0,
      deals_updated INTEGER DEFAULT 0,
      deals_with_expenses INTEGER DEFAULT 0,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  return db;
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/', expensesRouter);
  return app;
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
    return {
      status: response.status,
      body: text ? JSON.parse(text) : null,
    };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

describe('expense-jobs', () => {
  beforeEach(() => {
    testDb = createDb();
    runExpenseSyncMock.mockReset();
    resetExpenseJobsForTests();
  });

  afterEach(() => {
    testDb.close();
  });

  it('returns 409 for concurrent /sync requests', async () => {
    createExpenseJob({ trigger: 'manual' });
    const app = createApp();

    const response = await requestJson(app, 'POST', '/sync');

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: 'Синхронизация расходов уже выполняется' });
    expect(runExpenseSyncMock).not.toHaveBeenCalled();
  });

  it('executes lifecycle and persists completed_with_errors status', async () => {
    runExpenseSyncMock.mockResolvedValue({
      dealsTargeted: 3,
      dealsUpdated: 2,
      dealsWithExpenses: 2,
      errors: ['Deal 101: update failed'],
    });

    const job = createExpenseJob({ trigger: 'manual' });
    expect(getExpenseJob(job.jobId)?.status).toBe('queued');

    const execution = executeExpenseJob(job.jobId);
    expect(getActiveExpenseJob()?.jobId).toBe(job.jobId);

    const completedJob = await execution;

    expect(runExpenseSyncMock).toHaveBeenCalledWith({ trigger: 'manual' });
    expect(completedJob).toMatchObject({
      jobId: job.jobId,
      status: 'completed_with_errors',
      dealsTargeted: 3,
      dealsUpdated: 2,
      dealsWithExpenses: 2,
      error: 'Deal 101: update failed',
    });
    expect(completedJob.startedAt).toBeTruthy();
    expect(completedJob.finishedAt).toBeTruthy();
    expect(getActiveExpenseJob()).toBeNull();

    const row = testDb
      .prepare(
        `SELECT status, trigger, started_at, finished_at, deals_targeted, deals_updated, deals_with_expenses, error
         FROM expense_sync_runs
         WHERE id = ?`,
      )
      .get(Number(job.jobId));

    expect(row).toEqual({
      status: 'completed_with_errors',
      trigger: 'manual',
      started_at: expect.any(String),
      finished_at: expect.any(String),
      deals_targeted: 3,
      deals_updated: 2,
      deals_with_expenses: 2,
      error: 'Deal 101: update failed',
    });
  });

  it('recovers stale running jobs so a new sync can start', async () => {
    const stale = createExpenseJob({ trigger: 'cron' });
    testDb
      .prepare(`UPDATE expense_sync_runs SET status = 'running', started_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), Number(stale.jobId));
    resetExpenseJobsForTests();
    expect(getActiveExpenseJob()?.jobId).toBe(stale.jobId);

    const recovered = recoverStaleExpenseRuns();
    expect(recovered).toBe(1);
    expect(getActiveExpenseJob()).toBeNull();
    expect(getExpenseJob(stale.jobId)).toMatchObject({
      status: 'failed',
      error: 'Interrupted: server restarted while expense sync was in progress',
    });

    runExpenseSyncMock.mockResolvedValue({
      dealsTargeted: 1,
      dealsUpdated: 1,
      dealsWithExpenses: 0,
      errors: [],
    });
    const app = createApp();
    const response = await requestJson(app, 'POST', '/sync');
    expect(response.status).toBe(201);
    expect(response.body.jobId).toBeTruthy();
    expect(response.body.jobId).not.toBe(stale.jobId);
  });
});
