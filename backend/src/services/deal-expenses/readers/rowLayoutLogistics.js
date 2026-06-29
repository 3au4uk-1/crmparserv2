import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractDealId } from "../bitrix.js";
import { parseAmount } from "../amounts.js";
import { parseDateFromName, parseExcelDate } from "../dates.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadAllowedLogisticsUsers() {
  const filePath = path.join(__dirname, "../../../../config/expense-logistics-users.json");
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return [];
  }
}

const defaultAllowedUsers = loadAllowedLogisticsUsers();

function normalizeHeader(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function findHeaderRow(data) {
  for (let i = 0; i < Math.min(data.length, 30); i++) {
    const row = data[i].map(normalizeHeader);
    if (row.some((cell) => cell.includes("тарифный класс"))) return i;
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

function normalizePersonName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function isAllowedLogisticsUser(userName, allowedUsers) {
  if (!allowedUsers?.length) return true;

  const normalizedUser = normalizePersonName(userName);
  if (!normalizedUser) return false;

  return allowedUsers.some((allowed) => {
    const parts = normalizePersonName(allowed).split(" ");
    const surname = parts[0];
    const firstName = parts[1];
    return normalizedUser.startsWith(surname) && normalizedUser.includes(firstName);
  });
}

function parseLogisticsSheet(data, meta) {
  const records = [];
  const headerRowIndex = findHeaderRow(data);
  if (headerRowIndex < 0) return records;

  const headers = data[headerRowIndex];
  const dateCol = findColumn(headers, ["дата заказа"]);
  const amountCol = findColumn(headers, ["фактическая стоимость"]);
  const linkCol = findColumn(headers, ["ссылка на сделку"]);
  const detailCol = findColumn(headers, ["детализация"]);
  const userCol = findColumn(headers, ["имя пользователя"]);
  const allowedUsers = meta.sourceConfig?.allowed_users ?? defaultAllowedUsers;

  if (amountCol < 0 || linkCol < 0) return records;

  for (let rowIndex = headerRowIndex + 1; rowIndex < data.length; rowIndex++) {
    const row = data[rowIndex];
    if (!row) continue;

    const userName = userCol >= 0 ? row[userCol] : "";
    if (!isAllowedLogisticsUser(userName, allowedUsers)) continue;

    const linkCell = row[linkCol];
    const dealId = extractDealId(linkCell);
    const amount = parseAmount(row[amountCol]);
    const detail = String(row[detailCol] || "").trim();

    if (!dealId || amount === null || amount === 0) continue;

    let dateInfo = dateCol >= 0 ? parseExcelDate(row[dateCol], meta.year) : { confident: false };
    if (!dateInfo.confident) {
      const fromDetail = parseDateFromName(detail, meta.year);
      if (fromDetail.confident) dateInfo = fromDetail;
    }

    records.push({
      deal_id: dealId,
      deal_name: detail,
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

export { parseLogisticsSheet, loadAllowedLogisticsUsers, isAllowedLogisticsUser };
