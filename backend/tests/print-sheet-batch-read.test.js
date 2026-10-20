import { describe, it, expect, vi, beforeEach } from 'vitest';

const batchGet = vi.fn();

vi.mock('../src/services/print-sheet-client.js', () => ({
  getPrintSheetClient: () => ({
    spreadsheets: { values: { batchGet: (...args) => batchGet(...args) } },
  }),
}));

vi.mock('../src/config.js', () => ({
  config: {
    printSheetId: 'sheet-1',
    googleServiceAccountEmail: 'a@b.c',
    googleServiceAccountPrivateKey: 'key',
  },
}));

import {
  fetchPrintSheetRows,
  isSheetsQuotaError,
  sheetRowRange,
} from '../src/services/print-sheet-readback.js';

describe('print sheet batch read', () => {
  beforeEach(() => {
    batchGet.mockReset();
  });

  it('quotes a tab name and reads many rows in one batchGet', async () => {
    batchGet.mockResolvedValue({
      data: {
        valueRanges: [
          { values: [['295']] },
          { values: [['296']] },
        ],
      },
    });

    const rows = await fetchPrintSheetRows([
      { tabName: "Июнь'2026", rowNumber: 5 },
      { tabName: "Июнь'2026", rowNumber: 5 },
      { tabName: 'Июль 2026', rowNumber: 12 },
    ]);

    expect(sheetRowRange("Июнь'2026", 5)).toBe("'Июнь''2026'!A5:X5");
    expect(batchGet).toHaveBeenCalledTimes(1);
    expect(batchGet.mock.calls[0][0].ranges).toEqual([
      "'Июнь''2026'!A5:X5",
      "'Июль 2026'!A12:X12",
    ]);
    expect(rows.get("Июнь'2026\u00005")).toEqual(['295']);
    expect(rows.get('Июль 2026\u000012')).toEqual(['296']);
  });

  it('backs off once on a read quota error', async () => {
    const quota = Object.assign(new Error('Quota exceeded for Read requests per minute'), { code: 429 });
    batchGet
      .mockRejectedValueOnce(quota)
      .mockResolvedValueOnce({ data: { valueRanges: [{ values: [['1']] }] } });

    const rows = await fetchPrintSheetRows(
      [{ tabName: 'Июнь 2026', rowNumber: 2 }],
      { timeoutMs: 5000, sleepFn: async () => {} },
    );

    expect(isSheetsQuotaError(quota)).toBe(true);
    expect(batchGet).toHaveBeenCalledTimes(2);
    expect(rows.get('Июнь 2026\u00002')).toEqual(['1']);
  });

  it('stops waiting when a read does not return', async () => {
    batchGet.mockImplementation(() => new Promise(() => {}));
    await expect(fetchPrintSheetRows(
      [{ tabName: 'Июнь 2026', rowNumber: 2 }],
      { timeoutMs: 40, sleepFn: async () => {} },
    )).rejects.toThrow(/timed out/);
  });
});
