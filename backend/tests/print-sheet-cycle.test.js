import { describe, it, expect, vi, beforeEach } from 'vitest';

const listPendingMock = vi.fn();
const listActiveMock = vi.fn();
const appendMock = vi.fn();
const fetchRowMock = vi.fn();
const updateMock = vi.fn();

vi.mock('../src/services/print-sheet-export-twenty.js', () => ({
  listPendingPrintSheetExport: (...args) => listPendingMock(...args),
  listActivePrintSheetSessions: (...args) => listActiveMock(...args),
  loadWorkspaceMemberMap: vi.fn().mockResolvedValue({}),
  updateDealLineItemPrintSheet: (...args) => updateMock(...args),
  buildClaimPatch: (sessionId) => ({
    printSheetSessionId: sessionId,
    printSheetExportRequested: false,
  }),
  buildClaimRollbackPatch: () => ({
    printSheetSessionId: null,
    printSheetTabName: null,
    printSheetRowNumber: null,
    printSheetExportRequested: true,
  }),
  buildRowMetaPatch: (tabName, rowNumber) => ({
    printSheetTabName: tabName,
    printSheetRowNumber: rowNumber,
  }),
  buildSessionClearPatch: () => ({
    printSheetSessionId: null,
    printSheetTabName: null,
    printSheetRowNumber: null,
  }),
  buildReadbackUpdateInput: (lineItem, readback) =>
    readback.plenkaText !== lineItem.plenka?.markdown
      ? { plenka: { markdown: readback.plenkaText } }
      : {},
  buildPrintSheetExportRowValues: () => [
    'Про', 'Order', '', 'Item', '', '', 'User', '27.06.2026', '10:00',
    '', '', '', '', '', 'print comment',
  ],
  newPrintSheetSessionId: () => 'sess-test',
}));

vi.mock('../src/services/print-sheet-append.js', () => ({
  writePrintSheetRow: (...args) => appendMock(...args),
}));

vi.mock('../src/services/print-sheet-readback.js', () => ({
  fetchPrintSheetRow: (...args) => fetchRowMock(...args),
  extractReadbackFromRow: () => ({
    plenkaText: 'Item - 1',
    vzatoVRabotu: true,
    gotovo: false,
  }),
}));

vi.mock('../src/db/connection.js', () => ({
  getDb: () => ({}),
}));

vi.mock('../src/services/print-sheet-tabs.js', () => ({
  buildCurrentMonthTabName: () => 'Июнь 2026',
}));

vi.mock('../src/services/print-sheet-twenty.js', () => ({
  V_PECHATI_LINE_ITEM_STAGE: 'V_PECHATI',
}));

import { runPrintSheetCycle } from '../src/services/print-sheet-cycle.js';

describe('runPrintSheetCycle', () => {
  const gql = vi.fn();

  beforeEach(() => {
    listPendingMock.mockReset();
    listActiveMock.mockReset();
    appendMock.mockReset();
    fetchRowMock.mockReset();
    updateMock.mockReset();
  });

  it('exports pending item then readbacks active session', async () => {
    listPendingMock.mockResolvedValue([{ id: 'li-1', name: 'Item', plenka: { markdown: '' } }]);
    listActiveMock.mockResolvedValue([
      {
        id: 'li-2',
        name: 'Item2',
        stage: 'V_PECHATI',
        printSheetTabName: 'Июнь 2026',
        printSheetRowNumber: 5,
        plenka: { markdown: '' },
      },
    ]);
    appendMock.mockResolvedValue({ rowNumber: 10 });
    fetchRowMock.mockResolvedValue([
      '1', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'TRUE', 'FALSE',
    ]);

    const result = await runPrintSheetCycle(gql);

    expect(appendMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalled();
    expect(result.exported).toBe(1);
    expect(result.readbackUpdated).toBe(1);
  });

  it('claims session before writing sheet row', async () => {
    listPendingMock.mockResolvedValue([{ id: 'li-1', name: 'Item', plenka: { markdown: '' } }]);
    listActiveMock.mockResolvedValue([]);
    const order = [];
    updateMock.mockImplementation(async () => { order.push('update'); });
    appendMock.mockImplementation(async () => {
      order.push('write');
      return { rowNumber: 10 };
    });

    const result = await runPrintSheetCycle(gql);

    expect(order.indexOf('update')).toBeLessThan(order.indexOf('write'));
    expect(updateMock).toHaveBeenCalledWith(
      gql,
      'li-1',
      expect.objectContaining({ printSheetSessionId: 'sess-test', printSheetExportRequested: false }),
    );
    expect(updateMock).toHaveBeenCalledWith(
      gql,
      'li-1',
      expect.objectContaining({ printSheetTabName: 'Июнь 2026', printSheetRowNumber: 10 }),
    );
    expect(result.exported).toBe(1);
  });

  it('rolls back claim and re-requests export when sheet write fails', async () => {
    listPendingMock.mockResolvedValue([{ id: 'li-1', plenka: { markdown: '' } }]);
    listActiveMock.mockResolvedValue([]);
    const order = [];
    updateMock.mockImplementation(async (_gql, _id, patch) => {
      order.push(patch);
    });
    appendMock.mockRejectedValue(new Error('quota'));

    const result = await runPrintSheetCycle(gql);

    expect(result.exported).toBe(0);
    expect(order).toHaveLength(2);
    expect(order[0]).toEqual(
      expect.objectContaining({
        printSheetSessionId: 'sess-test',
        printSheetExportRequested: false,
      }),
    );
    expect(order[1]).toEqual(
      expect.objectContaining({
        printSheetSessionId: null,
        printSheetExportRequested: true,
      }),
    );
  });

  it('does not rollback claim when row-meta update fails after successful write', async () => {
    listPendingMock.mockResolvedValue([{ id: 'li-1', plenka: { markdown: '' } }]);
    listActiveMock.mockResolvedValue([]);
    appendMock.mockResolvedValue({ rowNumber: 10 });
    updateMock
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('crm timeout'));

    const result = await runPrintSheetCycle(gql);

    expect(result.exported).toBe(0);
    expect(updateMock).toHaveBeenCalledTimes(2);
    expect(updateMock).toHaveBeenNthCalledWith(
      1,
      gql,
      'li-1',
      expect.objectContaining({
        printSheetSessionId: 'sess-test',
        printSheetExportRequested: false,
      }),
    );
    expect(updateMock).not.toHaveBeenCalledWith(
      gql,
      'li-1',
      expect.objectContaining({ printSheetExportRequested: true }),
    );
  });

  it('clears session when stage is not V_PECHATI', async () => {
    listPendingMock.mockResolvedValue([]);
    listActiveMock.mockResolvedValue([
      {
        id: 'li-3',
        stage: 'NOVYY',
        printSheetSessionId: 'old',
        printSheetTabName: 'Июнь 2026',
        printSheetRowNumber: 3,
        plenka: { markdown: '' },
      },
    ]);

    await runPrintSheetCycle(gql);

    expect(updateMock).toHaveBeenCalledWith(gql, 'li-3', {
      printSheetSessionId: null,
      printSheetTabName: null,
      printSheetRowNumber: null,
    });
  });
});
