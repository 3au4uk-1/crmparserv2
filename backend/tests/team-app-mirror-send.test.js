import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const settingsState = vi.hoisted(() => ({
  chatId: '-1001',
  topicId: 42,
  secret: 's3cret',
}));

const gram = vi.hoisted(() => ({
  sendMessage: vi.fn(async () => ({ id: 101 })),
  sendFile: vi.fn(async () => ({ id: 102 })),
}));

vi.mock('../src/config.js', () => ({
  config: {
    get teamAppChatSecret() {
      return settingsState.secret;
    },
  },
}));

vi.mock('../src/db/connection.js', () => ({
  getDb: () => ({}),
}));

vi.mock('../src/telegram/team-app-mirror-settings.js', () => ({
  getTeamAppMirrorSettings: () => ({
    chatId: settingsState.chatId,
    topicId: settingsState.topicId,
  }),
}));

vi.mock('../src/telegram/userbot/client.js', () => ({
  getUserbotClient: async () => ({
    sendMessage: gram.sendMessage,
    sendFile: gram.sendFile,
  }),
}));

import teamAppMirrorRouter from '../src/routes/team-app-mirror.js';
import {
  knownOutboxTelegramIds,
  sendTopicMessage,
} from '../src/telegram/userbot/team-app-mirror.js';

function createApp(jsonLimit = '25mb') {
  const app = express();
  app.use('/internal/team-app', express.json({ limit: jsonLimit }), teamAppMirrorRouter);
  return app;
}

describe('sendTopicMessage', () => {
  it('sends text as authorLabel: body with replyTo threadId', async () => {
    const client = {
      sendMessage: vi.fn(async () => ({ id: 77 })),
      sendFile: vi.fn(),
    };
    const id = await sendTopicMessage({
      client,
      chatId: '-1001',
      threadId: 42,
      authorLabel: 'Вася',
      kind: 'text',
      body: 'привет',
    });
    expect(id).toBe('77');
    expect(client.sendMessage).toHaveBeenCalledWith('-1001', {
      message: 'Вася: привет',
      replyTo: 42,
    });
    expect(client.sendFile).not.toHaveBeenCalled();
  });

  it('sends media with caption and replyTo', async () => {
    const buf = Buffer.from('img');
    const client = {
      sendMessage: vi.fn(),
      sendFile: vi.fn(async () => ({ id: 88 })),
    };
    const id = await sendTopicMessage({
      client,
      chatId: '-1001',
      threadId: 42,
      authorLabel: 'Вася',
      kind: 'photo',
      body: '',
      fileBuffer: buf,
      filename: 'a.jpg',
      mime: 'image/jpeg',
    });
    expect(id).toBe('88');
    expect(client.sendFile).toHaveBeenCalledWith('-1001', {
      file: expect.objectContaining({ name: 'a.jpg' }),
      caption: 'Вася',
      replyTo: 42,
      forceDocument: false,
    });
    expect(client.sendFile.mock.calls[0][1].file).toBe(buf);
  });
});

describe('POST /internal/team-app/mirror-send', () => {
  beforeEach(() => {
    settingsState.chatId = '-1001';
    settingsState.topicId = 42;
    settingsState.secret = 's3cret';
    gram.sendMessage.mockClear();
    gram.sendFile.mockClear();
    gram.sendMessage.mockResolvedValue({ id: 101 });
    knownOutboxTelegramIds.clear();
  });

  it('returns 401 when secret mismatches', async () => {
    const res = await request(createApp())
      .post('/internal/team-app/mirror-send')
      .set('X-Chat-Secret', 'wrong')
      .send({ authorLabel: 'A', kind: 'text', body: 'hi' });
    expect(res.status).toBe(401);
  });

  it('returns 401 when secret is empty', async () => {
    settingsState.secret = '';
    const res = await request(createApp())
      .post('/internal/team-app/mirror-send')
      .set('X-Chat-Secret', '')
      .send({ authorLabel: 'A', kind: 'text', body: 'hi' });
    expect(res.status).toBe(401);
  });

  it('returns 503 when mirror chat/topic is missing', async () => {
    settingsState.chatId = '';
    settingsState.topicId = null;
    const res = await request(createApp())
      .post('/internal/team-app/mirror-send')
      .set('X-Chat-Secret', 's3cret')
      .send({ authorLabel: 'A', kind: 'text', body: 'hi' });
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'mirror not configured' });
  });

  it('accepts base64 attachments above the default express json limit', async () => {
    const bytes = Buffer.alloc(150 * 1024, 'x');
    const res = await request(createApp())
      .post('/internal/team-app/mirror-send')
      .set('X-Chat-Secret', 's3cret')
      .send({
        authorLabel: 'A',
        kind: 'photo',
        body: '',
        attachment: {
          bytesBase64: bytes.toString('base64'),
          filename: 'big.jpg',
          mime: 'image/jpeg',
        },
      });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ telegramMessageId: '102' });
    expect(gram.sendFile).toHaveBeenCalled();
  });

  it('rejects large payloads when mounted with the default json limit', async () => {
    const bytes = Buffer.alloc(150 * 1024, 'x');
    const res = await request(createApp('100kb'))
      .post('/internal/team-app/mirror-send')
      .set('X-Chat-Secret', 's3cret')
      .send({
        authorLabel: 'A',
        kind: 'photo',
        body: '',
        attachment: { bytesBase64: bytes.toString('base64') },
      });
    expect(res.status).toBe(413);
  });

  it('sends into the topic and returns camelCase telegramMessageId', async () => {
    const res = await request(createApp())
      .post('/internal/team-app/mirror-send')
      .set('X-Chat-Secret', 's3cret')
      .send({ authorLabel: 'Вася', kind: 'text', body: 'hi' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ telegramMessageId: '101' });
    expect(gram.sendMessage).toHaveBeenCalledWith('-1001', {
      message: 'Вася: hi',
      replyTo: 42,
    });
    expect(knownOutboxTelegramIds.has('101')).toBe(true);
  });
});
