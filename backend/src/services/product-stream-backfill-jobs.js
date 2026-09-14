import { getDb } from '../db/connection.js';
import { runDealSyncPool } from './deal-sync-pool.js';
import { requireTwentyConfig } from './twenty-config.js';
import { gql, assertHttpSuccess, assertGqlSuccess } from './twenty-gql.js';
import {
  listLineItemsForOpportunity,
  updateDealLineItemProductStreams,
} from './twenty-line-items-sync.js';
import { planProductStreamBackfill } from './product-stream-backfill.js';
import { loadProductStreamContext } from './twenty-items.js';

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

function mapProductStreamBackfillRunRow(row) {
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
    `UPDATE product_stream_backfill_runs
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

function markJobFailed(db, job, error) {
  const finishedAt = new Date().toISOString();
  updateJob(job.jobId, { status: 'failed', finishedAt, error });
  db.prepare(
    `UPDATE product_stream_backfill_runs
     SET status = ?, finished_at = ?, error = ?
     WHERE id = ?`,
  ).run('failed', finishedAt, error, Number(job.jobId));
}

export function resetProductStreamBackfillJobsForTests() {
  jobs.clear();
}

export function countProductStreamBackfillDeals() {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM deals
       WHERE twenty_id IS NOT NULL AND TRIM(twenty_id) != ''
         AND (approval_status IS NULL OR approval_status != 'rejected')`,
    )
    .get();
  return row?.count ?? 0;
}

export function listProductStreamBackfillDealIds() {
  const db = getDb();
  return db
    .prepare(
      `SELECT id
       FROM deals
       WHERE twenty_id IS NOT NULL AND TRIM(twenty_id) != ''
         AND (approval_status IS NULL OR approval_status != 'rejected')
       ORDER BY id ASC`,
    )
    .all()
    .map((row) => row.id);
}

export function createProductStreamBackfillJob({ trigger = 'manual' } = {}) {
  const db = getDb();
  const result = db
    .prepare('INSERT INTO product_stream_backfill_runs (status, trigger) VALUES (?, ?)')
    .run('queued', trigger);

  const row = db
    .prepare('SELECT * FROM product_stream_backfill_runs WHERE id = ?')
    .get(Number(result.lastInsertRowid));

  return storeJob(mapProductStreamBackfillRunRow(row));
}

export function getProductStreamBackfillJob(jobId) {
  const normalizedJobId = String(jobId);
  if (jobs.has(normalizedJobId)) {
    return jobs.get(normalizedJobId);
  }

  const db = getDb();
  const row = db
    .prepare('SELECT * FROM product_stream_backfill_runs WHERE id = ?')
    .get(Number(normalizedJobId));
  if (!row) return null;

  return storeJob(mapProductStreamBackfillRunRow(row));
}

export function getActiveProductStreamBackfillJob() {
  for (const job of jobs.values()) {
    if (ACTIVE_STATUSES.has(job.status)) {
      return job;
    }
  }

  const db = getDb();
  const row = db
    .prepare(
      `SELECT *
       FROM product_stream_backfill_runs
       WHERE status IN ('queued', 'running')
       ORDER BY id DESC
       LIMIT 1`,
    )
    .get();

  if (!row) return null;
  return storeJob(mapProductStreamBackfillRunRow(row));
}

export async function executeProductStreamBackfillJob(jobId) {
  const job = getProductStreamBackfillJob(jobId);
  if (!job) return null;

  const db = getDb();
  const startedAt = new Date().toISOString();
  const dealIds = listProductStreamBackfillDealIds();

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
    `UPDATE product_stream_backfill_runs
     SET status = ?, started_at = ?, finished_at = NULL, error = NULL, deals_total = ?
     WHERE id = ?`,
  ).run('running', startedAt, dealIds.length, Number(job.jobId));

  let twenty;
  try {
    twenty = requireTwentyConfig();
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    markJobFailed(db, job, error);
    return getProductStreamBackfillJob(job.jobId);
  }

  const streamContext = loadProductStreamContext(db);

  try {
    await runDealSyncPool(dealIds, async (dealId) => {
      const deal = db.prepare('SELECT id, twenty_id FROM deals WHERE id = ?').get(dealId);
      if (!deal?.twenty_id) {
        throw new Error('Deal has no twenty_id');
      }

      const parserItems = db
        .prepare('SELECT * FROM deal_items WHERE deal_id = ?')
        .all(dealId);

      const twentyLineItems = await listLineItemsForOpportunity(
        gql,
        twenty.apiUrl,
        twenty.apiToken,
        deal.twenty_id,
        assertHttpSuccess,
        assertGqlSuccess,
      );

      const { toUpdate } = planProductStreamBackfill({
        parserItems,
        twentyLineItems,
        streamContext,
      });

      for (const update of toUpdate) {
        await updateDealLineItemProductStreams(
          gql,
          twenty.apiUrl,
          twenty.apiToken,
          update.twentyId,
          update.productStreams,
          assertHttpSuccess,
          assertGqlSuccess,
        );
      }

      return { toUpdate };
    }, {
      onDealSettled: ({ dealId, ok, result, error }) => {
        job.dealsDone += 1;
        if (ok && result?.toUpdate?.length > 0) {
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
      `UPDATE product_stream_backfill_runs
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
    const error = err instanceof Error ? err.message : String(err);
    markJobFailed(db, job, error);
  }

  return getProductStreamBackfillJob(job.jobId);
}
