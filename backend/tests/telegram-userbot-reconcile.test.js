import Database from 'better-sqlite3';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  mapEntityToChat,
  reconcileUserbotChats,
} from '../src/telegram/userbot/reconcile.js';
import { listTelegramChats, listTelegramTopics } from '../src/telegram/chat-store.js';
import { tryBeginAutoInviteRun, finishAutoInviteRun } from '../src/telegram/auto-invite-store.js';

function memDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE telegram_chats (
      chat_id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      type TEXT NOT NULL DEFAULT '',
      is_forum INTEGER NOT NULL DEFAULT 0,
      username TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      source TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );
    CREATE TABLE telegram_topics (
      chat_id TEXT NOT NULL,
      thread_id INTEGER NOT NULL,
      name TEXT,
      source TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      PRIMARY KEY (chat_id, thread_id)
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

describe('mapEntityToChat', () => {
  it('maps megagroup to -100… supergroup id', () => {
    const mapped = mapEntityToChat({
      className: 'Channel',
      id: 1234567890n,
      title: 'Order',
      megagroup: true,
      forum: false,
    });
    expect(mapped.chatId).toBe('-1001234567890');
    expect(mapped.type).toBe('supergroup');
    expect(mapped.isForum).toBe(false);
  });

  it('skips users and broadcast channels', () => {
    expect(mapEntityToChat({ className: 'User', id: 1n, firstName: 'A' })).toBeNull();
    expect(
      mapEntityToChat({ className: 'Channel', id: 2n, title: 'News', broadcast: true }),
    ).toBeNull();
  });
});

describe('reconcileUserbotChats', () => {
  let db;

  beforeEach(() => {
    db = memDb();
  });

  it('skips when userbot not configured', async () => {
    const result = await reconcileUserbotChats(db, { isConfigured: () => false });
    expect(result.skipped).toBe(true);
  });

  it('upserts chats/topics and schedules invite for new groups once', async () => {
    const scheduleInvite = vi.fn();
    const entity = {
      className: 'Channel',
      id: 111n,
      title: 'Ops',
      megagroup: true,
      forum: true,
      username: 'ops',
    };
    const client = {
      getDialogs: vi.fn(async () => [{ entity }]),
    };
    const listForumTopics = vi.fn(async () => [
      { id: 3, title: 'General' },
      { id: 7, title: 'Okleyka' },
    ]);

    const first = await reconcileUserbotChats(db, {
      isConfigured: () => true,
      getClient: async () => client,
      scheduleInvite,
      listForumTopics,
    });

    expect(first.chats).toBe(1);
    expect(first.topics).toBe(2);
    expect(first.invited).toBe(1);
    expect(scheduleInvite).toHaveBeenCalledWith(db, '-100111');

    const chats = listTelegramChats(db);
    expect(chats[0]).toMatchObject({
      chat_id: '-100111',
      title: 'Ops',
      type: 'supergroup',
      source: 'userbot',
    });
    expect(listTelegramTopics(db, '-100111')).toHaveLength(2);

    // Second pass: already known, no re-invite
    scheduleInvite.mockClear();
    const second = await reconcileUserbotChats(db, {
      isConfigured: () => true,
      getClient: async () => client,
      scheduleInvite,
      listForumTopics,
    });
    expect(second.invited).toBe(0);
    expect(scheduleInvite).not.toHaveBeenCalled();
  });

  it('does not schedule invite when a prior run exists', async () => {
    tryBeginAutoInviteRun(db, '-100222');
    finishAutoInviteRun(db, '-100222', { status: 'success', detail: {} });

    const scheduleInvite = vi.fn();
    const entity = {
      className: 'Channel',
      id: 222n,
      title: 'Done',
      megagroup: true,
    };
    await reconcileUserbotChats(db, {
      isConfigured: () => true,
      getClient: async () => ({ getDialogs: async () => [{ entity }] }),
      scheduleInvite,
      listForumTopics: async () => [],
    });
    // Chat was unknown in telegram_chats but run exists → still no schedule
    expect(scheduleInvite).not.toHaveBeenCalled();
  });
});
