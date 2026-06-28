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
  buildSessionPatchAfterExport: (sid, tab, row) => ({
    printSheetSessionId: sid,
    printSheetTabName: tab,
    printSheetRowNumber: row,
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

vi.mock('../src/services/print-sheet-row-builder.js', () => ({
  buildPrintSheetRowValues: () => [
    'Про', 'Order', '', 'Item', '', '', 'User', '27.06.2026', '10:00',
    '', '', '', '', '', 'print comment',
  ],
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
