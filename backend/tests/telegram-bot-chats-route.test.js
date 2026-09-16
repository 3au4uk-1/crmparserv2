import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const callTelegram = vi.fn();

vi.mock('../src/config.js', () => ({
  config: {
    appPassword: 'test-password',
    sessionSecret: 'test-session-secret',
    dbPath: ':memory:',
    publicBaseUrl: '',
  },
}));

vi.mock('../src/telegram/api-client.js', () => ({
  callTelegram: (...args) => callTelegram(...args),
}));

import { getDb, initDb } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import { appAuthMiddleware, createSessionToken } from '../src/middleware/app-auth.js';
import { upsertTelegramChat } from '../src/telegram/chat-store.js';
import telegramRouter from '../src/routes/telegram.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api', appAuthMiddleware);
  app.use('/api/telegram', telegramRouter);
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
  });
  return app;
}

function authorized(requestBuilder) {
  return requestBuilder.set('Authorization', `Bearer ${createSessionToken()}`);
}

describe('telegram bot chat routes', () => {
  beforeEach(() => {
    initDb();
    migrate();
    callTelegram.mockReset();
  });

  it('GET /bot-chats does not include userbot-only chats', async () => {
    upsertTelegramChat(getDb(), {
      chatId: '-200',
      title: 'Userbot forum',
      type: 'supergroup',
      isForum: true,
      username: null,
      active: true,
      source: 'userbot',
    });

    const res = await authorized(request(createApp()).get('/api/telegram/bot-chats'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ chats: [] });
  });

  it('POST /bot-chats stores a Bot API chat from getChat', async () => {
    getDb()
      .prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('telegram_bot_token', ?)`)
      .run('123:token');
    callTelegram.mockResolvedValue({
      id: -100555,
      title: 'Маяк заявки',
      type: 'supergroup',
      is_forum: true,
      username: 'mayak_requests',
    });

    const post = await authorized(
      request(createApp()).post('/api/telegram/bot-chats').send({ chatId: '-100555' }),
    );
    expect(post.status).toBe(200);
    expect(callTelegram).toHaveBeenCalledWith('123:token', 'getChat', { chat_id: '-100555' });
    expect(post.body.chat).toEqual({
      chatId: '-100555',
      title: 'Маяк заявки',
      type: 'supergroup',
      isForum: true,
      username: 'mayak_requests',
      active: true,
      source: 'bot',
      lastSeenAt: expect.any(String),
    });

    const list = await authorized(request(createApp()).get('/api/telegram/bot-chats'));
    expect(list.body.chats).toEqual([
      expect.objectContaining({ chatId: '-100555', title: 'Маяк заявки', isForum: true }),
    ]);
  });

  it('POST /bot-chats retries getChat with a -100 prefix for a t.me/c id', async () => {
    getDb()
      .prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('telegram_bot_token', ?)`)
      .run('123:token');
    callTelegram.mockResolvedValueOnce({
      id: -100555000555,
      title: 'Маяк заявки',
      type: 'supergroup',
      is_forum: true,
    });

    const post = await authorized(
      request(createApp()).post('/api/telegram/bot-chats').send({
        chatId: 'https://t.me/c/555000555/4',
      }),
    );

    expect(post.status).toBe(200);
    expect(callTelegram).toHaveBeenCalledTimes(1);
    expect(callTelegram).toHaveBeenCalledWith('123:token', 'getChat', {
      chat_id: '-100555000555',
    });
    expect(post.body.chat.chatId).toBe('-100555000555');
  });

  it('POST /bot-chats/:chatId/topics stores a manual topic', async () => {
    getDb()
      .prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('telegram_bot_token', ?)`)
      .run('123:token');
    callTelegram.mockResolvedValue({
      id: -100555,
      title: 'Маяк заявки',
      type: 'supergroup',
      is_forum: true,
    });
    await authorized(request(createApp()).post('/api/telegram/bot-chats').send({ chatId: '-100555' }));

    const post = await authorized(
      request(createApp())
        .post('/api/telegram/bot-chats/-100555/topics')
        .send({ threadId: 17, name: 'Просчёты' }),
    );
    expect(post.status).toBe(200);
    expect(post.body.topic).toEqual(
      expect.objectContaining({ chatId: '-100555', threadId: 17, name: 'Просчёты' }),
    );

    const topics = await authorized(
      request(createApp()).get('/api/telegram/bot-chats/-100555/topics'),
    );
    expect(topics.body.topics).toEqual([
      expect.objectContaining({ threadId: 17, name: 'Просчёты' }),
    ]);
  });
});
