import { describe, expect, it, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  normalizeUsername,
  upsertAutoInviteMember,
  listAutoInviteMembers,
  tryBeginAutoInviteRun,
  finishAutoInviteRun,
  resetAutoInviteRun,
} from '../src/telegram/auto-invite-store.js';

function memDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE telegram_auto_invite_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT,
      user_id TEXT,
      display_name TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE telegram_auto_invite_runs (
      chat_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT,
      detail_json TEXT
    );
  `);
  return db;
}

describe('normalizeUsername', () => {
  it('strips @ and trims', () => {
    expect(normalizeUsername('@Foo_Bar')).toBe('Foo_Bar');
    expect(normalizeUsername('  x  ')).toBe('x');
    expect(normalizeUsername('')).toBeNull();
  });
});

describe('members', () => {
  let db;
  beforeEach(() => { db = memDb(); });

  it('rejects empty username and userId', () => {
    expect(() => upsertAutoInviteMember(db, {})).toThrow(/username|user/i);
  });

  it('inserts and lists active members', () => {
    upsertAutoInviteMember(db, { username: '@Alice', displayName: 'A' });
    upsertAutoInviteMember(db, { userId: '42', active: false });
    expect(listAutoInviteMembers(db, { activeOnly: true })).toHaveLength(1);
    expect(listAutoInviteMembers(db, { activeOnly: false })).toHaveLength(2);
  });
});

describe('runs idempotency', () => {
  let db;
  beforeEach(() => { db = memDb(); });

  it('allows first begin, blocks success/partial, allows after reset', () => {
    expect(tryBeginAutoInviteRun(db, '-1001').started).toBe(true);
    finishAutoInviteRun(db, '-1001', { status: 'success', detail: { ok: true } });
    expect(tryBeginAutoInviteRun(db, '-1001').started).toBe(false);
    resetAutoInviteRun(db, '-1001');
    expect(tryBeginAutoInviteRun(db, '-1001').started).toBe(true);
  });

  it('retries failed runs', () => {
    tryBeginAutoInviteRun(db, '-1002');
    finishAutoInviteRun(db, '-1002', { status: 'failed', detail: { error: 'x' } });
    expect(tryBeginAutoInviteRun(db, '-1002').started).toBe(true);
  });
});
