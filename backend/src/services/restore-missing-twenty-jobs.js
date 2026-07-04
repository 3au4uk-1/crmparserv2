import { getDb } from '../db/connection.js';
import { findTwentyOpportunityIdByBooking, opportunityExistsInTwenty } from './twenty-lookup.js';
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

function mapJobRow(row) {
  if (!row) return null;
  return {
    jobId: String(row.id),
    status: row.status,
    trigger: row.trigger,
    startedAt: row.started_at ?? null,
    finishedAt: row.finished_at ?? null,
    dealsTotal: row.deals_total ?? 0,
    dealsDone: row.deals_done ?? 0,
    dealsRestored: row.deals_restored ?? 0,
    dealsSkipped: row.deals_skipped ?? 0,
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
    `UPDATE restore_missing_twenty_runs
     SET deals_total = ?,
         deals_done = ?,
         deals_restored = ?,
         deals_skipped = ?,
         deals_failed = ?,
         errors_json = ?
     WHERE id = ?`,
  ).run(
    job.dealsTotal,
    job.dealsDone,
    job.dealsRestored,
    job.dealsSkipped,
    job.dealsFailed,
    JSON.stringify(job.errors),
    Number(jobId),
  );
}

export function resetRestoreMissingTwentyJobsForTests() {
  jobs.clear();
}

export function listSyncedDealsForRestore() {
  const db = getDb();
  return db
    .prepare(
      `SELECT id, twenty_id, tony_order_id, title
       FROM deals
       WHERE twenty_id IS NOT NULL AND TRIM(twenty_id) != ''
       ORDER BY id ASC`,
    )
    .all();
}

export function countSyncedDealsForRestore() {
  return listSyncedDealsForRestore().length;
}

function clearDealTwentyLink(db, dealId) {
  db.prepare(`
    UPDATE deals SET
      twenty_id = NULL,
      twenty_stage = NULL,
      twenty_error = NULL,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(dealId);
  db.prepare('UPDATE deal_items SET twenty_id = NULL WHERE deal_id = ?').run(dealId);
}

export function createRestoreMissingTwentyJob({ trigger = 'manual' } = {}) {
  const db = getDb();
  const result = db
    .prepare('INSERT INTO restore_missing_twenty_runs (status, trigger) VALUES (?, ?)')
    .run('queued', trigger);

  const row = db
    .prepare('SELECT * FROM restore_missing_twenty_runs WHERE id = ?')
    .get(Number(result.lastInsertRowid));

  return storeJob(mapJobRow(row));
}

export function getRestoreMissingTwentyJob(jobId) {
  const normalizedJobId = String(jobId);
  if (jobs.has(normalizedJobId)) {
    return jobs.get(normalizedJobId);
  }

  const db = getDb();
  const row = db
    .prepare('SELECT * FROM restore_missing_twenty_runs WHERE id = ?')
    .get(Number(normalizedJobId));
  if (!row) return null;

  return storeJob(mapJobRow(row));
}

export function getActiveRestoreMissingTwentyJob() {
  for (const job of jobs.values()) {
    if (ACTIVE_STATUSES.has(job.status)) {
      return job;
    }
  }

  const db = getDb();
  const row = db
    .prepare(
      `SELECT *
       FROM restore_missing_twenty_runs
       WHERE status IN ('queued', 'running')
       ORDER BY id DESC
       LIMIT 1`,
    )
    .get();

  if (!row) return null;
  return storeJob(mapJobRow(row));
}

export async function restoreMissingDealInTwenty(dealId) {
  const db = getDb();
  const deal = db.prepare('SELECT id, twenty_id, tony_order_id FROM deals WHERE id = ?').get(dealId);
  if (!deal?.twenty_id) {
    return { action: 'skipped', reason: 'no_twenty_id' };
  }

  const exists = await opportunityExistsInTwenty(deal.twenty_id);
  if (exists) {
    return { action: 'skipped', reason: 'exists_in_twenty' };
  }

  const bookingNumber = deal.tony_order_id ? String(deal.tony_order_id).trim() : '';
  if (bookingNumber) {
    const adoptedId = await findTwentyOpportunityIdByBooking(bookingNumber);
    if (adoptedId && adoptedId !== deal.twenty_id) {
      db.prepare(`
        UPDATE deals SET
          twenty_id = ?,
          twenty_error = NULL,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(adoptedId, dealId);
      db.prepare('UPDATE deal_items SET twenty_id = NULL WHERE deal_id = ?').run(dealId);
      const result = await syncDealToTwenty(dealId);
      return { action: 'adopted', twentyId: result.twentyId ?? adoptedId };
    }
  }

  clearDealTwentyLink(db, dealId);
  const result = await syncDealToTwenty(dealId);
  return { action: 'created', twentyId: result.twentyId };
}

export async function executeRestoreMissingTwentyJob(jobId) {
  const job = getRestoreMissingTwentyJob(jobId);
  if (!job) return null;

  const db = getDb();
  const startedAt = new Date().toISOString();
  const deals = listSyncedDealsForRestore();

  updateJob(job.jobId, {
    status: 'running',
    startedAt,
    finishedAt: null,
    error: null,
    dealsTotal: deals.length,
    dealsDone: 0,
    dealsRestored: 0,
    dealsSkipped: 0,
    dealsFailed: 0,
    errors: [],
  });

  db.prepare(
    `UPDATE restore_missing_twenty_runs
     SET status = ?, started_at = ?, finished_at = NULL, error = NULL, deals_total = ?
     WHERE id = ?`,
  ).run('running', startedAt, deals.length, Number(job.jobId));

  let anyRestored = false;

  try {
    for (let i = 0; i < deals.length; i++) {
      if (i > 0) await delay(DELAY_MS);
      const deal = deals[i];

      try {
        const result = await restoreMissingDealInTwenty(deal.id);
        if (result.action === 'skipped') {
          job.dealsSkipped += 1;
        } else {
          job.dealsRestored += 1;
          anyRestored = true;
        }
      } catch (err) {
        job.dealsFailed += 1;
        if (job.errors.length < MAX_ERRORS) {
          job.errors.push({
            dealId: deal.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        console.error(`[restore-missing-twenty] deal ${deal.id} failed:`, err.message);
      }

      job.dealsDone += 1;
      persistJobProgress(db, job.jobId, job);
    }

    if (anyRestored) {
      try {
        await runPrintSheetRefresh();
      } catch (err) {
        console.warn('[restore-missing-twenty] print sheet refresh failed:', err.message);
      }
    }

    const finishedAt = new Date().toISOString();
    const status = job.dealsFailed > 0 ? 'completed_with_errors' : 'completed';

    updateJob(job.jobId, { status, finishedAt });
    db.prepare(
      `UPDATE restore_missing_twenty_runs
       SET status = ?, finished_at = ?, deals_done = ?, deals_restored = ?, deals_skipped = ?, deals_failed = ?, errors_json = ?
       WHERE id = ?`,
    ).run(
      status,
      finishedAt,
      job.dealsDone,
      job.dealsRestored,
      job.dealsSkipped,
      job.dealsFailed,
      JSON.stringify(job.errors),
      Number(job.jobId),
    );
  } catch (err) {
    const finishedAt = new Date().toISOString();
    const error = err instanceof Error ? err.message : String(err);

    updateJob(job.jobId, { status: 'failed', finishedAt, error });
    db.prepare(
      `UPDATE restore_missing_twenty_runs
       SET status = ?, finished_at = ?, error = ?
       WHERE id = ?`,
    ).run('failed', finishedAt, error, Number(job.jobId));
  }

  return getRestoreMissingTwentyJob(job.jobId);
}
