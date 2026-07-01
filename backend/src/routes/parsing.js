import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { runParsing } from '../services/parser.js';
import {
  isParsingInProgress,
  tryAcquireParsingLock,
  releaseParsingLock,
} from '../services/parsing-lock.js';
import { getDefaultParseRange, normalizeManualParseRange } from '../utils/crm-dates.js';

const router = Router();

router.post('/run', async (req, res, next) => {
  if (!tryAcquireParsingLock()) {
    return res.status(409).json({ error: 'Parsing already in progress' });
  }

  try {
    const { startDate, endDate } = req.body;
    const { start, end } = normalizeManualParseRange(startDate, endDate);
    const result = await runParsing(start, end);
    res.json(result);
  } catch (err) {
    if (err.message === 'from must be <= to') {
      return res.status(400).json({ error: err.message });
    }
    next(err);
  } finally {
    releaseParsingLock();
  }
});

router.get('/status', (req, res) => {
  res.json({ inProgress: isParsingInProgress() });
});

router.get('/defaults', (req, res) => {
  res.json(getDefaultParseRange());
});

router.get('/runs', (req, res) => {
  const db = getDb();
  const runs = db.prepare('SELECT * FROM parse_runs ORDER BY started_at DESC LIMIT 50').all();
  res.json(runs);
});

export default router;
