import { getDb } from '../db/connection.js';
import { runDealSyncPool } from './deal-sync-pool.js';
import { loadProductStreamContext, resolveItemProductStreams } from './twenty-items.js';
import { syncDealToTwenty } from './twenty-sync.js';

const ACTIVE_STATUSES = new Set(['queued', 'running']);
const MAX_ERRORS = 50;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

function mapDecorMkScanRunRow(row) {
  if (!row) return null;
  return {
    jobId: String(row.id),
    status: row.status,
    from: row.from_date,
    to: row.to_date,
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
    `UPDATE decor_mk_scan_runs
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

function throwBadRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  throw err;
}

export function parseDecorMkScanRange(from, to) {
  if (!from || !to || !ISO_DATE_RE.test(from) || !ISO_DATE_RE.test(to)) {
    throwBadRequest('Укажите даты from и to в формате YYYY-MM-DD');
  }
  if (from > to) {
    throwBadRequest('Дата «с» не может быть позже «по»');
  }
  return { from, to };
}

export function listDecorMkScanDealIds(from, to) {
  const db = getDb();
  const ctx = loadProductStreamContext(db);
  const deals = db
    .prepare(
      `SELECT * FROM deals
       WHERE load_date IS NOT NULL AND TRIM(load_date) != ''
         AND load_date >= ? AND load_date <= ?
         AND approval_status != 'rejected'
       ORDER BY id ASC`,
    )
    .all(from, to);

  const ids = [];
  for (const deal of deals) {
    const items = db
      .prepare('SELECT * FROM deal_items WHERE deal_id = ?')
      .all(deal.id);
    const hasMatch = items.some((item) => {
      if (item.sync_override === 'exclude') return false;
      const streams = resolveItemProductStreams(item, ctx);
      return streams.includes('DECOR') || streams.includes('MK');
    });
    if (hasMatch) ids.push(deal.id);
  }
  return ids;
}

export function countDecorMkScanDeals(from, to) {
  return listDecorMkScanDealIds(from, to).length;
}

export function resetDecorMkScanJobsForTests() {
  jobs.clear();
}

export function createDecorMkScanJob({ from, to }) {
  const db = getDb();
  const result = db
    .prepare(
      'INSERT INTO decor_mk_scan_runs (status, from_date, to_date) VALUES (?, ?, ?)',
    )
    .run('queued', from, to);

  const row = db
    .prepare('SELECT * FROM decor_mk_scan_runs WHERE id = ?')
    .get(Number(result.lastInsertRowid));

  return storeJob(mapDecorMkScanRunRow(row));
}

export function getDecorMkScanJob(jobId) {
  const normalizedJobId = String(jobId);
  if (jobs.has(normalizedJobId)) {
    return jobs.get(normalizedJobId);
  }

  const db = getDb();
  const row = db
    .prepare('SELECT * FROM decor_mk_scan_runs WHERE id = ?')
    .get(Number(normalizedJobId));
  if (!row) return null;

  return storeJob(mapDecorMkScanRunRow(row));
}

export function getActiveDecorMkScanJob() {
  for (const job of jobs.values()) {
    if (ACTIVE_STATUSES.has(job.status)) {
      return job;
    }
  }

  const db = getDb();
  const row = db
    .prepare(
      `SELECT *
       FROM decor_mk_scan_runs
       WHERE status IN ('queued', 'running')
       ORDER BY id DESC
       LIMIT 1`,
    )
    .get();

  if (!row) return null;
  return storeJob(mapDecorMkScanRunRow(row));
}

export async function executeDecorMkScanJob(jobId) {
  const job = getDecorMkScanJob(jobId);
  if (!job) return null;

  const db = getDb();
  const startedAt = new Date().toISOString();

  try {
    const dealIds = listDecorMkScanDealIds(job.from, job.to);

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
      `UPDATE decor_mk_scan_runs
       SET status = ?, started_at = ?, finished_at = NULL, error = NULL, deals_total = ?
       WHERE id = ?`,
    ).run('running', startedAt, dealIds.length, Number(job.jobId));

    await runDealSyncPool(dealIds, async (dealId) => {
      return syncDealToTwenty(dealId, {
        skipPrintSheetRefresh: true,
        ignoreLineItemStageProtection: true,
        productStreams: ['DECOR', 'MK'],
      });
    }, {
      onDealSettled: ({ dealId, ok, result, error }) => {
        job.dealsDone += 1;
        if (
          ok && (
            result?.action === 'updated'
            || result?.action === 'updated_empty'
            || result?.action === 'created'
          )
        ) {
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

    const finishedAt = new Date().toISOString();
    const status = job.dealsFailed > 0 ? 'completed_with_errors' : 'completed';

    updateJob(job.jobId, { status, finishedAt });
    db.prepare(
      `UPDATE decor_mk_scan_runs
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
      `UPDATE decor_mk_scan_runs
       SET status = ?, finished_at = ?, error = ?
       WHERE id = ?`,
    ).run('failed', finishedAt, error, Number(job.jobId));
  }

  return getDecorMkScanJob(job.jobId);
}
