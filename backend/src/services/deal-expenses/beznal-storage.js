import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';
import { fileURLToPath } from 'url';
import { getDb } from '../../db/connection.js';

const UPLOADS_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../data/expense-uploads',
);

function extractXlsxHyperlinks(sheet) {
  const hyperlinks = new Map();
  if (!sheet?.['!ref']) return hyperlinks;

  const range = XLSX.utils.decode_range(sheet['!ref']);
  for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex++) {
    for (let colIndex = range.s.c; colIndex <= range.e.c; colIndex++) {
      const address = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
      const cell = sheet[address];
      const target = cell?.l?.Target || cell?.l?.Rel?.Target;
      if (target) {
        hyperlinks.set(`${rowIndex}:${colIndex}`, target);
      }
    }
  }
  return hyperlinks;
}

export function saveBeznalUpload(buffer, originalFilename) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  const storagePath = path.join(UPLOADS_DIR, 'beznal-latest.xlsx');
  fs.writeFileSync(storagePath, buffer);
  const db = getDb();
  db.prepare('DELETE FROM expense_beznal_uploads').run();
  db.prepare(
    'INSERT INTO expense_beznal_uploads (storage_path, original_filename) VALUES (?, ?)',
  ).run(storagePath, originalFilename || 'beznal.xlsx');
  return storagePath;
}

export function loadBeznalWorkbook() {
  const db = getDb();
  const row = db
    .prepare('SELECT storage_path FROM expense_beznal_uploads ORDER BY id DESC LIMIT 1')
    .get();
  if (!row?.storage_path || !fs.existsSync(row.storage_path)) return null;
  const wb = XLSX.readFile(row.storage_path);
  return {
    SheetNames: wb.SheetNames,
    name: 'beznal-upload',
    getSheetMeta(sheetName) {
      const sheet = wb.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      return { data, sheet, hyperlinks: extractXlsxHyperlinks(sheet) };
    },
  };
}
