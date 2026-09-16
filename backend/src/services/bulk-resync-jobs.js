import { getDb } from '../db/connection.js';
import { runDealSyncPool } from './deal-sync-pool.js';
import { syncDealToTwenty, runPrintSheetRefresh } from './twenty-sync.js';

const ACTIVE_STATUSES = new Set(['queued', 'running']);
const MAX_ERRORS = 50;

const jobs = new Map();

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

  try {
    await runDealSyncPool(dealIds, async (dealId) => {
      return syncDealToTwenty(dealId, {
        skipPrintSheetRefresh: true,
        ignoreLineItemStageProtection: true,
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

    try {
      await runPrintSheetRefresh();
    } catch (err) {
      console.warn('[bulk-resync] print sheet refresh failed:', err.message);
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
