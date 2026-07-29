import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizePattern } from '../src/services/blacklist.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = path.join(__dirname, '../data/test-ne-nashe-branding.db');

describe('ne-nashe branding matching', () => {
  let matchesNeNasheBrandingEntry;
  let findNeNasheBrandingMatch;
  let isNeNasheBrandingItem;

  beforeEach(async () => {
    ({
      matchesNeNasheBrandingEntry,
      findNeNasheBrandingMatch,
      isNeNasheBrandingItem,
    } = await import('../src/services/ne-nashe-branding.js'));
  });

  const entries = [
    { id: 1, pattern: 'колесо фортуны', matchType: 'exact' },
    { id: 2, pattern: 'не наше', matchType: 'substring' },
  ];

  it('reuses normalizePattern from blacklist', () => {
    expect(normalizePattern('  Колесо  ')).toBe('колесо');
  });

  it('exact match is case-insensitive', () => {
    expect(matchesNeNasheBrandingEntry('Колесо фортуны', entries[0])).toBe(true);
    expect(matchesNeNasheBrandingEntry('Колесо фортуны XL', entries[0])).toBe(false);
  });

  it('substring match finds fragment', () => {
    expect(matchesNeNasheBrandingEntry('Позиция не наше брендинг', entries[1])).toBe(true);
    expect(matchesNeNasheBrandingEntry('Новая стойка', entries[1])).toBe(false);
  });

  it('findNeNasheBrandingMatch returns first entry by list order', () => {
    const match = findNeNasheBrandingMatch('Колесо фортуны', entries);
    expect(match?.id).toBe(1);
  });

  it('isNeNasheBrandingItem returns boolean', () => {
    expect(isNeNasheBrandingItem('Баннер 3x6', entries)).toBe(false);
    expect(isNeNasheBrandingItem('Колесо фортуны', entries)).toBe(true);
  });
});

describe('ne-nashe branding store', () => {
  let db;
  let loadNeNasheBrandingList;
  let createNeNasheBrandingEntry;
  let deleteNeNasheBrandingEntry;

  beforeEach(async () => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    process.env.DB_PATH = TEST_DB;
    vi.resetModules();

    const { initDb, getDb } = await import('../src/db/connection.js');
    const { migrate } = await import('../src/db/migrate.js');
    ({
      loadNeNasheBrandingList,
      createNeNasheBrandingEntry,
      deleteNeNasheBrandingEntry,
    } = await import('../src/services/ne-nashe-branding.js'));

    initDb();
    migrate();
    db = getDb();
  });

  afterEach(() => {
    db?.close?.();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    delete process.env.DB_PATH;
  });

  it('migration creates empty ne_nashe_branding_items table', () => {
    const table = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ne_nashe_branding_items'"
      )
      .get();

    expect(table).toBeTruthy();
    expect(loadNeNasheBrandingList(db)).toEqual([]);
  });

  it('creates and deletes branding entries', () => {
    const item = createNeNasheBrandingEntry(db, {
      pattern: '  Брендинг  ',
      matchType: 'substring',
      sourceName: 'manual',
    });

    expect(item).toMatchObject({
      pattern: 'брендинг',
      matchType: 'substring',
      sourceName: 'manual',
    });
    expect(loadNeNasheBrandingList(db)).toHaveLength(1);

    deleteNeNasheBrandingEntry(db, item.id);
    expect(loadNeNasheBrandingList(db)).toEqual([]);
  });

  it('rejects duplicate entry with 409', () => {
    createNeNasheBrandingEntry(db, { pattern: 'тест', matchType: 'exact' });

    try {
      createNeNasheBrandingEntry(db, { pattern: 'ТЕСТ', matchType: 'exact' });
      expect.unreachable('expected duplicate error');
    } catch (err) {
      expect(err.status).toBe(409);
      expect(err.message).toBe('Ne-nashe branding entry already exists');
    }
  });

  it('rejects invalid pattern with 400', () => {
    try {
      createNeNasheBrandingEntry(db, { pattern: '   ', matchType: 'exact' });
      expect.unreachable('expected validation error');
    } catch (err) {
      expect(err.status).toBe(400);
      expect(err.message).toBe('pattern is required');
    }
  });

  it('rejects invalid matchType with 400', () => {
    try {
      createNeNasheBrandingEntry(db, { pattern: 'тест', matchType: 'regex' });
      expect.unreachable('expected validation error');
    } catch (err) {
      expect(err.status).toBe(400);
      expect(err.message).toBe('matchType must be exact or substring');
    }
  });

  it('delete returns 404 for missing entry', () => {
    try {
      deleteNeNasheBrandingEntry(db, 999);
      expect.unreachable('expected not found error');
    } catch (err) {
      expect(err.status).toBe(404);
      expect(err.message).toBe('Ne-nashe branding entry not found');
    }
  });
});
