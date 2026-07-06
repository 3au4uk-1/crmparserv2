import XLSX from "xlsx";
import { extractDealId } from "../bitrix.js";
import { parseAmount } from "../amounts.js";
import { parseDateFromName, parseExcelDate, parseSheetNameDate } from "../dates.js";

function normalizeHeader(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function findHeaderRow(data) {
  for (let i = 0; i < Math.min(data.length, 20); i++) {
    const row = data[i].map(normalizeHeader);
    if (row.some((cell) => cell.includes("сделка в б24")) && row.some((cell) => cell.includes("сумма к оплате"))) {
      return i;
    }
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

  const sheet = meta.sheet;
  if (!sheet) return null;
  const address = `${XLSX.utils.encode_col(colIndex)}${rowIndex + 1}`;
  const cell = sheet[address];
  return cell?.l?.Target || cell?.l?.Rel?.Target || null;
}

function isCancelledPayment(row, statusCol) {
  const status = String(row[statusCol] || "").toLowerCase();
  return status.includes("отменен");
}

function isPaymentRow(row, statusCol, nameCol) {
  const status = String(row[statusCol] || "").toLowerCase();
  const name = String(row[nameCol] || "").toLowerCase();
  return status.includes("оплачен") || name.includes("заявка на оплату");
}

function parseBeznalSheet(data, meta) {
  const records = [];
  const headerRowIndex = findHeaderRow(data);
  if (headerRowIndex < 0) return records;

  const headers = data[headerRowIndex];
  const dealCol = findColumn(headers, ["сделка в б24"]);
  const amountCol = findColumn(headers, ["сумма к оплате"]);
  const dateCol = findColumn(headers, ["дата начала мероприятия"]);
  const statusCol = findColumn(headers, ["статус"]);
  const nameCol = findColumn(headers, ["название"]);

  if (dealCol < 0 || amountCol < 0) return records;

  let pending = null;

  for (let rowIndex = headerRowIndex + 1; rowIndex < data.length; rowIndex++) {
    const row = data[rowIndex];
    if (!row) continue;

    if (isPaymentRow(row, statusCol, nameCol)) {
      if (isCancelledPayment(row, statusCol)) continue;

      const amount = parseAmount(row[amountCol]);
      if (amount === null || amount === 0) continue;

      const dateInfo =
        dateCol >= 0 ? parseExcelDate(row[dateCol], meta.year) : { confident: false };

      pending = {
        amount,
        dateInfo,
        row_ref: `row ${rowIndex + 1}`,
      };
      continue;
    }

    const dealName = String(row[dealCol] || "").trim();
    if (!pending || !dealName || dealName === "Сделка:") continue;

    const hyperlink = getCellHyperlink(meta, rowIndex, dealCol);
    const dealId = extractDealId(hyperlink || dealName);
    if (!dealId) {
      pending = null;
      continue;
    }

    let dateInfo = pending.dateInfo;
    if (!dateInfo?.confident) {
      const fromName = parseDateFromName(dealName, meta.year);
      if (fromName.confident) {
        dateInfo = fromName;
      } else {
        const fromSheet = parseSheetNameDate(meta.tab, meta.year);
        if (fromSheet) dateInfo = fromSheet;
      }
    }

    records.push({
      deal_id: dealId,
      deal_name: dealName,
      source: meta.source,
      amount: pending.amount,
      date_info: dateInfo,
      spreadsheet: meta.spreadsheet,
      tab: meta.tab,
      row_ref: `${pending.row_ref} + row ${rowIndex + 1}`,
    });
    pending = null;
  }

  return records;
}

export { parseBeznalSheet };
