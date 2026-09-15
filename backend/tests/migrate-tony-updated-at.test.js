import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { migrate } from '../src/db/migrate.js';

describe('tony_updated_at migration', () => {
  it('adds tony_updated_at on migrate', () => {
    const db = new Database(':memory:');
    migrate(db);
    const cols = db.prepare('PRAGMA table_info(deals)').all().map((c) => c.name);
    expect(cols).toContain('tony_updated_at');
    db.close();
  });
});
