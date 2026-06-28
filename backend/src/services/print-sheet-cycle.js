import { buildPrintSheetRowValues } from './print-sheet-row-builder.js';
import { writePrintSheetRow } from './print-sheet-append.js';
import { fetchPrintSheetRow, extractReadbackFromRow } from './print-sheet-readback.js';
import { buildCurrentMonthTabName } from './print-sheet-tabs.js';
import { V_PECHATI_LINE_ITEM_STAGE } from './print-sheet-twenty.js';
import {
  listPendingPrintSheetExport,
  listActivePrintSheetSessions,
  updateDealLineItemPrintSheet,
  buildSessionPatchAfterExport,
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

  for (const lineItem of pending) {
    try {
      const rowValues = buildPrintSheetRowValues(lineItem);
      const { rowNumber } = await writePrintSheetRow(tabName, rowValues);
      await updateDealLineItemPrintSheet(
        gql,
        lineItem.id,
        buildSessionPatchAfterExport(newPrintSheetSessionId(), tabName, rowNumber)
      );
      exported += 1;
    } catch (err) {
      console.error(`[print-sheet] export failed for ${lineItem.id}:`, err.message);
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
      const readback = extractReadbackFromRow(cells, lineItem.name);
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
