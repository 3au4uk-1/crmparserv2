import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { runParsing } from '../services/parser.js';
import { getDefaultParseRange, normalizeParseRange } from '../utils/crm-dates.js';

const router = Router();

let parsingInProgress = false;

router.post('/run', async (req, res, next) => {
  if (parsingInProgress) {
    return res.status(409).json({ error: 'Parsing already in progress' });
  }

  try {
    parsingInProgress = true;
    const { startDate, endDate } = req.body;
    const { start, end } = normalizeParseRange(startDate, endDate);

    const result = await runParsing(start, end);
    res.json(result);
  } catch (err) {
    next(err);
  } finally {
    parsingInProgress = false;
  }
});

router.get('/status', (req, res) => {
  res.json({ inProgress: parsingInProgress });
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
