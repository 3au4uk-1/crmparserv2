import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = path.join(__dirname, '../data/test-tip-rules.db');

describe('tip_rules db', () => {
  let db;
  let createTipRule;
  let deleteTipRule;
  let loadTipRules;
  let migratePodryadBannerToTipRules;
  let seedDefaultTipRules;

  beforeEach(async () => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    process.env.DB_PATH = TEST_DB;
    vi.resetModules();

    const { initDb, getDb } = await import('../src/db/connection.js');
    const { migrate } = await import('../src/db/migrate.js');
    ({
      createTipRule,
      deleteTipRule,
      loadTipRules,
      migratePodryadBannerToTipRules,
      seedDefaultTipRules,
    } = await import('../src/services/tip-rules.js'));

    initDb();
    migrate();
    db = getDb();
  });

  afterEach(() => {
    db?.close?.();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    delete process.env.DB_PATH;
  });

  it('creates the table and seeds the default rules', () => {
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'tip_rules'").get();
    const rules = loadTipRules(db);

    expect(table).toBeTruthy();
    expect(rules.some((rule) => rule.pattern.includes('оклейк') && rule.tip === 'PLENKA')).toBe(true);
    expect(
      rules.some((rule) => rule.pattern === 'клише' && rule.tipDetail === 'KUVALDIN_KLISHE')
    ).toBe(true);
  });

  it('creates, maps, filters, and orders rules', () => {
    const later = createTipRule(db, {
      pattern: '  Второе  ',
      matchType: 'exact',
      tip: 'BANNERA',
      priority: 80,
      sourceName: 'manual',
    });
    const earlier = createTipRule(db, {
      pattern: 'Первое',
      matchType: 'substring',
      tip: 'BANNERA',
      tipDetail: 'YURA',
      priority: 10,
    });

    expect(later).toMatchObject({
      pattern: 'второе',
      matchType: 'exact',
      tip: 'BANNERA',
      tipDetail: null,
      priority: 80,
      sourceName: 'manual',
    });
    expect(later.createdAt).toEqual(expect.any(String));
    expect(loadTipRules(db, 'BANNERA').slice(0, 2).map((rule) => rule.id)).toEqual([
      earlier.id,
      later.id,
    ]);
  });

  it.each([
    [{ pattern: ' ', matchType: 'exact', tip: 'PLENKA' }, /pattern is required/],
    [{ pattern: 'x', matchType: 'prefix', tip: 'PLENKA' }, /matchType/],
    [{ pattern: 'x', matchType: 'exact', tip: 'UNKNOWN' }, /invalid tip/],
    [{ pattern: 'x', matchType: 'exact', tip: 'PLENKA', priority: 1.5 }, /priority/],
    [{ pattern: 'x', matchType: 'exact', tip: 'PLENKA', priority: Infinity }, /priority/],
    [
      { pattern: 'x', matchType: 'exact', tip: 'PLENKA', tipDetail: 'ROLL_UP' },
      /tipDetail/,
    ],
  ])('rejects invalid rule input %#', (input, message) => {
    expect(() => createTipRule(db, input)).toThrow(message);
  });

  it('rejects duplicate rules including null tip details', () => {
    const input = { pattern: 'Duplicate', matchType: 'exact', tip: 'PLENKA' };
    createTipRule(db, input);

    expect(() => createTipRule(db, input)).toThrow(/already exists/);
  });

  it('deletes an existing rule and rejects an unknown id', () => {
    const rule = createTipRule(db, {
      pattern: 'delete me',
      matchType: 'exact',
      tip: 'PLENKA',
    });

    deleteTipRule(db, rule.id);

    expect(loadTipRules(db).some((entry) => entry.id === rule.id)).toBe(false);
    expect(() => deleteTipRule(db, rule.id)).toThrow(/not found/);
  });

  it('migrates legacy podryad and banner rows idempotently', () => {
    db.prepare(
      `INSERT INTO podryad_items (pattern, match_type, source_name, created_at)
       VALUES ('legacy podryad', 'exact', 'podryad source', '2024-01-01 00:00:00')`
    ).run();
    db.prepare(
      `INSERT INTO banner_items (pattern, match_type, source_name, created_at)
       VALUES ('legacy banner', 'substring', 'banner source', '2024-01-02 00:00:00')`
    ).run();

    migratePodryadBannerToTipRules(db);
    migratePodryadBannerToTipRules(db);

    expect(loadTipRules(db, 'PODRYAD')).toContainEqual(
      expect.objectContaining({
        pattern: 'legacy podryad',
        matchType: 'exact',
        sourceName: 'podryad source',
        createdAt: '2024-01-01 00:00:00',
      })
    );
    expect(loadTipRules(db, 'BANNERA')).toContainEqual(
      expect.objectContaining({
        pattern: 'legacy banner',
        matchType: 'substring',
        sourceName: 'banner source',
        createdAt: '2024-01-02 00:00:00',
      })
    );
    expect(
      loadTipRules(db).filter((rule) => rule.pattern.startsWith('legacy '))
    ).toHaveLength(2);
  });

  it('seeds defaults idempotently', () => {
    const before = loadTipRules(db).length;

    seedDefaultTipRules(db);

    expect(loadTipRules(db)).toHaveLength(before);
  });
});
