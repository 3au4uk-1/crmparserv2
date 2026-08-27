import { getDb } from '../db/connection.js';
import { runExpenseSync } from './expense-sync.js';

const ACTIVE_STATUSES = new Set(['queued', 'running']);
const jobs = new Map();

function mapExpenseRunRow(row) {
  if (!row) return null;
  return {
    jobId: String(row.id),
    status: row.status,
    trigger: row.trigger,
    startedAt: row.started_at ?? null,
    finishedAt: row.finished_at ?? null,
    dealsTargeted: row.deals_targeted ?? 0,
    dealsUpdated: row.deals_updated ?? 0,
    dealsWithExpenses: row.deals_with_expenses ?? 0,
    error: row.error ?? null,
    createdAt: row.created_at ?? null,
  };
}

function storeJob(job) {
  jobs.set(job.jobId, job);
  return job;
}

function updateJob(jobId, patch) {
  const job = jobs.get(jobId);
  if (!job) return null;
  Object.assign(job, patch);
  return job;
}

export function resetExpenseJobsForTests() {
  jobs.clear();
}

export function recoverStaleExpenseRuns() {
  const db = getDb();
  const error = 'Interrupted: server restarted while expense sync was in progress';
  const result = db
    .prepare(
      `UPDATE expense_sync_runs
       SET status = 'failed',
           finished_at = datetime('now'),
           error = ?
       WHERE status IN ('queued', 'running')`,
    )
    .run(error);

  for (const [jobId, job] of jobs.entries()) {
    if (ACTIVE_STATUSES.has(job.status)) {
      jobs.delete(jobId);
    }
  }

  if (result.changes > 0) {
    console.warn(`[expense-sync] marked ${result.changes} stale run(s) as failed`);
  }

  return result.changes;
}

export function createExpenseJob({ trigger = 'manual' } = {}) {
  const db = getDb();
  const result = db
    .prepare('INSERT INTO expense_sync_runs (status, trigger) VALUES (?, ?)')
    .run('queued', trigger);

  const row = db
    .prepare('SELECT * FROM expense_sync_runs WHERE id = ?')
    .get(Number(result.lastInsertRowid));

  return storeJob(mapExpenseRunRow(row));
}

export function getExpenseJob(jobId) {
  const normalizedJobId = String(jobId);
  if (jobs.has(normalizedJobId)) {
    return jobs.get(normalizedJobId);
  }

  const db = getDb();
  const row = db
    .prepare('SELECT * FROM expense_sync_runs WHERE id = ?')
    .get(Number(normalizedJobId));
  if (!row) return null;

  return storeJob(mapExpenseRunRow(row));
}

export function getActiveExpenseJob() {
  for (const job of jobs.values()) {
    if (ACTIVE_STATUSES.has(job.status)) {
      return job;
    }
  }

  const db = getDb();
  const row = db
    .prepare(
      `SELECT *
       FROM expense_sync_runs
       WHERE status IN ('queued', 'running')
       ORDER BY id DESC
       LIMIT 1`,
    )
    .get();

  if (!row) return null;
  return storeJob(mapExpenseRunRow(row));
}

export async function executeExpenseJob(jobId) {
  const job = getExpenseJob(jobId);
  if (!job) return null;

  const startedAt = new Date().toISOString();
  updateJob(job.jobId, {
    status: 'running',
    startedAt,
    finishedAt: null,
    error: null,
  });

  const db = getDb();
  db.prepare(
    `UPDATE expense_sync_runs
     SET status = ?, started_at = ?, finished_at = NULL, error = NULL
     WHERE id = ?`,
  ).run('running', startedAt, Number(job.jobId));

  try {
    const stats = await runExpenseSync({ trigger: job.trigger });
    const errors = Array.isArray(stats?.errors) ? stats.errors : [];
    const finishedAt = new Date().toISOString();
    const status = errors.length > 0 ? 'completed_with_errors' : 'completed';
    const error = errors.length > 0 ? errors.join('\n') : null;

    updateJob(job.jobId, {
      status,
      finishedAt,
      dealsTargeted: stats?.dealsTargeted ?? 0,
      dealsUpdated: stats?.dealsUpdated ?? 0,
      dealsWithExpenses: stats?.dealsWithExpenses ?? 0,
      error,
    });

    db.prepare(
      `UPDATE expense_sync_runs
       SET status = ?,
           finished_at = ?,
           deals_targeted = ?,
           deals_updated = ?,
           deals_with_expenses = ?,
           error = ?
       WHERE id = ?`,
    ).run(
      status,
      finishedAt,
      stats?.dealsTargeted ?? 0,
      stats?.dealsUpdated ?? 0,
      stats?.dealsWithExpenses ?? 0,
      error,
      Number(job.jobId),
    );
  } catch (err) {
    const finishedAt = new Date().toISOString();
    const error = err instanceof Error ? err.message : String(err);

    updateJob(job.jobId, {
      status: 'failed',
      finishedAt,
      error,
    });

    db.prepare(
      `UPDATE expense_sync_runs
       SET status = ?, finished_at = ?, error = ?
       WHERE id = ?`,
    ).run('failed', finishedAt, error, Number(job.jobId));
  }

  return getExpenseJob(job.jobId);
}
