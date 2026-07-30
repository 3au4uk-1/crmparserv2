import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import {
  listTelegramChats,
  listTelegramTopics,
} from '../src/telegram/chat-store.js';

const runAutoInviteForChatMock = vi.fn();

vi.mock('../src/config.js', () => ({
  config: {
    dbPath: ':memory:',
    telegramApiId: '12345',
    telegramApiHash: 'secret-hash',
    telegramUserSession: 'session-string',
    publicBaseUrl: '',
  },
}));

vi.mock('../src/telegram/auto-invite.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    runAutoInviteForChat: (...args) => runAutoInviteForChatMock(...args),
  };
});

import { getDb, initDb } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import telegramRouter from '../src/routes/telegram.js';
import { processTelegramUpdate } from '../src/telegram/inbound.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/telegram', telegramRouter);
  return app;
}

function openInboundDb() {
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
  `);
  return db;
}

describe('processTelegramUpdate auto-invite trigger', () => {
  let db;
  let scheduleAutoInvite;

  beforeEach(() => {
    db = openInboundDb();
    scheduleAutoInvite = vi.fn();
  });

  it('schedules auto-invite when bot joins a supergroup as member', () => {
    processTelegramUpdate(
      db,
      {
        my_chat_member: {
          chat: { id: -100123, title: 'Ops', type: 'supergroup' },
          new_chat_member: { status: 'member' },
        },
      },
      { scheduleAutoInvite },
    );
    expect(scheduleAutoInvite).toHaveBeenCalledOnce();
    expect(scheduleAutoInvite).toHaveBeenCalledWith(db, '-100123');
    expect(listTelegramChats(db, { activeOnly: false })).toHaveLength(1);
  });

  it('schedules auto-invite for administrator and creator statuses', () => {
    for (const status of ['administrator', 'creator']) {
      scheduleAutoInvite.mockReset();
      processTelegramUpdate(
        db,
        {
          my_chat_member: {
            chat: { id: -100, title: 'G', type: 'group' },
            new_chat_member: { status },
          },
        },
        { scheduleAutoInvite },
      );
      expect(scheduleAutoInvite).toHaveBeenCalledOnce();
    }
  });

  it('does not schedule for private chats', () => {
    processTelegramUpdate(
      db,
      {
        my_chat_member: {
          chat: { id: 42, title: 'DM', type: 'private' },
          new_chat_member: { status: 'member' },
        },
      },
      { scheduleAutoInvite },
    );
    expect(scheduleAutoInvite).not.toHaveBeenCalled();
  });

  it('does not schedule for channel chats', () => {
    processTelegramUpdate(
      db,
      {
        my_chat_member: {
          chat: { id: -100999, title: 'News', type: 'channel' },
          new_chat_member: { status: 'administrator' },
        },
      },
      { scheduleAutoInvite },
    );
    expect(scheduleAutoInvite).not.toHaveBeenCalled();
  });

  it('does not schedule when bot leaves the chat', () => {
    processTelegramUpdate(
      db,
      {
        my_chat_member: {
          chat: { id: -100, title: 'Ops', type: 'supergroup' },
          new_chat_member: { status: 'left' },
        },
      },
      { scheduleAutoInvite },
    );
    expect(scheduleAutoInvite).not.toHaveBeenCalled();
  });

  it('does not schedule on regular message updates', () => {
    processTelegramUpdate(
      db,
      {
        message: {
          chat: { id: -100, title: 'Forum', type: 'supergroup', is_forum: true },
          message_thread_id: 7,
          is_topic_message: true,
          text: 'hello',
        },
      },
      { scheduleAutoInvite },
    );
    expect(scheduleAutoInvite).not.toHaveBeenCalled();
    expect(listTelegramTopics(db, '-100')).toHaveLength(1);
  });
});

describe('telegram auto-invite routes', () => {
  beforeEach(() => {
    initDb();
    migrate();
    getDb().prepare('DELETE FROM telegram_auto_invite_members').run();
    runAutoInviteForChatMock.mockReset();
    runAutoInviteForChatMock.mockResolvedValue({ status: 'success', detail: { members: [] } });
  });

  it('GET /auto-invite/status returns configured boolean only', async () => {
    const res = await request(createApp()).get('/api/telegram/auto-invite/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ configured: true });
    expect(res.body).not.toHaveProperty('telegramUserSession');
    expect(res.body).not.toHaveProperty('telegramApiHash');
    expect(res.body).not.toHaveProperty('telegramApiId');
    expect(Object.keys(res.body)).toEqual(['configured']);
  });

  it('GET /auto-invite/members returns camelCase members', async () => {
    const db = getDb();
    db.prepare(`
      INSERT INTO telegram_auto_invite_members (username, user_id, display_name, active, updated_at)
      VALUES ('alice', '111', 'Alice', 1, datetime('now'))
    `).run();

    const res = await request(createApp()).get('/api/telegram/auto-invite/members');
    expect(res.status).toBe(200);
    expect(res.body.members).toHaveLength(1);
    expect(res.body.members[0]).toMatchObject({
      username: 'alice',
      userId: '111',
      displayName: 'Alice',
      active: true,
    });
    expect(res.body.members[0]).toHaveProperty('id');
    expect(res.body.members[0]).toHaveProperty('updatedAt');
  });

  it('POST /auto-invite/members creates a member', async () => {
    const res = await request(createApp())
      .post('/api/telegram/auto-invite/members')
      .send({ username: '@bob', displayName: 'Bob' });

    expect(res.status).toBe(201);
    expect(res.body.member).toMatchObject({
      username: 'bob',
      displayName: 'Bob',
      active: true,
    });
  });

  it('POST /auto-invite/members rejects empty identity', async () => {
    const res = await request(createApp())
      .post('/api/telegram/auto-invite/members')
      .send({ displayName: 'Nobody' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/username|user/i);
  });

  it('PATCH /auto-invite/members/:id updates a member', async () => {
    const createRes = await request(createApp())
      .post('/api/telegram/auto-invite/members')
      .send({ username: 'carol' });
    const id = createRes.body.member.id;

    const res = await request(createApp())
      .patch(`/api/telegram/auto-invite/members/${id}`)
      .send({ displayName: 'Carol Updated', active: false });

    expect(res.status).toBe(200);
    expect(res.body.member).toMatchObject({
      id,
      displayName: 'Carol Updated',
      active: false,
    });
  });

  it('PATCH /auto-invite/members/:id returns 404 for missing member', async () => {
    const res = await request(createApp())
      .patch('/api/telegram/auto-invite/members/9999')
      .send({ displayName: 'Ghost' });

    expect(res.status).toBe(404);
  });

  it('DELETE /auto-invite/members/:id removes a member', async () => {
    const createRes = await request(createApp())
      .post('/api/telegram/auto-invite/members')
      .send({ userId: '555' });
    const id = createRes.body.member.id;

    const delRes = await request(createApp()).delete(`/api/telegram/auto-invite/members/${id}`);
    expect(delRes.status).toBe(200);
    expect(delRes.body).toEqual({ ok: true });

    const listRes = await request(createApp()).get('/api/telegram/auto-invite/members');
    expect(listRes.body.members).toHaveLength(0);
  });

  it('POST /auto-invite/runs/:chatId/retry calls runAutoInviteForChat with force', async () => {
    const res = await request(createApp()).post('/api/telegram/auto-invite/runs/-10042/retry');

    expect(res.status).toBe(200);
    expect(runAutoInviteForChatMock).toHaveBeenCalledOnce();
    expect(runAutoInviteForChatMock).toHaveBeenCalledWith(
      expect.anything(),
      '-10042',
      { force: true },
    );
    expect(res.body).toEqual({ status: 'success', detail: { members: [] } });
  });
});
