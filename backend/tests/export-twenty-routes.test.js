import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const runTwentyExportMock = vi.fn();

vi.mock('../src/services/twenty-export.js', async () => {
  const actual = await vi.importActual('../src/services/twenty-export.js');
  return {
    ...actual,
    runTwentyExport: (...args) => runTwentyExportMock(...args),
  };
});

vi.mock('../src/services/twenty-config.js', () => ({
  getTwentyConfig: () => ({ apiUrl: 'http://gql', apiToken: 'tok' }),
}));

import exportTwentyRouter from '../src/routes/export-twenty.js';
import { resetExportJobsForTests, getExportJob } from '../src/services/export-jobs.js';
import { TWENTY_EXPORT_COLUMNS } from '../src/services/twenty-export.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/export/twenty', exportTwentyRouter);
  return app;
}

describe('export-twenty routes', () => {
  beforeEach(() => {
    resetExportJobsForTests();
    runTwentyExportMock.mockReset();
    runTwentyExportMock.mockResolvedValue(undefined);
  });

  it('GET /columns returns the export catalog', async () => {
    const res = await request(createApp()).get('/api/export/twenty/columns');
    expect(res.status).toBe(200);
    expect(res.body.columns.map((c) => c.key)).toEqual(
      TWENTY_EXPORT_COLUMNS.map((c) => c.key)
    );
    expect(res.body.columns.at(-1)).toMatchObject({
      key: 'amountDeal',
      header: 'Сумма сделки',
    });
  });

  it('POST rejects unknown columns', async () => {
    const res = await request(createApp())
      .post('/api/export/twenty')
      .send({ from: '2026-06-01', to: '2026-06-30', columns: ['nope'] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Неизвестные колонки/);
  });

  it('POST without columns still starts a job with the full catalog', async () => {
    const res = await request(createApp())
      .post('/api/export/twenty')
      .send({ from: '2026-06-01', to: '2026-06-30' });
    expect(res.status).toBe(201);
    const job = getExportJob(res.body.jobId);
    expect(job.columns).toEqual(TWENTY_EXPORT_COLUMNS.map((c) => c.key));
    expect(job.includeDealsSheet).toBe(false);
  });

  it('POST stores selected columns and deals sheet flag', async () => {
    const res = await request(createApp())
      .post('/api/export/twenty')
      .send({
        from: '2026-06-01',
        to: '2026-06-30',
        columns: ['date', 'amountDeal'],
        includeDealsSheet: true,
      });
    expect(res.status).toBe(201);
    const job = getExportJob(res.body.jobId);
    expect(job.columns).toEqual(['date', 'amountDeal']);
    expect(job.includeDealsSheet).toBe(true);
    expect(runTwentyExportMock).toHaveBeenCalledWith(
      job.jobId,
      expect.objectContaining({
        columns: ['date', 'amountDeal'],
        includeDealsSheet: true,
      })
    );
  });
});
