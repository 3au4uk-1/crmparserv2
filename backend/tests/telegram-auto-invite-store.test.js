import { describe, expect, it, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  normalizeUsername,
  upsertAutoInviteMember,
  listAutoInviteMembers,
  updateAutoInviteMember,
  deleteAutoInviteMember,
  getAutoInviteRun,
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

  it('upserts by username without duplicating rows', () => {
    const first = upsertAutoInviteMember(db, { username: '@Alice', displayName: 'A' });
    const second = upsertAutoInviteMember(db, { username: 'Alice', displayName: 'Updated' });
    expect(second.id).toBe(first.id);
    expect(second.displayName).toBe('Updated');
    expect(listAutoInviteMembers(db, { activeOnly: false })).toHaveLength(1);
  });

  it('updates an existing member', () => {
    const created = upsertAutoInviteMember(db, { username: 'bob', displayName: 'Bob' });
    const updated = updateAutoInviteMember(db, created.id, { displayName: 'Robert', active: false });
    expect(updated.displayName).toBe('Robert');
    expect(updated.active).toBe(false);
    expect(listAutoInviteMembers(db, { activeOnly: true })).toHaveLength(0);
  });

  it('returns null when updating a missing member', () => {
    expect(updateAutoInviteMember(db, 999, { displayName: 'x' })).toBeNull();
  });

  it('deletes an existing member', () => {
    const created = upsertAutoInviteMember(db, { username: 'carol' });
    expect(deleteAutoInviteMember(db, created.id)).toBe(true);
    expect(listAutoInviteMembers(db, { activeOnly: false })).toHaveLength(0);
  });

  it('returns false when deleting a missing member', () => {
    expect(deleteAutoInviteMember(db, 999)).toBe(false);
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

  it('blocks partial runs until reset', () => {
    tryBeginAutoInviteRun(db, '-1003');
    finishAutoInviteRun(db, '-1003', { status: 'partial', detail: { invited: 1, failed: 1 } });
    const blocked = tryBeginAutoInviteRun(db, '-1003');
    expect(blocked.started).toBe(false);
    expect(blocked.reason).toBe('partial');
    resetAutoInviteRun(db, '-1003');
    expect(tryBeginAutoInviteRun(db, '-1003').started).toBe(true);
  });

  it('retries stale pending runs older than 15 minutes', () => {
    db.prepare(`
      INSERT INTO telegram_auto_invite_runs (chat_id, status, started_at, finished_at, detail_json)
      VALUES (?, 'pending', datetime('now', '-16 minutes'), NULL, NULL)
    `).run('-1004');
    expect(tryBeginAutoInviteRun(db, '-1004').started).toBe(true);
  });

  it('blocks fresh pending runs', () => {
    tryBeginAutoInviteRun(db, '-1005');
    const blocked = tryBeginAutoInviteRun(db, '-1005');
    expect(blocked.started).toBe(false);
    expect(blocked.reason).toBe('pending');
  });

  it('returns run state via getAutoInviteRun', () => {
    tryBeginAutoInviteRun(db, '-1006');
    finishAutoInviteRun(db, '-1006', { status: 'success', detail: { ok: true } });
    const run = getAutoInviteRun(db, '-1006');
    expect(run.status).toBe('success');
    expect(JSON.parse(run.detailJson)).toEqual({ ok: true });
    expect(getAutoInviteRun(db, '-9999')).toBeNull();
  });
});
