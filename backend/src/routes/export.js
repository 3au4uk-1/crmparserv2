import { Router } from 'express';
import {
  createExportJob,
  getExportJob,
  getActiveExportJob,
  getExportJobFilePath,
  deleteExportJobFile,
} from '../services/export-jobs.js';
import { runHistoricalExport } from '../services/historical-export.js';
import {
  isParsingInProgress,
  tryAcquireParsingLock,
  releaseParsingLock,
} from '../services/parsing-lock.js';
import { normalizeExportRange } from '../utils/crm-dates.js';

const router = Router();

router.post('/', (req, res) => {
  if (isParsingInProgress() || getActiveExportJob()) {
    return res.status(409).json({ error: 'Парсинг или выгрузка уже выполняется' });
  }
  if (!tryAcquireParsingLock()) {
    return res.status(409).json({ error: 'Парсинг или выгрузка уже выполняется' });
  }

  const { from, to, company } = req.body ?? {};
  try {
    normalizeExportRange(from, to);
  } catch (err) {
    releaseParsingLock();
    return res.status(400).json({ error: err.message });
  }

  const job = createExportJob({ from, to, company: company || null });
  runHistoricalExport(job.jobId, { from, to, company: company || null }).catch((err) => {
    console.error(`[export] job ${job.jobId} failed:`, err.message);
  });

  res.status(201).json({ jobId: job.jobId });
});

router.get('/active', (req, res) => {
  const job = getActiveExportJob();
  res.json(job ?? null);
});

router.get('/:jobId', (req, res) => {
  const job = getExportJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Задача не найдена' });
  res.json(job);
});

router.get('/:jobId/file', (req, res) => {
  const job = getExportJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Задача не найдена' });
  if (job.status !== 'completed') {
    return res.status(404).json({ error: 'Файл ещё не готов' });
  }
  const filePath = getExportJobFilePath(job.jobId);
  if (!filePath) return res.status(410).json({ error: 'Файл удалён' });

  const filename = `сделки_${job.from}_${job.to}.xlsx`;
  res.download(filePath, filename, (err) => {
    if (!err) deleteExportJobFile(job.jobId);
  });
});

export default router;
