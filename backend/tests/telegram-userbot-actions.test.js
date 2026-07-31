import { describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { Api } from 'telegram';
import {
  extractInviteHash,
  resolveUser,
  joinChatByInviteLink,
  inviteUserToChat,
  getSelfUserId,
  canInviteToChat,
} from '../src/telegram/userbot/actions.js';
import { isUserbotConfigured } from '../src/telegram/userbot/client.js';

function memDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  return db;
}

describe('isUserbotConfigured', () => {
  it('returns true when api id, hash, and session are set', () => {
    const db = memDb();
    expect(
      isUserbotConfigured(db, {
        telegramApiId: '123',
        telegramApiHash: 'abc',
        telegramUserSession: 'session',
      }),
    ).toBe(true);
  });

  it('returns false when any value is missing', () => {
    const db = memDb();
    expect(
      isUserbotConfigured(db, {
        telegramApiId: '123',
        telegramApiHash: 'abc',
        telegramUserSession: '',
      }),
    ).toBe(false);
    expect(
      isUserbotConfigured(db, {
        telegramApiId: '',
        telegramApiHash: 'abc',
        telegramUserSession: 'session',
      }),
    ).toBe(false);
  });
});

describe('extractInviteHash', () => {
  it('parses t.me/+ links', () => {
    expect(extractInviteHash('https://t.me/+AbCdEfGh')).toBe('AbCdEfGh');
    expect(extractInviteHash('t.me/+xyz')).toBe('xyz');
  });

  it('parses t.me/joinchat/ links', () => {
    expect(extractInviteHash('https://t.me/joinchat/OldStyleHash')).toBe('OldStyleHash');
  });

  it('throws on invalid links', () => {
    expect(() => extractInviteHash('https://example.com')).toThrow(/Invalid invite link/);
  });
});

describe('resolveUser', () => {
  it('prefers userId', async () => {
    const client = { getEntity: vi.fn(async () => ({ id: 99n, username: 'x' })) };
    const r = await resolveUser(client, { userId: '99', username: 'ignored' });
    expect(r.userId).toBe('99');
    expect(r.username).toBe('x');
    expect(client.getEntity).toHaveBeenCalledWith('99');
  });

  it('resolves by username when userId is absent', async () => {
    const client = { getEntity: vi.fn(async () => ({ id: 42n, username: 'alice' })) };
    const r = await resolveUser(client, { username: '@alice' });
    expect(r.userId).toBe('42');
    expect(r.username).toBe('alice');
    expect(client.getEntity).toHaveBeenCalledWith('@alice');
  });
});

describe('joinChatByInviteLink', () => {
  it('extracts invite hash and calls ImportChatInvite', async () => {
    const client = { invoke: vi.fn(async () => ({})) };
    await joinChatByInviteLink(client, 'https://t.me/+TestHash99');

    expect(client.invoke).toHaveBeenCalledTimes(1);
    const request = client.invoke.mock.calls[0][0];
    expect(request).toBeInstanceOf(Api.messages.ImportChatInvite);
    expect(request.hash).toBe('TestHash99');
  });

  it('supports joinchat/ links', async () => {
    const client = { invoke: vi.fn(async () => ({})) };
    await joinChatByInviteLink(client, 'https://t.me/joinchat/LegacyHash');

    const request = client.invoke.mock.calls[0][0];
    expect(request.hash).toBe('LegacyHash');
  });
});

describe('inviteUserToChat', () => {
  it('calls InviteToChannel with chat and user', async () => {
    const client = { invoke: vi.fn(async () => ({})) };
    await inviteUserToChat(client, '-100123', '456789');

    expect(client.invoke).toHaveBeenCalledTimes(1);
    const request = client.invoke.mock.calls[0][0];
    expect(request).toBeInstanceOf(Api.channels.InviteToChannel);
    expect(request.channel).toBe('-100123');
    expect(request.users).toEqual(['456789']);
  });
});

describe('getSelfUserId', () => {
  it('returns string id from getMe', async () => {
    const client = { getMe: vi.fn(async () => ({ id: 777888999n })) };
    await expect(getSelfUserId(client)).resolves.toBe('777888999');
  });
});

describe('canInviteToChat', () => {
  it('ok when admin has inviteUsers', async () => {
    const client = {
      getEntity: vi.fn(async () => ({
        adminRights: { inviteUsers: true },
        defaultBannedRights: { inviteUsers: true },
      })),
    };
    await expect(canInviteToChat(client, '-1001')).resolves.toEqual({ ok: true });
  });

  it('ok when invites are not banned for members', async () => {
    const client = {
      getEntity: vi.fn(async () => ({
        defaultBannedRights: { inviteUsers: false },
      })),
    };
    await expect(canInviteToChat(client, '-1002')).resolves.toEqual({ ok: true });
  });

  it('fails when invites are banned and self is not inviting admin', async () => {
    const client = {
      getEntity: vi.fn(async () => ({
        defaultBannedRights: { inviteUsers: true },
      })),
    };
    const result = await canInviteToChat(client, '-1003');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/cannot invite/i);
  });

  it('fails when admin lacks inviteUsers', async () => {
    const client = {
      getEntity: vi.fn(async () => ({
        adminRights: { inviteUsers: false },
        defaultBannedRights: { inviteUsers: false },
      })),
    };
    const result = await canInviteToChat(client, '-1004');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/without inviteUsers/i);
  });
});
