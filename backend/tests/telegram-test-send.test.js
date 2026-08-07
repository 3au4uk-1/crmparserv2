import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const callTelegramMock = vi.fn();
const sendOkleykaMock = vi.fn();
const getUserbotClientMock = vi.fn();
const isUserbotConfiguredMock = vi.fn();

vi.mock('../src/telegram/api-client.js', () => ({
  callTelegram: (...args) => callTelegramMock(...args),
  callTelegramGetMe: vi.fn(),
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

  it('sends digest.morning ping via bot API', async () => {
    globalThis.__testSendDb
      .prepare(`INSERT INTO settings (key, value) VALUES (?, ?), (?, ?)`)
      .run(
        'telegram_bot_token',
        'tok',
        'telegram_chat_map',
        JSON.stringify({ 'digest.morning': { chatId: '-200', threadId: 9 } }),
      );

    const res = await request(app)
      .post('/telegram/test-send')
      .send({ event: 'digest.morning' });
    expect(res.status).toBe(200);
    expect(callTelegramMock).toHaveBeenCalledWith('tok', 'sendMessage', {
      chat_id: '-200',
      text: 'Тест утренней сводки',
      message_thread_id: 9,
    });
    expect(sendOkleykaMock).not.toHaveBeenCalled();
  });

  it('returns 400 when digest.morning missing', async () => {
    globalThis.__testSendDb
      .prepare(`INSERT INTO settings (key, value) VALUES ('telegram_bot_token', ?)`)
      .run('tok');

    const res = await request(app)
      .post('/telegram/test-send')
      .send({ event: 'digest.morning' });
    expect(res.status).toBe(400);
    expect(res.body.ok).toBe(false);
  });
});
