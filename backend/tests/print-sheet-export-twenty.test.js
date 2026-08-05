import { describe, it, expect, vi } from 'vitest';
import {
  buildClaimPatch,
  buildClaimRollbackPatch,
  buildRowMetaPatch,
  isEmptyPrintSheetSessionId,
  buildSessionPatchAfterExport,
  buildSessionClearPatch,
  buildReadbackUpdateInput,
  listPendingPrintSheetExport,
  listActivePrintSheetSessions,
  updateDealLineItemPrintSheet,
} from '../src/services/print-sheet-export-twenty.js';
import { LAYOUT_LINK_FIELD } from '../src/services/print-sheet-field-names.js';

describe('session patches', () => {
  it('builds claim / rollback / row-meta patches', () => {
    expect(buildClaimPatch('sess-1')).toEqual({
      printSheetSessionId: 'sess-1',
      printSheetExportRequested: false,
    });
    expect(buildClaimRollbackPatch()).toEqual({
      printSheetSessionId: null,
      printSheetTabName: null,
      printSheetRowNumber: null,
      printSheetExportRequested: true,
    });
    expect(buildRowMetaPatch('Август 2026', 42)).toEqual({
      printSheetTabName: 'Август 2026',
      printSheetRowNumber: 42,
    });
  });

  it('treats null and empty string as empty session', () => {
    expect(isEmptyPrintSheetSessionId(null)).toBe(true);
    expect(isEmptyPrintSheetSessionId('')).toBe(true);
    expect(isEmptyPrintSheetSessionId('uuid')).toBe(false);
  });

  it('builds export session patch', () => {
    const patch = buildSessionPatchAfterExport('sess-1', 'Июнь 2026', 297);
    expect(patch).toEqual({
      printSheetSessionId: 'sess-1',
      printSheetExportRequested: false,
      printSheetTabName: 'Июнь 2026',
      printSheetRowNumber: 297,
    });
  });

  it('builds clear patch', () => {
    expect(buildSessionClearPatch()).toEqual({
      printSheetSessionId: null,
      printSheetTabName: null,
      printSheetRowNumber: null,
    });
  });
});

describe('buildReadbackUpdateInput', () => {
  it('returns only changed fields', () => {
    const input = buildReadbackUpdateInput(
      {
        plenka: { markdown: 'old' },
        vzatoVRabotu: false,
        gotovo: false,
      },
      {
        plenkaText: 'new',
        vzatoVRabotu: true,
        gotovo: false,
      }
    );

    expect(input).toEqual({
      plenka: { markdown: 'new' },
      vzatoVRabotu: true,
    });
  });
});

describe('graphql helpers', () => {
  it('pending query requires printSheetExportRequested and not only stage', async () => {
    const gql = vi.fn().mockResolvedValue({
      data: { data: { dealLineItems: { edges: [] } } },
    });
    await listPendingPrintSheetExport(gql, 10);
    const query = gql.mock.calls[0][0];
    expect(query).toContain('printSheetExportRequested');
    expect(query).toMatch(/eq:\s*true/);
    expect(query).toContain('V_PECHATI');
  });

  it('requests pending export with layout link field', async () => {
    const gql = vi.fn().mockResolvedValue({
      data: { data: { dealLineItems: { edges: [{ node: { id: 'li-1' } }] } } },
    });

    const rows = await listPendingPrintSheetExport(gql, 17);

    expect(rows).toEqual([{ id: 'li-1' }]);
    expect(gql).toHaveBeenCalledWith(expect.stringContaining(LAYOUT_LINK_FIELD), { limit: 17 });
  });

  it('lists active sessions and updates line item', async () => {
    const gql = vi.fn()
      .mockResolvedValueOnce({
        data: { data: { dealLineItems: { edges: [{ node: { id: 'li-2' } }] } } },
      })
      .mockResolvedValueOnce({ data: { data: { updateDealLineItem: { id: 'li-2' } } } });

    const active = await listActivePrintSheetSessions(gql, 8);
    await updateDealLineItemPrintSheet(gql, 'li-2', { gotovo: true });

    expect(active).toEqual([{ id: 'li-2' }]);
    expect(gql).toHaveBeenNthCalledWith(1, expect.stringContaining('ListActivePrintSheetSessions'), {
      limit: 8,
    });
    expect(gql).toHaveBeenNthCalledWith(2, expect.stringContaining('UpdateDealLineItemPrintSheet'), {
      id: 'li-2',
      input: { gotovo: true },
    });
  });
});
