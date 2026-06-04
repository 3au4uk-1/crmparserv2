import { Router } from 'express';
import { getDb } from '../db/connection.js';

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

router.put('/:key', (req, res) => {
  const { value } = req.body;
  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(req.params.key, value);
  res.json({ success: true });
});

router.get('/keywords', (req, res) => {
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = 'keywords'").get();
  res.json(JSON.parse(row?.value || '[]'));
});

router.put('/keywords', (req, res) => {
  const { keywords } = req.body;
  const db = getDb();
  db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('keywords', ?)").run(JSON.stringify(keywords));
  res.json({ success: true });
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

export default router;
