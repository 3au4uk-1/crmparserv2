import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import XLSX from 'xlsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = path.join(__dirname, '../data/test-beznal-storage.db');
const UPLOAD_FILE = path.join(__dirname, '../data/expense-uploads/beznal-latest.xlsx');

function createMinimalXlsxBuffer() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet([['A', 'B'], ['1', '2']]),
    'TestSheet',
  );
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['x']]), 'Second');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

describe('beznal-storage', () => {
  beforeEach(() => {
    vi.resetModules();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    if (fs.existsSync(UPLOAD_FILE)) fs.unlinkSync(UPLOAD_FILE);
    process.env.DB_PATH = TEST_DB;
  });

  afterEach(async () => {
    try {
      const { getDb } = await import('../../src/db/connection.js');
      getDb().close();
    } catch {
      /* db not initialized */
    }
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    if (fs.existsSync(UPLOAD_FILE)) fs.unlinkSync(UPLOAD_FILE);
    delete process.env.DB_PATH;
    vi.resetModules();
  });

  it('saves xlsx upload and loads workbook with sheet names', async () => {
    const { initDb } = await import('../../src/db/connection.js');
    const { migrate } = await import('../../src/db/migrate.js');
    const { saveBeznalUpload, loadBeznalWorkbook } = await import(
      '../../src/services/deal-expenses/beznal-storage.js'
    );

    initDb();
    migrate();

    const buffer = createMinimalXlsxBuffer();
    saveBeznalUpload(buffer, 'test-beznal.xlsx');

    const workbook = loadBeznalWorkbook();
    expect(workbook).not.toBeNull();
    expect(workbook.SheetNames).toEqual(['TestSheet', 'Second']);
    expect(workbook.name).toBe('beznal-upload');

    const meta = workbook.getSheetMeta('TestSheet');
    expect(meta.data).toEqual([
      ['A', 'B'],
      ['1', '2'],
    ]);
    expect(meta.hyperlinks).toBeInstanceOf(Map);
  });
});
