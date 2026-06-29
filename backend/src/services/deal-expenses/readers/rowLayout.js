import { extractDealId } from "../bitrix.js";
import { parseAmount } from "../amounts.js";
import { parseDateFromName, parseSheetTabContext } from "../dates.js";

function normalizeHeader(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function findHeaderRow(data) {
  for (let i = 0; i < Math.min(data.length, 30); i++) {
    const row = data[i].map(normalizeHeader);
    const hasName = row.some((cell) => cell.includes("название заказа") || cell.includes("название сделки"));
    const hasLink = row.some((cell) => cell.includes("ссылка на битрикс"));
    if (hasName && hasLink) return i;
  }
  return -1;
}

function findColumn(headers, patterns) {
  for (let i = 0; i < headers.length; i++) {
    const cell = normalizeHeader(headers[i]);
    if (patterns.some((pattern) => cell.includes(pattern))) return i;
  }
  return -1;
}

function getCellHyperlink(meta, rowIndex, colIndex) {
  const fromMap = meta.hyperlinks?.get(`${rowIndex}:${colIndex}`);
  if (fromMap) return fromMap;
  return null;
}

function isSeparatorRow(row) {
  const joined = row.map((cell) => String(cell).toLowerCase()).join(" ");
  return joined.includes("месяц") && row.filter((cell) => cell !== "").length <= 2;
}

function parseRowLayoutSheet(data, meta) {
  const records = [];
  const headerRowIndex = findHeaderRow(data);
  if (headerRowIndex < 0) return records;

  const headers = data[headerRowIndex];
  const nameCol = findColumn(headers, ["название заказа", "название сделки"]);
  const linkCol = findColumn(headers, ["ссылка на битрикс"]);
  const amountCol = findColumn(headers, ["стоимость для компании"]);

  if (nameCol < 0 || linkCol < 0 || amountCol < 0) return records;

  const sheetContext = parseSheetTabContext(meta.tab);

  for (let rowIndex = headerRowIndex + 1; rowIndex < data.length; rowIndex++) {
    const row = data[rowIndex];
    if (!row || isSeparatorRow(row)) continue;

    const dealName = String(row[nameCol] || "").trim();
    const linkCell = row[linkCol];
    const hyperlink = getCellHyperlink(meta, rowIndex, linkCol);
    const dealId = extractDealId(hyperlink || linkCell);
    const amount = parseAmount(row[amountCol]);

    if (!dealId || amount === null || amount === 0) continue;

    const dateInfo = parseDateFromName(dealName, meta.year, sheetContext);
    records.push({
      deal_id: dealId,
      deal_name: dealName,
      source: meta.source,
      amount,
      date_info: dateInfo,
      spreadsheet: meta.spreadsheet,
      tab: meta.tab,
      row_ref: `row ${rowIndex + 1}`,
    });
  }

  return records;
}

export { parseRowLayoutSheet };
