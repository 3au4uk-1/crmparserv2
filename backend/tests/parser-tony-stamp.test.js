import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { persistTonyUpdatedAt } from '../src/services/tony-unchanged.js';

describe('persistTonyUpdatedAt', () => {
  it('writes stamp onto the deal', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE deals (id INTEGER PRIMARY KEY, tony_updated_at TEXT);`);
    db.prepare('INSERT INTO deals (id) VALUES (1)').run();
    persistTonyUpdatedAt(db, 1, '2026-09-15 12:39:09');
    expect(db.prepare('SELECT tony_updated_at FROM deals WHERE id = 1').get().tony_updated_at)
      .toBe('2026-09-15 12:39:09');
    db.close();
  });
});
