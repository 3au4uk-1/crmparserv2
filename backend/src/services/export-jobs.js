import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const EXPORTS_DIR = path.join(__dirname, '../../data/exports');

const jobs = new Map();

export function resetExportJobsForTests() {
  jobs.clear();
}

function ensureExportsDir() {
  fs.mkdirSync(EXPORTS_DIR, { recursive: true });
}

export function createExportJob({ from, to, company = null }) {
  const jobId = crypto.randomUUID();
  const job = {
    jobId,
    status: 'queued',
    from,
    to,
    company,
    progress: { eventsTotal: 0, eventsDone: 0, dealsMatched: 0 },
    error: null,
    filePath: null,
    createdAt: new Date().toISOString(),
    completedAt: null,
  };
  jobs.set(jobId, job);
  return job;
}

export function getExportJob(jobId) {
  return jobs.get(jobId) ?? null;
}

export function getActiveExportJob() {
  for (const job of jobs.values()) {
    if (job.status === 'queued' || job.status === 'running') return job;
  }
  return null;
}

export function updateExportJob(jobId, patch) {
  const job = jobs.get(jobId);
  if (!job) return null;
  Object.assign(job, patch);
  if (patch.progress) job.progress = { ...job.progress, ...patch.progress };
  return job;
}

export function setExportJobFile(jobId, buffer) {
  ensureExportsDir();
  const filePath = path.join(EXPORTS_DIR, `${jobId}.xlsx`);
  fs.writeFileSync(filePath, buffer);
  updateExportJob(jobId, { filePath });
  return filePath;
}

export function getExportJobFilePath(jobId) {
  const job = getExportJob(jobId);
  if (!job?.filePath || !fs.existsSync(job.filePath)) return null;
  return job.filePath;
}

export function deleteExportJobFile(jobId) {
  const job = getExportJob(jobId);
  if (job?.filePath && fs.existsSync(job.filePath)) {
    fs.unlinkSync(job.filePath);
    job.filePath = null;
  }
}
