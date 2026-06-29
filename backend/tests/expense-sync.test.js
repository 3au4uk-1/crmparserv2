import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';

let testDb;

const fetchSpreadsheetWorkbookMock = vi.fn();
const loadBeznalWorkbookMock = vi.fn();
const runDealCentricPipelineMock = vi.fn();
const gqlMock = vi.fn();
const getPrintSheetClientMock = vi.fn();
const requireTwentyConfigMock = vi.fn();

vi.mock('../src/db/connection.js', () => ({
  getDb: () => testDb,
}));

vi.mock('../src/services/deal-expenses/sheets-reader.js', () => ({
  fetchSpreadsheetWorkbook: (...args) => fetchSpreadsheetWorkbookMock(...args),
}));

vi.mock('../src/services/deal-expenses/beznal-storage.js', () => ({
  loadBeznalWorkbook: () => loadBeznalWorkbookMock(),
}));

vi.mock('../src/services/deal-expenses/pipeline.js', () => ({
  runDealCentricPipeline: (args) => runDealCentricPipelineMock(args),
}));

vi.mock('../src/services/print-sheet-client.js', () => ({
  getPrintSheetClient: () => getPrintSheetClientMock(),
}));

vi.mock('../src/services/twenty-config.js', () => ({
  requireTwentyConfig: () => requireTwentyConfigMock(),
}));

vi.mock('../src/services/twenty-gql.js', () => ({
  gql: (...args) => gqlMock(...args),
  assertHttpSuccess: (resp, apiUrl) => {
    if (resp.status >= 400) {
      throw new Error(`Twenty API error: HTTP ${resp.status} (${apiUrl})`);
    }
  },
  assertGqlSuccess: (resp, fallbackMessage) => {
    const errors = resp.data?.errors;
    if (errors?.length) {
      throw new Error(errors[0].message || fallbackMessage);
    }
  },
}));

import {
  buildExpenseUpdateInput,
  loadTargetDeals,
  runExpenseSync,
} from '../src/services/expense-sync.js';

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE deals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      twenty_id TEXT,
      crm_lead_id TEXT
    );
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  return db;
}

describe('expense-sync', () => {
  beforeEach(() => {
    testDb = createDb();
    fetchSpreadsheetWorkbookMock.mockReset();
    loadBeznalWorkbookMock.mockReset();
    runDealCentricPipelineMock.mockReset();
    gqlMock.mockReset();
    getPrintSheetClientMock.mockReset();
    requireTwentyConfigMock.mockReset();

    requireTwentyConfigMock.mockReturnValue({
      apiUrl: 'https://twenty.test/graphql',
      apiToken: 'token',
    });
    getPrintSheetClientMock.mockReturnValue({ spreadsheets: { get: vi.fn() } });
  });

  afterEach(() => {
    testDb.close();
  });

  it('buildExpenseUpdateInput maps source amounts to Twenty currency fields', () => {
    const input = buildExpenseUpdateInput({
      amounts: { field_team: 100, printing: 200, milling: 0, logistics: 50, beznal: 25 },
    });

    expect(input.rashodVyezdnayaKomanda.amountMicros).toBe(100_000_000);
    expect(input.rashodPechat.amountMicros).toBe(200_000_000);
    expect(input.rashodFrezerovka.amountMicros).toBe(0);
    expect(input.rashodLogistika.amountMicros).toBe(50_000_000);
    expect(input.rashodBeznal.amountMicros).toBe(25_000_000);
    expect(input.rashodItogo.amountMicros).toBe(375_000_000);
    expect(input.rashodSyncedAt).toBeTruthy();
  });

  it('loadTargetDeals returns only synced deals with crm_lead_id', () => {
    testDb.prepare('INSERT INTO deals (twenty_id, crm_lead_id) VALUES (?, ?)').run('opp-1', ' 101 ');
    testDb.prepare('INSERT INTO deals (twenty_id, crm_lead_id) VALUES (?, ?)').run('opp-2', '');
    testDb.prepare('INSERT INTO deals (twenty_id, crm_lead_id) VALUES (?, ?)').run(null, '102');
    testDb.prepare('INSERT INTO deals (twenty_id, crm_lead_id) VALUES (?, ?)').run('opp-4', null);

    const rows = loadTargetDeals(testDb);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ twenty_id: 'opp-1', crm_lead_id: ' 101 ' });
  });

  it('runExpenseSync uses readSource and updates all target deals', async () => {
    testDb.prepare('INSERT INTO deals (twenty_id, crm_lead_id) VALUES (?, ?)').run('opp-101', '101');
    testDb.prepare('INSERT INTO deals (twenty_id, crm_lead_id) VALUES (?, ?)').run('opp-102', '102');
    testDb.prepare('INSERT INTO deals (twenty_id, crm_lead_id) VALUES (?, ?)').run(null, '999');

    testDb.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
      'expense_sheet_field_team',
      '',
    );
    testDb.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
      'expense_sheet_printing',
      'https://docs.google.com/spreadsheets/d/print-id-123/edit#gid=0',
    );
    testDb.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
      'expense_sheet_milling',
      '',
    );
    testDb.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
      'expense_sheet_logistics',
      '',
    );
    testDb.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
      'expense_sheet_beznal',
      '',
    );

    fetchSpreadsheetWorkbookMock.mockResolvedValue({ name: 'printing-workbook' });
    loadBeznalWorkbookMock.mockReturnValue({ name: 'beznal-upload' });
    runDealCentricPipelineMock.mockImplementation(({ sources, targetDealIds, readSource }) => {
      expect(readSource('printing', sources.printing)).toEqual({ name: 'printing-workbook' });
      expect(readSource('beznal', sources.beznal)).toEqual({ name: 'beznal-upload' });

      return {
        deals: [
          {
            deal_id: targetDealIds[0],
            amounts: { field_team: 0, printing: 200, milling: 0, logistics: 0, beznal: 0 },
          },
          {
            deal_id: targetDealIds[1],
            amounts: { field_team: 0, printing: 0, milling: 0, logistics: 0, beznal: 0 },
          },
        ],
      };
    });
    gqlMock.mockResolvedValue({ status: 200, data: { data: { updateOpportunity: { id: 'ok' } } } });

    const stats = await runExpenseSync({ trigger: 'manual' });

    expect(fetchSpreadsheetWorkbookMock).toHaveBeenCalledTimes(1);
    expect(fetchSpreadsheetWorkbookMock.mock.calls[0][1]).toBe('print-id-123');
    expect(loadBeznalWorkbookMock).toHaveBeenCalledTimes(1);
    expect(runDealCentricPipelineMock).toHaveBeenCalledTimes(1);
    expect(gqlMock).toHaveBeenCalledTimes(2);
    expect(gqlMock.mock.calls[0][3].id).toBe('opp-101');
    expect(gqlMock.mock.calls[1][3].id).toBe('opp-102');
    expect(gqlMock.mock.calls[0][3].input).toEqual(
      expect.objectContaining({
        rashodVyezdnayaKomanda: expect.any(Object),
        rashodPechat: expect.any(Object),
        rashodFrezerovka: expect.any(Object),
        rashodLogistika: expect.any(Object),
        rashodBeznal: expect.any(Object),
        rashodItogo: expect.any(Object),
        rashodSyncedAt: expect.any(String),
      }),
    );

    expect(stats).toEqual({
      dealsTargeted: 2,
      dealsUpdated: 2,
      dealsWithExpenses: 1,
      errors: [],
    });
  });
});
