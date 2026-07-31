import { describe, expect, it, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  upsertAutoInviteMember,
  tryBeginAutoInviteRun,
  finishAutoInviteRun,
  getAutoInviteRun,
} from '../src/telegram/auto-invite-store.js';
import {
  runAutoInviteForChat,
  scheduleAutoInvite,
  AUTO_INVITE_MEMBER_CAP,
} from '../src/telegram/auto-invite.js';

function memDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
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

function makeDeps(overrides = {}) {
  const client = { id: 'client' };
  return {
    getClient: vi.fn(async () => client),
    canInvite: vi.fn(async () => ({ ok: true })),
    resolveUser: vi.fn(async (_client, target) => ({
      userId: target.userId ?? '111',
      username: target.username ?? 'alice',
    })),
    inviteUser: vi.fn(async () => {}),
    listMembers: vi.fn((db) => {
      const rows = db.prepare(`SELECT * FROM telegram_auto_invite_members WHERE active = 1 ORDER BY id`).all();
      return rows.map((row) => ({
        id: row.id,
        username: row.username,
        userId: row.user_id,
        displayName: row.display_name,
        active: row.active === 1,
        updatedAt: row.updated_at,
      }));
    }),
    isConfigured: vi.fn(() => true),
    updateMember: vi.fn((db, id, patch) => {
      const existing = db.prepare(`SELECT * FROM telegram_auto_invite_members WHERE id = ?`).get(id);
      if (!existing) return null;
      const userId = patch.userId !== undefined ? patch.userId : existing.user_id;
      const username = patch.username !== undefined ? patch.username : existing.username;
      db.prepare(`
        UPDATE telegram_auto_invite_members
        SET user_id = ?, username = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(userId, username, id);
      const row = db.prepare(`SELECT * FROM telegram_auto_invite_members WHERE id = ?`).get(id);
      return {
        id: row.id,
        username: row.username,
        userId: row.user_id,
        displayName: row.display_name,
        active: row.active === 1,
        updatedAt: row.updated_at,
      };
    }),
    sleep: vi.fn(async () => {}),
    randomDelayMs: vi.fn(() => 7000),
    ...overrides,
  };
}

describe('runAutoInviteForChat', () => {
  let db;

  beforeEach(() => {
    db = memDb();
  });

  it('happy path invites active members without bot and finishes success', async () => {
    upsertAutoInviteMember(db, { username: 'alice' });
    upsertAutoInviteMember(db, { userId: '222', username: 'bob' });

    const deps = makeDeps({
      resolveUser: vi.fn(async (_client, target) => ({
        userId: target.userId ?? '111',
        username: target.username,
      })),
    });

    const result = await runAutoInviteForChat(db, '-1001', { deps });

    expect(result.status).toBe('success');
    expect(result.detail.members).toHaveLength(2);
    expect(result.detail.members.every((m) => m.status === 'invited')).toBe(true);
    expect(deps.canInvite).toHaveBeenCalled();
    expect(deps.inviteUser).toHaveBeenCalledTimes(2);
    expect(deps.sleep).toHaveBeenCalledTimes(1);
    expect(deps.randomDelayMs).toHaveBeenCalled();

    const run = getAutoInviteRun(db, '-1001');
    expect(run.status).toBe('success');
  });

  it('fails when user-bot cannot invite', async () => {
    upsertAutoInviteMember(db, { username: 'alice' });
    const deps = makeDeps({
      canInvite: vi.fn(async () => ({ ok: false, reason: 'no invite rights' })),
    });

    const result = await runAutoInviteForChat(db, '-1001b', { deps });

    expect(result.status).toBe('failed');
    expect(result.detail.error).toMatch(/no invite rights/i);
    expect(deps.inviteUser).not.toHaveBeenCalled();
  });

  it('caps invites at AUTO_INVITE_MEMBER_CAP', async () => {
    for (let i = 0; i < AUTO_INVITE_MEMBER_CAP + 2; i += 1) {
      upsertAutoInviteMember(db, { username: `user${i}` });
    }
    const deps = makeDeps();
    const result = await runAutoInviteForChat(db, '-1001c', { deps });

    expect(result.status).toBe('success');
    expect(result.detail.members).toHaveLength(AUTO_INVITE_MEMBER_CAP);
    expect(result.detail.cappedAt).toBe(AUTO_INVITE_MEMBER_CAP);
    expect(deps.inviteUser).toHaveBeenCalledTimes(AUTO_INVITE_MEMBER_CAP);
    expect(deps.sleep).toHaveBeenCalledTimes(AUTO_INVITE_MEMBER_CAP - 1);
  });

  it('persists resolved user_id for username-only members', async () => {
    const member = upsertAutoInviteMember(db, { username: 'carol' });
    const deps = makeDeps({
      resolveUser: vi.fn(async () => ({ userId: '333', username: 'carol' })),
    });

    await runAutoInviteForChat(db, '-1002', { deps });

    expect(deps.updateMember).toHaveBeenCalledWith(
      db,
      member.id,
      expect.objectContaining({ userId: '333' }),
    );
    const row = db.prepare(`SELECT user_id FROM telegram_auto_invite_members WHERE id = ?`).get(member.id);
    expect(row.user_id).toBe('333');
  });

  it('skips already-participant invite errors and finishes success', async () => {
    upsertAutoInviteMember(db, { username: 'alice' });

    const deps = makeDeps({
      inviteUser: vi.fn(async () => {
        throw new Error('USER_ALREADY_PARTICIPANT');
      }),
    });

    const result = await runAutoInviteForChat(db, '-1003a', { deps });

    expect(result.status).toBe('success');
    expect(result.detail.members[0]).toMatchObject({
      status: 'skipped',
      reason: 'already_participant',
    });
  });

  it('returns partial when a member invite fails (privacy)', async () => {
    upsertAutoInviteMember(db, { username: 'alice' });
    upsertAutoInviteMember(db, { username: 'private_user' });

    const deps = makeDeps({
      inviteUser: vi.fn(async (_client, _chatId, userId) => {
        if (userId === '111') {
          throw new Error('USER_PRIVACY_RESTRICTED');
        }
      }),
      resolveUser: vi.fn(async (_client, target) => ({
        userId: target.username === 'private_user' ? '111' : '222',
        username: target.username,
      })),
    });

    const result = await runAutoInviteForChat(db, '-1003', { deps });

    expect(result.status).toBe('partial');
    expect(result.detail.members.some((m) => m.status === 'failed')).toBe(true);
    expect(result.detail.members.some((m) => m.status === 'invited')).toBe(true);
  });

  it('skips when a prior success run exists', async () => {
    tryBeginAutoInviteRun(db, '-1004');
    finishAutoInviteRun(db, '-1004', { status: 'success', detail: { members: [] } });

    const deps = makeDeps();
    const result = await runAutoInviteForChat(db, '-1004', { deps });

    expect(result.skipped).toBe(true);
    expect(result.status).toBe('success');
    expect(deps.canInvite).not.toHaveBeenCalled();
  });

  it('force retry resets and re-runs after success', async () => {
    tryBeginAutoInviteRun(db, '-1005');
    finishAutoInviteRun(db, '-1005', { status: 'success', detail: { members: [] } });
    upsertAutoInviteMember(db, { username: 'dave' });

    const deps = makeDeps();
    const result = await runAutoInviteForChat(db, '-1005', { force: true, deps });

    expect(result.skipped).toBeUndefined();
    expect(result.status).toBe('success');
    expect(deps.inviteUser).toHaveBeenCalledTimes(1);
  });

  it('fails when userbot is not configured', async () => {
    const deps = makeDeps({ isConfigured: vi.fn(() => false) });

    const result = await runAutoInviteForChat(db, '-1006', { deps });

    expect(result.status).toBe('failed');
    expect(result.detail.error).toBe('userbot not configured');
    expect(deps.canInvite).not.toHaveBeenCalled();
  });
});

describe('scheduleAutoInvite', () => {
  let db;

  beforeEach(() => {
    db = memDb();
  });

  it('schedules runAutoInviteForChat via setImmediate with unref', async () => {
    upsertAutoInviteMember(db, { username: 'eve' });
    const deps = makeDeps();
    const unrefSpy = vi.fn();
    const origSetImmediate = global.setImmediate;

    vi.spyOn(global, 'setImmediate').mockImplementation((fn) => {
      const handle = origSetImmediate(fn);
      handle.unref = unrefSpy;
      return handle;
    });

    scheduleAutoInvite(db, '-1009', { deps });

    await vi.waitFor(() => {
      expect(getAutoInviteRun(db, '-1009')?.status).toBe('success');
    });
    expect(unrefSpy).toHaveBeenCalled();

    vi.restoreAllMocks();
  });

  it('logs errors from scheduled runs without throwing', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const badDb = {
      prepare: () => {
        throw new Error('boom');
      },
    };
    const origSetImmediate = global.setImmediate;
    vi.spyOn(global, 'setImmediate').mockImplementation((fn) => origSetImmediate(fn));

    scheduleAutoInvite(badDb, '-1010');

    await vi.waitFor(() => {
      expect(errorSpy).toHaveBeenCalled();
    });
    expect(errorSpy).toHaveBeenCalledWith('[auto-invite] scheduled run failed:', expect.any(Error));

    errorSpy.mockRestore();
    vi.restoreAllMocks();
  });
});
