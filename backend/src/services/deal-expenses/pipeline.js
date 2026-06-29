import { parseColumnLayoutSheet } from "./readers/columnLayout.js";
import { parseRowLayoutSheet } from "./readers/rowLayout.js";
import { parseLogisticsSheet } from "./readers/rowLayoutLogistics.js";
import { parseBeznalSheet } from "./readers/beznalLayout.js";

const SOURCE_LABELS = {
  field_team: "Выездная команда",
  printing: "Печать",
  milling: "Фрезеровка",
  logistics: "Логистика",
  beznal: "Безнал",
};

const PARSERS = {
  column_layout: parseColumnLayoutSheet,
  row_layout: parseRowLayoutSheet,
  row_layout_logistics: parseLogisticsSheet,
  beznal_layout: parseBeznalSheet,
};

export function shouldSkipSheet(sheetName, patterns) {
  return patterns.some((p) => new RegExp(p, "i").test(sheetName));
}

function createEmptyAmounts(sourceKeys) {
  return Object.fromEntries(sourceKeys.map((k) => [k, 0]));
}

export function aggregateDealsForTargets(records, targetDealIds, sourceKeys) {
  const targetSet = new Set(targetDealIds.map(String));
  const deals = new Map();

  for (const record of records) {
    if (!record.deal_id || !targetSet.has(String(record.deal_id))) continue;
    if (!deals.has(record.deal_id)) {
      deals.set(record.deal_id, {
        deal_id: record.deal_id,
        amounts: createEmptyAmounts(sourceKeys),
      });
    }
    const deal = deals.get(record.deal_id);
    deal.amounts[record.source] += record.amount;
  }
  return [...deals.values()];
}

export function parseWorkbookTabs(workbook, sourceKey, sourceConfig, skipPatterns) {
  const parser = PARSERS[sourceConfig.type];
  const allRecords = [];
  for (const sheetName of workbook.SheetNames) {
    if (shouldSkipSheet(sheetName, skipPatterns)) continue;
    const { data, sheet, hyperlinks } = workbook.getSheetMeta(sheetName);
    const records = parser(data, {
      source: sourceKey,
      spreadsheet: workbook.name || sourceKey,
      tab: sheetName,
      sheet,
      hyperlinks,
      sourceConfig,
    });
    allRecords.push(...records);
  }
  return allRecords;
}

export function runDealCentricPipeline({ sources, targetDealIds, skipSheetPatterns = [], readSource }) {
  const sourceKeys = Object.keys(sources);
  const allRecords = [];

  for (const [sourceKey, sourceConfig] of Object.entries(sources)) {
    const workbook = readSource(sourceKey, sourceConfig);
    if (!workbook) continue;
    const parsed = parseWorkbookTabs(workbook, sourceKey, sourceConfig, skipSheetPatterns);
    allRecords.push(...parsed);
  }

  const aggregated = aggregateDealsForTargets(allRecords, targetDealIds, sourceKeys);

  const byId = new Map(aggregated.map((d) => [String(d.deal_id), d]));
  for (const id of targetDealIds) {
    if (!byId.has(String(id))) {
      byId.set(String(id), { deal_id: String(id), amounts: createEmptyAmounts(sourceKeys) });
    }
  }

  return {
    deals: [...byId.values()],
    sourceKeys,
    sourceLabels: Object.fromEntries(sourceKeys.map((k) => [k, SOURCE_LABELS[k] || k])),
    stats: {
      parsed_rows: allRecords.length,
      matched_rows: allRecords.filter((r) => targetDealIds.includes(String(r.deal_id))).length,
      deals: byId.size,
    },
  };
}

export { SOURCE_LABELS };
