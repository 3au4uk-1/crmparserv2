import { extractDealId } from "../bitrix.js";
import { parseAmount } from "../amounts.js";
import { parseDateFromName, parseSheetNameDate } from "../dates.js";

const ROW_LINK = "ссылка на сделку б24";
const ROW_NAME = "название проекта по календарю";
const ROW_TOTAL = "итого по сделке";

function normalizeLabel(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function parseColumnLayoutSheet(data, meta) {
  const records = [];
  const rowMap = new Map();

  for (let rowIndex = 0; rowIndex < data.length; rowIndex++) {
    const label = normalizeLabel(data[rowIndex][0] || data[rowIndex][1]);
    if (label) rowMap.set(label, rowIndex);
  }

  const linkRow = rowMap.get(ROW_LINK);
  const nameRow = rowMap.get(ROW_NAME);
  const totalRow = rowMap.get(ROW_TOTAL);

  if (linkRow === undefined || totalRow === undefined) {
    return records;
  }

  const maxCols = Math.max(...data.map((row) => row.length));
  for (let col = 2; col < maxCols; col++) {
    const linkCell = data[linkRow]?.[col];
    const dealId = extractDealId(linkCell);
    const amount = parseAmount(data[totalRow]?.[col]);
    const dealName = nameRow !== undefined ? String(data[nameRow]?.[col] || "").trim() : "";

    if (!dealId || amount === null || amount === 0) continue;

    let dateInfo = parseDateFromName(dealName, meta.year);
    if (!dateInfo.confident) {
      const fromSheet = parseSheetNameDate(meta.tab, meta.year);
      if (fromSheet) dateInfo = fromSheet;
    }
    records.push({
      deal_id: dealId,
      deal_name: dealName,
      source: meta.source,
      amount,
      date_info: dateInfo,
      spreadsheet: meta.spreadsheet,
      tab: meta.tab,
      row_ref: `col ${col + 1}`,
    });
  }

  return records;
}

export { parseColumnLayoutSheet };
