import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const runParsingMock = vi.fn();

vi.mock('../src/services/parser.js', () => ({
  runParsing: (...args) => runParsingMock(...args),
}));

vi.mock('../src/db/connection.js', () => ({
  getDb: () => {
    throw new Error('db not used');
  },
}));

import parsingRouter from '../src/routes/parsing.js';
import { isParsingInProgress, releaseParsingLock } from '../src/services/parsing-lock.js';

function app() {
  const server = express();
  server.use(express.json());
  server.use('/api/parsing', parsingRouter);
  return server;
}

describe('GET /api/parsing/status', () => {
  beforeEach(() => {
    releaseParsingLock();
    runParsingMock.mockReset();
  });

  it('is in progress only while runParsing is still going', async () => {
    let finish;
    runParsingMock.mockImplementation(() => new Promise((resolve) => {
      finish = resolve;
    }));

    const pending = request(app()).post('/api/parsing/run').send({
      startDate: '2026-10-20',
      endDate: '2026-11-03',
    }).then((res) => res);

    await vi.waitFor(() => {
      expect(isParsingInProgress()).toBe(true);
    });
    const during = await request(app()).get('/api/parsing/status');
    expect(during.body).toEqual({ inProgress: true });

    finish({ total: 46 });
    const done = await pending;
    expect(done.status).toBe(200);
    const after = await request(app()).get('/api/parsing/status');
    expect(after.body).toEqual({ inProgress: false });
    expect(isParsingInProgress()).toBe(false);
  });
});
