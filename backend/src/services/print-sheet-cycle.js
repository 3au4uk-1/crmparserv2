import { buildPrintSheetRowValues } from './print-sheet-row-builder.js';
import { writePrintSheetRow } from './print-sheet-append.js';
import { fetchPrintSheetRow, extractReadbackFromRow } from './print-sheet-readback.js';
import { buildCurrentMonthTabName } from './print-sheet-tabs.js';
import { V_PECHATI_LINE_ITEM_STAGE } from './print-sheet-twenty.js';
import {
  listPendingPrintSheetExport,
  listActivePrintSheetSessions,
  updateDealLineItemPrintSheet,
  loadWorkspaceMemberMap,
  buildClaimPatch,
  buildClaimRollbackPatch,
  buildRowMetaPatch,
  buildSessionClearPatch,
  buildReadbackUpdateInput,
  newPrintSheetSessionId,
} from './print-sheet-export-twenty.js';

export async function runPrintSheetCycle(gql) {
  let exported = 0;
  let readbackUpdated = 0;
  let sessionsCleared = 0;

  const pending = await listPendingPrintSheetExport(gql);
  const tabName = buildCurrentMonthTabName();
  const workspaceMemberById = await loadWorkspaceMemberMap(gql);

  for (const lineItem of pending) {
    const sessionId = newPrintSheetSessionId();
    let writeSucceeded = false;
    try {
      await updateDealLineItemPrintSheet(gql, lineItem.id, buildClaimPatch(sessionId));
      const rowValues = buildPrintSheetRowValues(lineItem, { workspaceMemberById });
      const { rowNumber } = await writePrintSheetRow(tabName, rowValues);
      writeSucceeded = true;
      await updateDealLineItemPrintSheet(gql, lineItem.id, buildRowMetaPatch(tabName, rowNumber));
      exported += 1;
    } catch (err) {
      console.error(`[print-sheet] export failed for ${lineItem.id}:`, err.message);
      if (!writeSucceeded) {
        try {
          await updateDealLineItemPrintSheet(gql, lineItem.id, buildClaimRollbackPatch());
        } catch (rollbackErr) {
          console.error(`[print-sheet] claim rollback failed for ${lineItem.id}:`, rollbackErr.message);
        }
      }
    }
  }

  const active = await listActivePrintSheetSessions(gql);

  for (const lineItem of active) {
    if (lineItem.stage !== V_PECHATI_LINE_ITEM_STAGE) {
      try {
        await updateDealLineItemPrintSheet(gql, lineItem.id, buildSessionClearPatch());
        sessionsCleared += 1;
      } catch (err) {
        console.error(`[print-sheet] session clear failed for ${lineItem.id}:`, err.message);
      }
      continue;
    }

    const tab = lineItem.printSheetTabName;
    const row = lineItem.printSheetRowNumber;
    if (!tab || !row) continue;

    try {
      const cells = await fetchPrintSheetRow(tab, row);
      const readback = extractReadbackFromRow(cells);
      const input = buildReadbackUpdateInput(lineItem, readback);
      if (Object.keys(input).length === 0) continue;
      await updateDealLineItemPrintSheet(gql, lineItem.id, input);
      readbackUpdated += 1;
    } catch (err) {
      console.error(`[print-sheet] read-back failed for ${lineItem.id}:`, err.message);
    }
  }

  return { exported, readbackUpdated, sessionsCleared };
}
