import { Router } from 'express';
import {
  createExportJob,
  getExportJob,
  getActiveExportJob,
  getExportJobFilePath,
  deleteExportJobFile,
} from '../services/export-jobs.js';
import { runTwentyExport } from '../services/twenty-export.js';
import { normalizeExportRange } from '../utils/crm-dates.js';
import { getTwentyConfig } from '../services/twenty-config.js';

const router = Router();

router.post('/', (req, res) => {
  const { from, to, includeCancelled = false } = req.body ?? {};
  try {
    normalizeExportRange(from, to);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  if (getActiveExportJob('twenty')) {
    return res.status(409).json({ error: 'Выгрузка Twenty уже выполняется' });
  }

  const twenty = getTwentyConfig();
  if (!twenty.apiUrl || !twenty.apiToken) {
    return res.status(503).json({ error: 'Twenty CRM не настроен' });
  }

  const job = createExportJob({
    from,
    to,
    includeCancelled: Boolean(includeCancelled),
    kind: 'twenty',
  });
  runTwentyExport(job.jobId, {
    from,
    to,
    includeCancelled: Boolean(includeCancelled),
  }).catch((err) => {
    console.error(`[export-twenty] job ${job.jobId} failed:`, err.message);
  });

  res.status(201).json({ jobId: job.jobId });
});

router.get('/active', (req, res) => {
  res.json(getActiveExportJob('twenty') ?? null);
});

router.get('/:jobId', (req, res) => {
  const job = getExportJob(req.params.jobId);
  if (!job || job.kind !== 'twenty') {
    return res.status(404).json({ error: 'Задача не найдена' });
  }
  res.json(job);
});

router.get('/:jobId/file', (req, res) => {
  const job = getExportJob(req.params.jobId);
  if (!job || job.kind !== 'twenty') {
    return res.status(404).json({ error: 'Задача не найдена' });
  }
  if (job.status !== 'completed') {
    return res.status(404).json({ error: 'Файл ещё не готов' });
  }
  const filePath = getExportJobFilePath(job.jobId);
  if (!filePath) return res.status(410).json({ error: 'Файл удалён' });

  const filename = `twenty_заказы_${job.from}_${job.to}.xlsx`;
  res.download(filePath, filename, (err) => {
    if (!err) deleteExportJobFile(job.jobId);
  });
});

export default router;
