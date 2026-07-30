import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const getAuthStatusMock = vi.fn();
const startLoginMock = vi.fn();
const submitCodeMock = vi.fn();
const submitPasswordMock = vi.fn();
const cancelLoginMock = vi.fn();
const logoutMock = vi.fn();

vi.mock('../src/config.js', () => ({
  config: {
    dbPath: ':memory:',
    telegramApiId: '12345',
    telegramApiHash: 'secret-hash',
    telegramUserSession: '',
    publicBaseUrl: '',
  },
}));

vi.mock('../src/telegram/userbot/auth-login.js', () => ({
  getAuthStatus: (...args) => getAuthStatusMock(...args),
  startLogin: (...args) => startLoginMock(...args),
  submitCode: (...args) => submitCodeMock(...args),
  submitPassword: (...args) => submitPasswordMock(...args),
  cancelLogin: (...args) => cancelLoginMock(...args),
  logout: (...args) => logoutMock(...args),
}));

import { getDb, initDb } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import telegramRouter from '../src/routes/telegram.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/telegram', telegramRouter);
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
  });
  return app;
}

function assertNoSessionLeak(body) {
  const json = JSON.stringify(body);
  expect(json).not.toMatch(/saved-session|1AgA|telegramUserSession|sessionString/i);
  expect(body).not.toHaveProperty('session');
  expect(body).not.toHaveProperty('telegramUserSession');
}

describe('telegram userbot auth routes', () => {
  beforeEach(() => {
    initDb();
    migrate();
    getAuthStatusMock.mockReset();
    startLoginMock.mockReset();
    submitCodeMock.mockReset();
    submitPasswordMock.mockReset();
    cancelLoginMock.mockReset();
    logoutMock.mockReset();

    getAuthStatusMock.mockReturnValue({
      apiConfigured: true,
      sessionSet: false,
      pending: null,
      user: null,
    });
    startLoginMock.mockResolvedValue({ pending: 'code' });
    submitCodeMock.mockResolvedValue({ pending: 'none', sessionSet: true });
    submitPasswordMock.mockResolvedValue({ pending: 'none', sessionSet: true });
  });

  it('GET /userbot/auth/status returns auth status shape', async () => {
    getAuthStatusMock.mockReturnValue({
      apiConfigured: true,
      sessionSet: true,
      pending: null,
      user: { id: '123', username: 'svc', firstName: 'Bot' },
    });

    const res = await request(createApp()).get('/api/telegram/userbot/auth/status');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      apiConfigured: true,
      sessionSet: true,
      pending: null,
      user: { id: '123', username: 'svc', firstName: 'Bot' },
    });
    expect(getAuthStatusMock).toHaveBeenCalledWith(getDb());
    assertNoSessionLeak(res.body);
  });

  it('POST /userbot/auth/start sends phone to startLogin', async () => {
    const res = await request(createApp())
      .post('/api/telegram/userbot/auth/start')
      .send({ phone: '+79001234567' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pending: 'code' });
    expect(startLoginMock).toHaveBeenCalledWith(getDb(), '+79001234567');
    assertNoSessionLeak(res.body);
  });

  it('POST /userbot/auth/start rejects empty phone with 400', async () => {
    startLoginMock.mockRejectedValue(Object.assign(new Error('Phone number required'), { status: 400 }));

    const res = await request(createApp())
      .post('/api/telegram/userbot/auth/start')
      .send({ phone: '  ' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Phone number required' });
    assertNoSessionLeak(res.body);
  });

  it('POST /userbot/auth/start returns 503 when API not configured', async () => {
    startLoginMock.mockRejectedValue(
      Object.assign(new Error('Telegram API not configured'), { status: 503 }),
    );

    const res = await request(createApp())
      .post('/api/telegram/userbot/auth/start')
      .send({ phone: '+79001234567' });

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ error: 'Telegram API not configured' });
    assertNoSessionLeak(res.body);
  });

  it('POST /userbot/auth/code submits code', async () => {
    const res = await request(createApp())
      .post('/api/telegram/userbot/auth/code')
      .send({ code: '12345' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pending: 'none', sessionSet: true });
    expect(submitCodeMock).toHaveBeenCalledWith(getDb(), '12345');
    assertNoSessionLeak(res.body);
  });

  it('POST /userbot/auth/code maps validation errors to 400', async () => {
    submitCodeMock.mockRejectedValue(Object.assign(new Error('No pending login'), { status: 400 }));

    const res = await request(createApp())
      .post('/api/telegram/userbot/auth/code')
      .send({ code: '12345' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'No pending login' });
    assertNoSessionLeak(res.body);
  });

  it('POST /userbot/auth/password submits password', async () => {
    submitPasswordMock.mockResolvedValue({ pending: 'none', sessionSet: true });

    const res = await request(createApp())
      .post('/api/telegram/userbot/auth/password')
      .send({ password: 'secret' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pending: 'none', sessionSet: true });
    expect(submitPasswordMock).toHaveBeenCalledWith(getDb(), 'secret');
    assertNoSessionLeak(res.body);
  });

  it('POST /userbot/auth/cancel calls cancelLogin', async () => {
    const res = await request(createApp()).post('/api/telegram/userbot/auth/cancel');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(cancelLoginMock).toHaveBeenCalledOnce();
    assertNoSessionLeak(res.body);
  });

  it('POST /userbot/auth/logout calls logout', async () => {
    const res = await request(createApp()).post('/api/telegram/userbot/auth/logout');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(logoutMock).toHaveBeenCalledWith(getDb());
    assertNoSessionLeak(res.body);
  });

  it('maps upstream telegram errors to 502', async () => {
    startLoginMock.mockRejectedValue(Object.assign(new Error('Telegram RPC error'), { status: 502 }));

    const res = await request(createApp())
      .post('/api/telegram/userbot/auth/start')
      .send({ phone: '+79001234567' });

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: 'Telegram RPC error' });
    assertNoSessionLeak(res.body);
  });
});
