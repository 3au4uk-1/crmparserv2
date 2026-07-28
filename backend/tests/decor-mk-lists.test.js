import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_DB = path.join(__dirname, '../data/test-decor-mk-lists.db');

const scheduleListChangeResyncMock = vi.fn();

vi.mock('../src/services/list-change-resync.js', () => ({
  scheduleListChangeResync: (...args) => scheduleListChangeResyncMock(...args),
}));

describe('decor/mk list stores', () => {
  let db;
  let loadDecorBlacklist;
  let createDecorBlacklistEntry;
  let deleteDecorBlacklistEntry;
  let loadMkBlacklist;
  let createMkBlacklistEntry;
  let deleteMkBlacklistEntry;

  beforeEach(async () => {
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    process.env.DB_PATH = TEST_DB;
    vi.resetModules();
    scheduleListChangeResyncMock.mockReset();

    const { initDb, getDb } = await import('../src/db/connection.js');
    const { migrate } = await import('../src/db/migrate.js');
    ({
      loadDecorBlacklist,
      createDecorBlacklistEntry,
      deleteDecorBlacklistEntry,
    } = await import('../src/services/decor-blacklist.js'));
    ({
      loadMkBlacklist,
      createMkBlacklistEntry,
      deleteMkBlacklistEntry,
    } = await import('../src/services/mk-blacklist.js'));

    initDb();
    migrate();
    db = getDb();
  });

  afterEach(() => {
    db?.close?.();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
    delete process.env.DB_PATH;
  });

  it('migration creates empty blacklist tables and default keyword settings', () => {
    const decorTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'decor_blacklist_items'")
      .get();
    const mkTable = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'mk_blacklist_items'")
      .get();
    const decorKeywords = db.prepare("SELECT value FROM settings WHERE key = 'decor_keywords'").get();
    const mkKeywords = db.prepare("SELECT value FROM settings WHERE key = 'mk_keywords'").get();

    expect(decorTable).toBeTruthy();
    expect(mkTable).toBeTruthy();
    expect(JSON.parse(decorKeywords.value)).toEqual([]);
    expect(JSON.parse(mkKeywords.value)).toEqual([]);
    expect(loadDecorBlacklist(db)).toEqual([]);
    expect(loadMkBlacklist(db)).toEqual([]);
  });

  it('creates and deletes decor blacklist entries', () => {
    const item = createDecorBlacklistEntry(db, {
      pattern: '  Гирлянда  ',
      matchType: 'substring',
      sourceName: 'manual',
    });

    expect(item).toMatchObject({
      pattern: 'гирлянда',
      matchType: 'substring',
      sourceName: 'manual',
    });
    expect(loadDecorBlacklist(db)).toHaveLength(1);

    deleteDecorBlacklistEntry(db, item.id);
    expect(loadDecorBlacklist(db)).toEqual([]);
  });

  it('creates and deletes mk blacklist entries', () => {
    const item = createMkBlacklistEntry(db, {
      pattern: 'Фотозона',
      matchType: 'exact',
    });

    expect(item).toMatchObject({
      pattern: 'фотозона',
      matchType: 'exact',
    });
    expect(loadMkBlacklist(db)).toHaveLength(1);

    deleteMkBlacklistEntry(db, item.id);
    expect(loadMkBlacklist(db)).toEqual([]);
  });
});

describe('decor/mk list routes', () => {
  let decorBlacklistRouter;
  let mkBlacklistRouter;
  let settingsRouter;

  beforeEach(async () => {
    process.env.DB_PATH = ':memory:';
    vi.resetModules();
    scheduleListChangeResyncMock.mockReset();

    const { initDb } = await import('../src/db/connection.js');
    const { migrate } = await import('../src/db/migrate.js');
    decorBlacklistRouter = (await import('../src/routes/decor-blacklist.js')).default;
    mkBlacklistRouter = (await import('../src/routes/mk-blacklist.js')).default;
    settingsRouter = (await import('../src/routes/settings.js')).default;

    initDb();
    migrate();
  });

  afterEach(() => {
    delete process.env.DB_PATH;
  });

  function createApp() {
    const app = express();
    app.use(express.json());
    app.use('/api/decor-blacklist', decorBlacklistRouter);
    app.use('/api/mk-blacklist', mkBlacklistRouter);
    app.use('/api/settings', settingsRouter);
    return app;
  }

  it('GET /api/decor-blacklist returns empty items by default', async () => {
    const res = await request(createApp()).get('/api/decor-blacklist');
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
  });

  it('POST /api/mk-blacklist creates entry and schedules resync', async () => {
    const res = await request(createApp())
      .post('/api/mk-blacklist')
      .send({ pattern: 'колонна', matchType: 'exact' });

    expect(res.status).toBe(201);
    expect(res.body.item).toMatchObject({
      pattern: 'колонна',
      matchType: 'exact',
    });
    expect(scheduleListChangeResyncMock).toHaveBeenCalledOnce();
  });

  it('GET/PUT /api/settings/decor-keywords round-trips keyword arrays', async () => {
    const app = createApp();

    const empty = await request(app).get('/api/settings/decor-keywords');
    expect(empty.status).toBe(200);
    expect(empty.body).toEqual([]);

    const put = await request(app)
      .put('/api/settings/decor-keywords')
      .send({ keywords: ['декор', 'гирлянда'] });
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ success: true, count: 2 });

    const loaded = await request(app).get('/api/settings/decor-keywords');
    expect(loaded.body).toEqual(['декор', 'гирлянда']);
  });

  it('GET/PUT /api/settings/mk-keywords round-trips keyword arrays', async () => {
    const app = createApp();

    const put = await request(app)
      .put('/api/settings/mk-keywords')
      .send({ keywords: ['мк', 'фотозона'] });
    expect(put.status).toBe(200);

    const loaded = await request(app).get('/api/settings/mk-keywords');
    expect(loaded.body).toEqual(['мк', 'фотозона']);
  });
});
