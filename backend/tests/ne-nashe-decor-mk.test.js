import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizePattern } from '../src/services/blacklist.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = path.join(__dirname, '../data/test-ne-nashe-decor-mk.db');

describe('ne-nashe decor-mk matching', () => {
  let matchesNeNasheDecorMkEntry;
  let findNeNasheDecorMkMatch;
  let isNeNasheDecorMkItem;

  beforeEach(async () => {
    ({
      matchesNeNasheDecorMkEntry,
      findNeNasheDecorMkMatch,
      isNeNasheDecorMkItem,
    } = await import('../src/services/ne-nashe-decor-mk.js'));
  });

  const entries = [
    { id: 1, pattern: 'фотозона', matchType: 'exact' },
    { id: 2, pattern: 'не наше', matchType: 'substring' },
  ];

  it('reuses normalizePattern from blacklist', () => {
    expect(normalizePattern('  Фотозона  ')).toBe('фотозона');
  });

  it('exact match is case-insensitive', () => {
    expect(matchesNeNasheDecorMkEntry('Фотозона', entries[0])).toBe(true);
    expect(matchesNeNasheDecorMkEntry('Фотозона XL', entries[0])).toBe(false);
  });

  it('substring match finds fragment', () => {
    expect(matchesNeNasheDecorMkEntry('Декор не наше позиция', entries[1])).toBe(true);
    expect(matchesNeNasheDecorMkEntry('Новая стойка', entries[1])).toBe(false);
  });

  it('findNeNasheDecorMkMatch returns first entry by list order', () => {
    const match = findNeNasheDecorMkMatch('Фотозона', entries);
    expect(match?.id).toBe(1);
  });

  it('isNeNasheDecorMkItem returns boolean', () => {
    expect(isNeNasheDecorMkItem('Баннер 3x6', entries)).toBe(false);
    expect(isNeNasheDecorMkItem('Фотозона', entries)).toBe(true);
  });
});

describe('ne-nashe decor-mk store', () => {
  let db;
  let loadNeNasheDecorMkList;
  let createNeNasheDecorMkEntry;
  let deleteNeNasheDecorMkEntry;

  beforeEach(async () => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    process.env.DB_PATH = TEST_DB;
    vi.resetModules();

    const { initDb, getDb } = await import('../src/db/connection.js');
    const { migrate } = await import('../src/db/migrate.js');
    ({
      loadNeNasheDecorMkList,
      createNeNasheDecorMkEntry,
      deleteNeNasheDecorMkEntry,
    } = await import('../src/services/ne-nashe-decor-mk.js'));

    initDb();
    migrate();
    db = getDb();
  });

  afterEach(() => {
    db?.close?.();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    delete process.env.DB_PATH;
  });

  it('migration creates empty ne_nashe_decor_mk_items table', () => {
    const table = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ne_nashe_decor_mk_items'"
      )
      .get();

    expect(table).toBeTruthy();
    expect(loadNeNasheDecorMkList(db)).toEqual([]);
  });

  it('creates and deletes decor-mk entries', () => {
    const item = createNeNasheDecorMkEntry(db, {
      pattern: '  Декор  ',
      matchType: 'substring',
      sourceName: 'manual',
    });

    expect(item).toMatchObject({
      pattern: 'декор',
      matchType: 'substring',
      sourceName: 'manual',
    });
    expect(loadNeNasheDecorMkList(db)).toHaveLength(1);

    deleteNeNasheDecorMkEntry(db, item.id);
    expect(loadNeNasheDecorMkList(db)).toEqual([]);
  });

  it('rejects duplicate entry with 409', () => {
    createNeNasheDecorMkEntry(db, { pattern: 'тест', matchType: 'exact' });

    try {
      createNeNasheDecorMkEntry(db, { pattern: 'ТЕСТ', matchType: 'exact' });
      expect.unreachable('expected duplicate error');
    } catch (err) {
      expect(err.status).toBe(409);
      expect(err.message).toBe('Ne-nashe decor-mk entry already exists');
    }
  });

  it('rejects invalid pattern with 400', () => {
    try {
      createNeNasheDecorMkEntry(db, { pattern: '   ', matchType: 'exact' });
      expect.unreachable('expected validation error');
    } catch (err) {
      expect(err.status).toBe(400);
      expect(err.message).toBe('pattern is required');
    }
  });

  it('rejects invalid matchType with 400', () => {
    try {
      createNeNasheDecorMkEntry(db, { pattern: 'тест', matchType: 'regex' });
      expect.unreachable('expected validation error');
    } catch (err) {
      expect(err.status).toBe(400);
      expect(err.message).toBe('matchType must be exact or substring');
    }
  });

  it('delete returns 404 for missing entry', () => {
    try {
      deleteNeNasheDecorMkEntry(db, 999);
      expect.unreachable('expected not found error');
    } catch (err) {
      expect(err.status).toBe(404);
      expect(err.message).toBe('Ne-nashe decor-mk entry not found');
    }
  });
});
