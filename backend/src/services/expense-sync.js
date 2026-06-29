import { getDb } from '../db/connection.js';
import { EXPENSE_FIELDS } from './expense-field-names.js';
import { runDealCentricPipeline } from './deal-expenses/pipeline.js';
import { fetchSpreadsheetWorkbook } from './deal-expenses/sheets-reader.js';
import { parseSpreadsheetId } from './deal-expenses/spreadsheet-id.js';
import { loadBeznalWorkbook } from './deal-expenses/beznal-storage.js';
import { getPrintSheetClient } from './print-sheet-client.js';
import { requireTwentyConfig } from './twenty-config.js';
import { gql, assertHttpSuccess, assertGqlSuccess } from './twenty-gql.js';

const DEFAULT_SKIP_SHEET_PATTERNS = ['^болванка', '^Болванка', '^Стата', 'копия'];

const SOURCE_SETTINGS = {
  field_team: { type: 'column_layout', settingKey: 'expense_sheet_field_team' },
  printing: { type: 'row_layout', settingKey: 'expense_sheet_printing' },
  milling: { type: 'row_layout', settingKey: 'expense_sheet_milling' },
  logistics: { type: 'row_layout_logistics', settingKey: 'expense_sheet_logistics' },
  beznal: { type: 'beznal_layout', settingKey: 'expense_sheet_beznal' },
};

const UPDATE_OPPORTUNITY_EXPENSES_MUTATION = `
  mutation UpdateOpportunityExpenses($id: ID!, $input: OpportunityUpdateInput!) {
    updateOpportunity(id: $id, data: $input) { id }
  }
`;

function toRubCurrency(value) {
  return {
    amountMicros: Math.round((Number(value) || 0) * 1_000_000),
    currencyCode: 'RUB',
  };
}

function reportProgress(onProgress, payload) {
  if (typeof onProgress === 'function') {
    onProgress(payload);
  }
}

export function buildExpenseUpdateInput({ amounts }) {
  const safeAmounts = amounts || {};
  const total =
    (safeAmounts.field_team || 0) +
    (safeAmounts.printing || 0) +
    (safeAmounts.milling || 0) +
    (safeAmounts.logistics || 0) +
    (safeAmounts.beznal || 0);

  return {
    [EXPENSE_FIELDS.fieldTeam]: toRubCurrency(safeAmounts.field_team),
    [EXPENSE_FIELDS.printing]: toRubCurrency(safeAmounts.printing),
    [EXPENSE_FIELDS.milling]: toRubCurrency(safeAmounts.milling),
    [EXPENSE_FIELDS.logistics]: toRubCurrency(safeAmounts.logistics),
    [EXPENSE_FIELDS.beznal]: toRubCurrency(safeAmounts.beznal),
    [EXPENSE_FIELDS.total]: toRubCurrency(total),
    [EXPENSE_FIELDS.syncedAt]: new Date().toISOString(),
  };
}

export function loadTargetDeals(db) {
  return db.prepare(`
    SELECT id, twenty_id, crm_lead_id
    FROM deals
    WHERE twenty_id IS NOT NULL
      AND crm_lead_id IS NOT NULL
      AND TRIM(crm_lead_id) != ''
  `).all();
}

export function loadExpenseSourceSettings(db) {
  const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
  return Object.fromEntries(
    Object.entries(SOURCE_SETTINGS).map(([sourceKey, config]) => {
      const raw = getSetting.get(config.settingKey)?.value || '';
      const spreadsheetId = parseSpreadsheetId(raw);
      return [sourceKey, { type: config.type, spreadsheetId }];
    }),
  );
}

export function countDealsWithExpenses(deal) {
  const total = Object.values(deal?.amounts || {}).reduce((sum, value) => sum + (Number(value) || 0), 0);
  return total > 0;
}

export async function runExpenseSync({ trigger = 'manual', onProgress } = {}) {
  const twenty = requireTwentyConfig();
  const db = getDb();
  const targets = loadTargetDeals(db);

  if (targets.length === 0) {
    return {
      dealsTargeted: 0,
      dealsUpdated: 0,
      dealsWithExpenses: 0,
      errors: [],
    };
  }

  reportProgress(onProgress, { stage: 'sources_loading', trigger, dealsTargeted: targets.length });

  const sources = loadExpenseSourceSettings(db);
  const sheetsClient = getPrintSheetClient();
  const sourceWorkbooks = new Map();

  for (const [sourceKey, sourceConfig] of Object.entries(sources)) {
    if (sourceKey === 'beznal') {
      if (sourceConfig.spreadsheetId) {
        if (!sheetsClient) continue;
        const workbook = await fetchSpreadsheetWorkbook(sheetsClient, sourceConfig.spreadsheetId);
        if (workbook) sourceWorkbooks.set(sourceKey, workbook);
      } else {
        const workbook = loadBeznalWorkbook();
        if (workbook) sourceWorkbooks.set(sourceKey, workbook);
      }
      continue;
    }

    if (!sourceConfig.spreadsheetId || !sheetsClient) continue;
    const workbook = await fetchSpreadsheetWorkbook(sheetsClient, sourceConfig.spreadsheetId);
    if (workbook) sourceWorkbooks.set(sourceKey, workbook);
  }

  const targetDealIds = targets.map((row) => String(row.crm_lead_id).trim());

  const pipelineResult = runDealCentricPipeline({
    sources,
    targetDealIds,
    skipSheetPatterns: DEFAULT_SKIP_SHEET_PATTERNS,
    readSource(sourceKey) {
      return sourceWorkbooks.get(sourceKey) || null;
    },
  });

  const crmLeadToTwentyId = new Map(
    targets.map((row) => [String(row.crm_lead_id).trim(), row.twenty_id]),
  );
  const dealsWithExpenses = pipelineResult.deals.filter(countDealsWithExpenses).length;
  let dealsUpdated = 0;
  const errors = [];

  reportProgress(onProgress, {
    stage: 'updating_twenty',
    trigger,
    dealsTargeted: targets.length,
    dealsWithExpenses,
  });

  for (const deal of pipelineResult.deals) {
    const crmLeadId = String(deal.deal_id);
    const twentyId = crmLeadToTwentyId.get(crmLeadId);
    if (!twentyId) {
      errors.push(`Deal ${crmLeadId}: missing twenty_id mapping`);
      continue;
    }

    try {
      const resp = await gql(
        twenty.apiUrl,
        twenty.apiToken,
        UPDATE_OPPORTUNITY_EXPENSES_MUTATION,
        {
          id: twentyId,
          input: buildExpenseUpdateInput({ amounts: deal.amounts }),
        },
      );
      assertHttpSuccess(resp, twenty.apiUrl);
      assertGqlSuccess(resp, `Failed to update expenses for Twenty opportunity ${twentyId}`);
      dealsUpdated += 1;
    } catch (err) {
      errors.push(`Deal ${crmLeadId}: ${err.message}`);
    }
  }

  return {
    dealsTargeted: targets.length,
    dealsUpdated,
    dealsWithExpenses,
    errors,
  };
}
