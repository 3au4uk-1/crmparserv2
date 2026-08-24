import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const callTelegramMock = vi.fn();
const sendDigestTextMock = vi.fn();
const sendOkleykaMock = vi.fn();
const getUserbotClientMock = vi.fn();
const isUserbotConfiguredMock = vi.fn();

vi.mock('../src/telegram/api-client.js', () => ({
  callTelegram: (...args) => callTelegramMock(...args),
  callTelegramGetMe: vi.fn(),
}));

vi.mock('../src/telegram/digest/send.js', () => ({
  sendDigestText: (...args) => sendDigestTextMock(...args),
}));

vi.mock('../src/telegram/outbound.js', () => ({
  sendOkleykaToTelegram: (...args) => sendOkleykaMock(...args),
}));

vi.mock('../src/telegram/userbot/client.js', () => ({
  getUserbotClient: (...args) => getUserbotClientMock(...args),
  isUserbotConfigured: (...args) => isUserbotConfiguredMock(...args),
}));

vi.mock('../src/db/connection.js', () => ({
  getDb: () => globalThis.__testSendDb,
}));

function openDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);`);
  return db;
}

describe('POST /telegram/test-send', () => {
  let app;

  beforeEach(async () => {
    vi.clearAllMocks();
    globalThis.__testSendDb = openDb();
    isUserbotConfiguredMock.mockReturnValue(true);
    getUserbotClientMock.mockResolvedValue({});
    sendOkleykaMock.mockResolvedValue(undefined);
    sendDigestTextMock.mockResolvedValue(undefined);
    callTelegramMock.mockResolvedValue({});
    vi.resetModules();
    const router = (await import('../src/routes/telegram.js')).default;
    app = express();
    app.use(express.json());
    app.use('/telegram', router);
  });

  it('defaults to okleyka.send via user-bot', async () => {
    globalThis.__testSendDb
      .prepare(`INSERT INTO settings (key, value) VALUES ('telegram_chat_map', ?)`)
      .run(JSON.stringify({ 'okleyka.send': { chatId: '-100', threadId: 1 } }));

    const res = await request(app).post('/telegram/test-send').send({});
    expect(res.status).toBe(200);
    expect(sendOkleykaMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: '-100',
        threadId: 1,
        text: 'Тест из crmparser',
      }),
    );
  });

  it('sends digest.morning ping via user-bot', async () => {
    const client = { id: 'ub' };
    getUserbotClientMock.mockResolvedValue(client);
    globalThis.__testSendDb
      .prepare(`INSERT INTO settings (key, value) VALUES ('telegram_chat_map', ?)`)
      .run(JSON.stringify({ 'digest.morning': { chatId: '-200', threadId: 9 } }));

    const res = await request(app)
      .post('/telegram/test-send')
      .send({ event: 'digest.morning' });
    expect(res.status).toBe(200);
    expect(sendDigestTextMock).toHaveBeenCalledWith({
      client,
      chatId: '-200',
      threadId: 9,
      text: 'Тест утренней сводки',
    });
    expect(callTelegramMock).not.toHaveBeenCalled();
    expect(sendOkleykaMock).not.toHaveBeenCalled();
  });

  it('returns 400 when digest.morning missing', async () => {
    const res = await request(app)
      .post('/telegram/test-send')
      .send({ event: 'digest.morning' });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });

  it('returns 400 when user-bot not configured for digest.morning', async () => {
    isUserbotConfiguredMock.mockReturnValue(false);
    globalThis.__testSendDb
      .prepare(`INSERT INTO settings (key, value) VALUES ('telegram_chat_map', ?)`)
      .run(JSON.stringify({ 'digest.morning': { chatId: '-200', threadId: 9 } }));

    const res = await request(app)
      .post('/telegram/test-send')
      .send({ event: 'digest.morning' });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ ok: false, error: 'User-bot not configured' });
    expect(sendDigestTextMock).not.toHaveBeenCalled();
  });

  it('sends banner_podryad.evening ping via Bot API', async () => {
    globalThis.__testSendDb
      .prepare(`INSERT INTO settings (key, value) VALUES ('telegram_bot_token', ?)`)
      .run('123:abc');
    globalThis.__testSendDb
      .prepare(`INSERT INTO settings (key, value) VALUES ('telegram_chat_map', ?)`)
      .run(JSON.stringify({ 'banner_podryad.evening': { chatId: '-300', threadId: 7 } }));

    const res = await request(app)
      .post('/telegram/test-send')
      .send({ event: 'banner_podryad.evening' });
    expect(res.status).toBe(200);
    expect(callTelegramMock).toHaveBeenCalledWith('123:abc', 'sendMessage', {
      chat_id: '-300',
      text: 'Тест пачки баннер/подряд',
      message_thread_id: 7,
    });
    expect(sendOkleykaMock).not.toHaveBeenCalled();
    expect(sendDigestTextMock).not.toHaveBeenCalled();
  });

  it('omits message_thread_id when banner_podryad.evening has no thread', async () => {
    globalThis.__testSendDb
      .prepare(`INSERT INTO settings (key, value) VALUES ('telegram_bot_token', ?)`)
      .run('123:abc');
    globalThis.__testSendDb
      .prepare(`INSERT INTO settings (key, value) VALUES ('telegram_chat_map', ?)`)
      .run(JSON.stringify({ 'banner_podryad.evening': { chatId: '-300' } }));

    const res = await request(app)
      .post('/telegram/test-send')
      .send({ event: 'banner_podryad.evening' });
    expect(res.status).toBe(200);
    expect(callTelegramMock).toHaveBeenCalledWith('123:abc', 'sendMessage', {
      chat_id: '-300',
      text: 'Тест пачки баннер/подряд',
    });
  });

  it('returns 400 when banner_podryad.evening chat is missing', async () => {
    globalThis.__testSendDb
      .prepare(`INSERT INTO settings (key, value) VALUES ('telegram_bot_token', ?)`)
      .run('123:abc');

    const res = await request(app)
      .post('/telegram/test-send')
      .send({ event: 'banner_podryad.evening' });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/banner_podryad\.evening/);
    expect(callTelegramMock).not.toHaveBeenCalled();
  });

  it('returns 400 when bot token is missing for banner_podryad.evening', async () => {
    globalThis.__testSendDb
      .prepare(`INSERT INTO settings (key, value) VALUES ('telegram_chat_map', ?)`)
      .run(JSON.stringify({ 'banner_podryad.evening': { chatId: '-300', threadId: 7 } }));

    const res = await request(app)
      .post('/telegram/test-send')
      .send({ event: 'banner_podryad.evening' });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toMatch(/[Tt]oken/);
    expect(callTelegramMock).not.toHaveBeenCalled();
  });
});
