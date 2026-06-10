import { Router } from 'express';
import cron from 'node-cron';
import { getDb } from '../db/connection.js';
import { restartScheduler } from '../services/scheduler.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const row of rows) {
    settings[row.key] = row.value;
  }
  res.json(settings);
});

router.get('/keywords', (req, res) => {
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = 'keywords'").get();
  res.json(JSON.parse(row?.value || '[]'));
});

router.put('/keywords', (req, res) => {
  const { keywords } = req.body;
  if (!Array.isArray(keywords)) {
    return res.status(400).json({ error: 'keywords array required' });
  }
  const db = getDb();
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('keywords', ?)").run(
    JSON.stringify(keywords)
  );
  res.json({ success: true, count: keywords.length });
});

router.get('/companies', (req, res) => {
  const db = getDb();
  const companies = db.prepare('SELECT * FROM companies ORDER BY code').all();
  res.json(companies);
});

router.put('/companies/:id', (req, res) => {
  const { code, full_name } = req.body;
  const db = getDb();
  db.prepare('UPDATE companies SET code = ?, full_name = ? WHERE id = ?').run(code, full_name, req.params.id);
  res.json({ success: true });
});

router.post('/companies', (req, res) => {
  const { code, full_name } = req.body;
  const db = getDb();
  const result = db.prepare('INSERT INTO companies (code, full_name) VALUES (?, ?)').run(code, full_name);
  res.json({ id: result.lastInsertRowid });
});

router.post('/clear-parsing-data', (req, res) => {
  const db = getDb();

  const clear = db.transaction(() => {
    const syncRuns = db.prepare('DELETE FROM sync_runs').run().changes;
    const dealItems = db.prepare('DELETE FROM deal_items').run().changes;
    const deals = db.prepare('DELETE FROM deals').run().changes;
    const parseRuns = db.prepare('DELETE FROM parse_runs').run().changes;
    return { syncRuns, dealItems, deals, parseRuns };
  });

  res.json({ success: true, deleted: clear() });
});

/** Generic setting update — must be after specific /keywords, /companies/* routes */
router.put('/:key', (req, res) => {
  const reserved = new Set(['keywords', 'companies']);
  if (reserved.has(req.params.key)) {
    return res.status(400).json({ error: 'Use dedicated endpoint for this setting' });
  }

  const value = String(req.body?.value ?? '').trim();
  if (req.params.key === 'parse_schedule') {
    if (!value) {
      return res.status(400).json({ error: 'Cron-выражение не может быть пустым' });
    }
    if (!cron.validate(value)) {
      return res.status(400).json({ error: 'Некорректное cron-выражение' });
    }
  }

  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(req.params.key, value);
  if (req.params.key === 'parse_schedule') {
    restartScheduler();
  }
  res.json({ success: true });
});

export default router;
