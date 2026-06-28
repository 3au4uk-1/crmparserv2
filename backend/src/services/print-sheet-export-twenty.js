import { randomUUID } from 'node:crypto';
import { LAYOUT_LINK_FIELD } from './print-sheet-field-names.js';
import { V_PECHATI_LINE_ITEM_STAGE } from './print-sheet-twenty.js';

const LINE_ITEM_EXPORT_FIELDS = `
  id
  name
  stage
  kommentariy
  dataGotovnostiPechati
  vremyaGotovnostiPechati
  printSheetSessionId
  printSheetTabName
  printSheetRowNumber
  vzatoVRabotu
  gotovo
  plenka { markdown }
  ${LAYOUT_LINK_FIELD} { primaryLinkUrl }
  updatedBy { name { firstName lastName } }
  opportunity {
    id
    name
    companyId
    bitrixLink { primaryLinkUrl }
  }
`;

const LIST_PENDING_EXPORT = `
  query ListPendingPrintSheetExport($limit: Int!) {
    dealLineItems(
      filter: {
        and: [
          { stage: { eq: ${V_PECHATI_LINE_ITEM_STAGE} } }
          { printSheetSessionId: { is: NULL } }
          { dataGotovnostiPechati: { is: NOT_NULL } }
          { vremyaGotovnostiPechati: { is: NOT_NULL } }
        ]
      }
      first: $limit
    ) {
      edges { node { ${LINE_ITEM_EXPORT_FIELDS} } }
    }
  }
`;

const LIST_ACTIVE_SESSIONS = `
  query ListActivePrintSheetSessions($limit: Int!) {
    dealLineItems(
      filter: { printSheetSessionId: { is: NOT_NULL } }
      first: $limit
    ) {
      edges { node { ${LINE_ITEM_EXPORT_FIELDS} } }
    }
  }
`;

const UPDATE_LINE_ITEM = `
  mutation UpdateDealLineItemPrintSheet($id: ID!, $input: DealLineItemUpdateInput!) {
    updateDealLineItem(id: $id, data: $input) { id }
  }
`;

export function buildSessionPatchAfterExport(sessionId, tabName, rowNumber) {
  return {
    printSheetSessionId: sessionId,
    printSheetTabName: tabName,
    printSheetRowNumber: rowNumber,
  };
}

export function buildSessionClearPatch() {
  return {
    printSheetSessionId: null,
    printSheetTabName: null,
    printSheetRowNumber: null,
  };
}

export function newPrintSheetSessionId() {
  return randomUUID();
}

export async function listPendingPrintSheetExport(gql, limit = 100) {
  const resp = await gql(LIST_PENDING_EXPORT, { limit });
  return resp.data?.data?.dealLineItems?.edges?.map((e) => e.node) ?? [];
}

export async function listActivePrintSheetSessions(gql, limit = 200) {
  const resp = await gql(LIST_ACTIVE_SESSIONS, { limit });
  return resp.data?.data?.dealLineItems?.edges?.map((e) => e.node) ?? [];
}

export async function updateDealLineItemPrintSheet(gql, id, input) {
  await gql(UPDATE_LINE_ITEM, { id, input });
}

export function buildReadbackUpdateInput(lineItem, readback) {
  const input = {};
  const currentPlenka = lineItem.plenka?.markdown ?? '';

  if (currentPlenka !== readback.plenkaText) {
    input.plenka = { markdown: readback.plenkaText };
  }
  if (lineItem.vzatoVRabotu !== readback.vzatoVRabotu) {
    input.vzatoVRabotu = readback.vzatoVRabotu;
  }
  if (lineItem.gotovo !== readback.gotovo) {
    input.gotovo = readback.gotovo;
  }

  return input;
}
