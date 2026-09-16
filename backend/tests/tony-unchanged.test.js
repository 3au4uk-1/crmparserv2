import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { shouldSkipTonyFullFetch, loadTonyUpdatedAtMap } from '../src/services/tony-unchanged.js';

const base = {
  probeEnabled: true,
  probe: { ok: true, updatedAt: '2026-09-15 12:39:09', deleted: false, notFound: false },
  existingStamp: '2026-09-15 12:39:09',
  dataSource: 'tony',
};

describe('shouldSkipTonyFullFetch', () => {
  it('skips when stamp matches a tony deal', () => {
    expect(shouldSkipTonyFullFetch(base)).toBe(true);
  });

  it('does not skip a new booking (no stamp)', () => {
    expect(shouldSkipTonyFullFetch({ ...base, existingStamp: null })).toBe(false);
  });

  it('does not skip calendar-sourced deals', () => {
    expect(shouldSkipTonyFullFetch({ ...base, dataSource: 'calendar' })).toBe(false);
  });

  it('does not skip when flag is off', () => {
    expect(shouldSkipTonyFullFetch({ ...base, probeEnabled: false })).toBe(false);
  });

  it('does not skip notfound/deleted/failed probes', () => {
    expect(shouldSkipTonyFullFetch({ ...base, probe: { ...base.probe, notFound: true } })).toBe(false);
    expect(shouldSkipTonyFullFetch({ ...base, probe: { ...base.probe, deleted: true } })).toBe(false);
    expect(shouldSkipTonyFullFetch({ ...base, probe: { ok: false, notFound: false, deleted: false } })).toBe(false);
  });
});

describe('loadTonyUpdatedAtMap', () => {
  it('maps tony_order_id to stamp for tony deals', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE deals (
        id INTEGER PRIMARY KEY,
        data_source TEXT,
        tony_order_id TEXT,
        tony_updated_at TEXT
      );
    `);
    db.prepare("INSERT INTO deals (data_source, tony_order_id, tony_updated_at) VALUES ('tony', '158490', '2026-09-15 12:39:09')").run();
    db.prepare("INSERT INTO deals (data_source, tony_order_id, tony_updated_at) VALUES ('calendar', '111', '2026-01-01 00:00:00')").run();
    const map = loadTonyUpdatedAtMap(db);
    expect(map.get('158490')).toEqual({ stamp: '2026-09-15 12:39:09', dataSource: 'tony' });
    expect(map.has('111')).toBe(false);
    db.close();
  });
});
