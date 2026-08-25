import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_BANNER_PODRYAD_HOUR,
  getBannerPodryadHour,
  setBannerPodryadHour,
} from '../src/telegram/settings.js';

vi.mock('../src/db/connection.js', () => ({
  getDb: () => globalThis.__bannerHourDb,
}));

function openDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);`);
  return db;
}

describe('getBannerPodryadHour / setBannerPodryadHour', () => {
  it('defaults to 18 when unset', () => {
    expect(getBannerPodryadHour(openDb())).toBe(DEFAULT_BANNER_PODRYAD_HOUR);
    expect(DEFAULT_BANNER_PODRYAD_HOUR).toBe(18);
  });

  it('returns default for invalid stored values', () => {
    const db = openDb();
    db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)`).run(
      'telegram_banner_podryad_hour',
      'not-a-hour',
    );
    expect(getBannerPodryadHour(db)).toBe(18);

    db.prepare(`UPDATE settings SET value = ? WHERE key = ?`).run('24', 'telegram_banner_podryad_hour');
    expect(getBannerPodryadHour(db)).toBe(18);

    db.prepare(`UPDATE settings SET value = ? WHERE key = ?`).run('-1', 'telegram_banner_podryad_hour');
    expect(getBannerPodryadHour(db)).toBe(18);
  });

  it('sets 20 and reads it back', () => {
    const db = openDb();
    expect(setBannerPodryadHour(db, 20)).toBe(20);
    expect(getBannerPodryadHour(db)).toBe(20);
  });

  it('rejects hour outside 0–23 with status 400', () => {
    const db = openDb();
    try {
      setBannerPodryadHour(db, 24);
      expect.unreachable();
    } catch (err) {
      expect(err.status).toBe(400);
      expect(err.message).toMatch(/0–23/);
    }
  });
});

describe('GET/PUT /telegram/settings bannerPodryadHour', () => {
  let app;

  beforeEach(async () => {
    vi.resetModules();
    globalThis.__bannerHourDb = openDb();
    const router = (await import('../src/routes/telegram.js')).default;
    app = express();
    app.use(express.json());
    app.use('/telegram', router);
  });

  it('GET includes default bannerPodryadHour 18', async () => {
    const res = await request(app).get('/telegram/settings');
    expect(res.status).toBe(200);
    expect(res.body.bannerPodryadHour).toBe(18);
  });

  it('PUT accepts bannerPodryadHour and GET returns it', async () => {
    const put = await request(app).put('/telegram/settings').send({ bannerPodryadHour: 20 });
    expect(put.status).toBe(200);
    const get = await request(app).get('/telegram/settings');
    expect(get.body.bannerPodryadHour).toBe(20);
  });
});
