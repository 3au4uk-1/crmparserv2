import { Router } from 'express';
import multer from 'multer';
import {
  createExpenseJob,
  executeExpenseJob,
  getActiveExpenseJob,
  getExpenseJob,
} from '../services/expense-jobs.js';
import { saveBeznalUpload } from '../services/deal-expenses/beznal-storage.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post('/sync', (req, res) => {
  if (getActiveExpenseJob()) {
    return res.status(409).json({ error: 'Синхронизация расходов уже выполняется' });
  }

  const requestedTrigger = req.body?.trigger;
  const trigger =
    typeof requestedTrigger === 'string' && requestedTrigger.trim() ? requestedTrigger.trim() : 'manual';
  const job = createExpenseJob({ trigger });

  executeExpenseJob(job.jobId).catch((err) => {
    console.error(`[expense-sync] job ${job.jobId} failed:`, err.message);
  });

  res.status(201).json({ jobId: job.jobId });
});

router.get('/jobs/active', (req, res) => {
  res.json(getActiveExpenseJob() ?? null);
});

router.get('/jobs/:id', (req, res) => {
  const job = getExpenseJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'Задача не найдена' });
  res.json(job);
});

router.post('/beznal-upload', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Файл не загружен' });
  }

  const storagePath = saveBeznalUpload(req.file.buffer, req.file.originalname);
  res.status(201).json({
    filename: req.file.originalname,
    storagePath,
  });
});

export default router;
