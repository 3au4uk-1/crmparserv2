import { describe, it, expect, beforeEach } from 'vitest';
import ExcelJS from 'exceljs';
import {
  extractLinkUrl,
  amountMicrosToNumber,
  resolveEffectiveDate,
  resolveEffectiveStage,
  resolveStageLabel,
  resolveComment,
  mapLineItemToRow,
  sortExportRows,
  buildTwentyExportWorkbook,
  fetchAllDealLineItems,
  buildRowsFromLineItems,
  runTwentyExport,
  attachDealExpensesOnce,
  TWENTY_EXPORT_COLUMNS,
  resolveExportColumns,
  buildDealExportRows,
} from '../src/services/twenty-export.js';
import {
  createExportJob,
  getExportJob,
  resetExportJobsForTests,
} from '../src/services/export-jobs.js';
import { EXPENSE_FIELDS } from '../src/services/expense-field-names.js';

describe('extractLinkUrl', () => {
  it('reads primaryLinkUrl', () => {
    expect(extractLinkUrl({ primaryLinkUrl: 'https://a.example' })).toBe('https://a.example');
  });
  it('returns empty for null', () => {
    expect(extractLinkUrl(null)).toBe('');
  });
});

describe('amountMicrosToNumber', () => {
  it('converts micros to rubles', () => {
    expect(amountMicrosToNumber({ amountMicros: 1_500_000 })).toBe(1.5);
  });
  it('returns null when missing', () => {
    expect(amountMicrosToNumber(null)).toBeNull();
  });
});

describe('resolveEffectiveDate', () => {
  it('prefers closeDate over loadDate', () => {
    expect(
      resolveEffectiveDate({ closeDate: '2026-06-05', loadDate: '2026-06-01' })
    ).toBe('2026-06-05');
  });
  it('falls back to loadDate', () => {
    expect(resolveEffectiveDate({ closeDate: null, loadDate: '2026-06-01' })).toBe('2026-06-01');
  });
  it('returns null when both empty', () => {
    expect(resolveEffectiveDate({ closeDate: null, loadDate: null })).toBeNull();
  });
});

describe('resolveEffectiveStage / label', () => {
  it('prefers line item stage', () => {
    expect(resolveEffectiveStage({ stage: 'V_PECHATI' }, { stage: 'NOVYY' })).toBe('V_PECHATI');
  });
  it('falls back to opportunity stage', () => {
    expect(resolveEffectiveStage({ stage: null }, { stage: 'GOTOVO' })).toBe('GOTOVO');
  });
  it('maps known stage to Russian label', () => {
    expect(resolveStageLabel('OTMENA')).toBe('Отмена');
  });
});

describe('resolveComment', () => {
  it('prefers kommentariy', () => {
    expect(
      resolveComment({ kommentariy: 'A', kommentariyDlyaPechati: 'B' })
    ).toBe('A');
  });
  it('falls back to print comment', () => {
    expect(
      resolveComment({ kommentariy: '', kommentariyDlyaPechati: 'B' })
    ).toBe('B');
  });
});

describe('mapLineItemToRow', () => {
  const base = {
    name: 'Баннер',
    stage: 'NOVYY',
    productStream: ['BRANDING'],
    kommentariy: 'ок',
    kommentariyDlyaPechati: null,
    kolichestvo: 2,
    amount: { amountMicros: 1_000_000 },
    ssylkaNaMakety: { primaryLinkUrl: 'https://disk.example/m' },
    opportunity: {
      id: 'opp-1',
      name: 'АРЕНДА/тест',
      closeDate: '2026-06-04',
      loadDate: '2026-06-01',
      stage: 'V_RABOTE',
      tonyLink: { primaryLinkUrl: 'https://tony.example/1' },
      bitrixLink: { primaryLinkUrl: 'https://bitrix.example/1' },
    },
  };

  it('maps full row', () => {
    const row = mapLineItemToRow(base, {
      from: '2026-06-01',
      to: '2026-06-30',
      includeCancelled: false,
    });
    expect(row).toMatchObject({
      date: '2026-06-04',
      dateDisplay: '04.06.2026',
      opportunityName: 'АРЕНДА/тест',
      positionName: 'Баннер',
      layoutUrl: 'https://disk.example/m',
      comment: 'ок',
      unitPrice: 1,
      quantity: 2,
      lineSum: 2,
      statusLabel: 'Новый',
      tonyUrl: 'https://tony.example/1',
      bitrixUrl: 'https://bitrix.example/1',
    });
  });

  it('skips outside range', () => {
    expect(
      mapLineItemToRow(base, { from: '2026-07-01', to: '2026-07-31', includeCancelled: false })
    ).toBeNull();
  });

  it('skips cancelled unless includeCancelled', () => {
    const cancelled = {
      ...base,
      stage: 'OTMENA',
      opportunity: { ...base.opportunity, stage: 'OTMENA' },
    };
    expect(
      mapLineItemToRow(cancelled, { from: '2026-06-01', to: '2026-06-30', includeCancelled: false })
    ).toBeNull();
    expect(
      mapLineItemToRow(cancelled, { from: '2026-06-01', to: '2026-06-30', includeCancelled: true })
    ).not.toBeNull();
  });

  const restorationList = [{ id: 1, pattern: 'баннер', matchType: 'substring' }];

  it('skips restoration match by default', () => {
    expect(
      mapLineItemToRow(base, {
        from: '2026-06-01',
        to: '2026-06-30',
        includeCancelled: false,
        restorationList,
      }),
    ).toBeNull();
  });

  it('includes restoration when includeRestoration is true', () => {
    expect(
      mapLineItemToRow(base, {
        from: '2026-06-01',
        to: '2026-06-30',
        includeCancelled: false,
        includeRestoration: true,
        restorationList,
      }),
    ).not.toBeNull();
  });

  it('does not skip when restoration list is empty', () => {
    expect(
      mapLineItemToRow(base, {
        from: '2026-06-01',
        to: '2026-06-30',
        includeCancelled: false,
        restorationList: [],
      }),
    ).not.toBeNull();
  });

  it('keeps branding and branding mixed with decor', () => {
    expect(
      mapLineItemToRow(
        { ...base, productStream: 'BRANDING' },
        { from: '2026-06-01', to: '2026-06-30', includeCancelled: false },
      ),
    ).not.toBeNull();
    expect(
      mapLineItemToRow(
        { ...base, productStream: ['DECOR', 'BRANDING'] },
        { from: '2026-06-01', to: '2026-06-30', includeCancelled: false },
      ),
    ).not.toBeNull();
  });

  it('skips decor, mk, and items without a branding stream', () => {
    const range = { from: '2026-06-01', to: '2026-06-30', includeCancelled: false };
    expect(mapLineItemToRow({ ...base, productStream: ['DECOR'] }, range)).toBeNull();
    expect(mapLineItemToRow({ ...base, productStream: ['MK'] }, range)).toBeNull();
    expect(mapLineItemToRow({ ...base, productStream: ['DECOR', 'MK'] }, range)).toBeNull();
    expect(mapLineItemToRow({ ...base, productStream: null }, range)).toBeNull();
    expect(mapLineItemToRow({ ...base, productStream: [] }, range)).toBeNull();
  });

  it('returns null lineSum when quantity missing', () => {
    const row = mapLineItemToRow(
      { ...base, kolichestvo: null },
      { from: '2026-06-01', to: '2026-06-30', includeCancelled: false }
    );
    expect(row.quantity).toBeNull();
    expect(row.lineSum).toBeNull();
  });

  it('maps opportunity id and expense amounts from micros', () => {
    const row = mapLineItemToRow(
      {
        ...base,
        opportunity: {
          ...base.opportunity,
          id: 'opp-1',
          rashodPechat: { amountMicros: 10_000_000 },
          rashodFrezerovka: { amountMicros: 20_000_000 },
          rashodLogistika: { amountMicros: 5_000_000 },
          rashodVyezdnayaKomanda: { amountMicros: 30_000_000 },
          rashodBeznal: { amountMicros: 35_000_000 },
          rashodItogo: { amountMicros: 100_000_000 },
        },
      },
      { from: '2026-06-01', to: '2026-06-30', includeCancelled: false }
    );
    expect(row.opportunityId).toBe('opp-1');
    expect(row.rashodPechat).toBe(10);
    expect(row.rashodFrezerovka).toBe(20);
    expect(row.rashodLogistika).toBe(5);
    expect(row.rashodVyezdnayaKomanda).toBe(30);
    expect(row.rashodBeznal).toBe(35);
    expect(row.rashodItogo).toBe(100);
  });

  it('maps missing expenses to null, not zero', () => {
    const row = mapLineItemToRow(base, {
      from: '2026-06-01',
      to: '2026-06-30',
      includeCancelled: false,
    });
    expect(row.opportunityId).toBe('opp-1');
    expect(expenseSlice(row)).toEqual(EXPENSE_NULL);
  });

  it('does not recompute rashodItogo from articles', () => {
    const row = mapLineItemToRow(
      {
        ...base,
        opportunity: {
          ...base.opportunity,
          id: 'opp-1',
          rashodPechat: { amountMicros: 10_000_000 },
          rashodItogo: { amountMicros: 1_000_000 },
        },
      },
      { from: '2026-06-01', to: '2026-06-30', includeCancelled: false }
    );
    expect(row.rashodItogo).toBe(1);
    expect(row.rashodPechat).toBe(10);
  });

  it('maps deal amount from opportunity amount micros', () => {
    const row = mapLineItemToRow(
      {
        ...base,
        opportunity: {
          ...base.opportunity,
          amount: { amountMicros: 250_000_000 },
        },
      },
      { from: '2026-06-01', to: '2026-06-30', includeCancelled: false }
    );
    expect(row.amountDeal).toBe(250);
  });

  it('maps missing deal amount to null, not zero', () => {
    const row = mapLineItemToRow(base, {
      from: '2026-06-01',
      to: '2026-06-30',
      includeCancelled: false,
    });
    expect(row.amountDeal).toBeNull();
  });
});

function expenseSlice(row) {
  return {
    rashodPechat: row.rashodPechat,
    rashodFrezerovka: row.rashodFrezerovka,
    rashodLogistika: row.rashodLogistika,
    rashodVyezdnayaKomanda: row.rashodVyezdnayaKomanda,
    rashodBeznal: row.rashodBeznal,
    rashodItogo: row.rashodItogo,
  };
}

const EXPENSE_100 = {
  rashodPechat: 10,
  rashodFrezerovka: 20,
  rashodLogistika: 5,
  rashodVyezdnayaKomanda: 30,
  rashodBeznal: 35,
  rashodItogo: 100,
};

const EXPENSE_NULL = {
  rashodPechat: null,
  rashodFrezerovka: null,
  rashodLogistika: null,
  rashodVyezdnayaKomanda: null,
  rashodBeznal: null,
  rashodItogo: null,
};

const EXPENSE_ROW_KEYS = [
  EXPENSE_FIELDS.printing,
  EXPENSE_FIELDS.milling,
  EXPENSE_FIELDS.logistics,
  EXPENSE_FIELDS.fieldTeam,
  EXPENSE_FIELDS.beznal,
  EXPENSE_FIELDS.total,
];

describe('expense field names', () => {
  it('uses EXPENSE_FIELDS for the six row keys (minus syncedAt)', () => {
    expect(EXPENSE_ROW_KEYS).toEqual([
      'rashodPechat',
      'rashodFrezerovka',
      'rashodLogistika',
      'rashodVyezdnayaKomanda',
      'rashodBeznal',
      'rashodItogo',
    ]);
    expect(
      new Set(Object.values(EXPENSE_FIELDS).filter((name) => name !== EXPENSE_FIELDS.syncedAt))
    ).toEqual(new Set(EXPENSE_ROW_KEYS));
    expect(EXPENSE_ROW_KEYS).not.toContain(EXPENSE_FIELDS.syncedAt);
  });
});

describe('attachDealExpensesOnce', () => {
  it('keeps expenses only on the first row of the same opportunityId', () => {
    const rows = attachDealExpensesOnce([
      { opportunityId: 'a', positionName: '1', ...EXPENSE_100 },
      { opportunityId: 'a', positionName: '2', ...EXPENSE_100 },
    ]);
    expect(expenseSlice(rows[0])).toEqual(EXPENSE_100);
    expect(expenseSlice(rows[1])).toEqual(EXPENSE_NULL);
  });

  it('keeps expenses only on the first occurrence when the same opportunityId is non-contiguous', () => {
    const rows = attachDealExpensesOnce([
      { opportunityId: 'a', positionName: '1', ...EXPENSE_100 },
      { opportunityId: 'b', positionName: '2', rashodItogo: 7, rashodPechat: 7, rashodFrezerovka: null, rashodLogistika: null, rashodVyezdnayaKomanda: null, rashodBeznal: null },
      { opportunityId: 'a', positionName: '3', ...EXPENSE_100 },
    ]);
    expect(expenseSlice(rows[0])).toEqual(EXPENSE_100);
    expect(rows[1].rashodItogo).toBe(7);
    expect(expenseSlice(rows[2])).toEqual(EXPENSE_NULL);
  });

  it('does not merge different ids with the same name', () => {
    const rows = attachDealExpensesOnce([
      { opportunityId: 'a', opportunityName: 'Same', ...EXPENSE_100 },
      { opportunityId: 'b', opportunityName: 'Same', rashodItogo: 7, rashodPechat: 7, rashodFrezerovka: null, rashodLogistika: null, rashodVyezdnayaKomanda: null, rashodBeznal: null },
    ]);
    expect(rows[0].rashodItogo).toBe(100);
    expect(rows[1].rashodItogo).toBe(7);
  });

  it('does not group two rows that both lack opportunityId', () => {
    const rows = attachDealExpensesOnce([
      { opportunityId: null, rashodItogo: 1, rashodPechat: null, rashodFrezerovka: null, rashodLogistika: null, rashodVyezdnayaKomanda: null, rashodBeznal: null },
      { opportunityId: null, rashodItogo: 2, rashodPechat: null, rashodFrezerovka: null, rashodLogistika: null, rashodVyezdnayaKomanda: null, rashodBeznal: null },
    ]);
    expect(rows[0].rashodItogo).toBe(1);
    expect(rows[1].rashodItogo).toBe(2);
  });

  it('keeps amountDeal only on the first row of the same opportunityId', () => {
    const rows = attachDealExpensesOnce([
      { opportunityId: 'a', amountDeal: 250, ...EXPENSE_100 },
      { opportunityId: 'a', amountDeal: 250, ...EXPENSE_100 },
    ]);
    expect(rows[0].amountDeal).toBe(250);
    expect(rows[1].amountDeal).toBeNull();
  });
});

describe('sortExportRows', () => {
  it('sorts by date, name, position', () => {
    const rows = sortExportRows([
      { date: '2026-06-02', opportunityName: 'B', positionName: 'z' },
      { date: '2026-06-01', opportunityName: 'A', positionName: 'b' },
      { date: '2026-06-01', opportunityName: 'A', positionName: 'a' },
    ]);
    expect(rows.map((r) => r.positionName)).toEqual(['a', 'b', 'z']);
  });
});

describe('buildTwentyExportWorkbook', () => {
  it('writes Russian headers and one data row with hyperlinks', async () => {
    const buffer = await buildTwentyExportWorkbook([
      {
        dateDisplay: '04.06.2026',
        opportunityName: 'Заказ',
        positionName: 'Баннер',
        layoutUrl: 'https://disk.example/m',
        comment: 'коммент',
        unitPrice: 100,
        lineSum: 200,
        quantity: 2,
        statusLabel: 'Новый',
        tonyUrl: 'https://tony.example/1',
        bitrixUrl: 'https://bitrix.example/1',
        rashodPechat: 10,
        rashodFrezerovka: 20,
        rashodLogistika: 5,
        rashodVyezdnayaKomanda: 30,
        rashodBeznal: 35,
        rashodItogo: 100,
        amountDeal: 250,
      },
    ]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const sheet = wb.getWorksheet('Заказы');
    expect(sheet.getRow(1).values.slice(1)).toEqual([
      'Дата',
      'Название',
      'Позиция',
      'Ссылка на макет',
      'Комментарий',
      'Цена за ед.',
      'Сумма позиции',
      'Количество',
      'Статус',
      'Ссылка на тони',
      'Ссылка на битрикс',
      'Расход: печать',
      'Расход: фреза',
      'Расход: логистика',
      'Расход: выездная команда',
      'Расход: безнал',
      'Расход итого',
      'Сумма сделки',
    ]);
    expect(sheet.getRow(2).getCell(1).value).toBe('04.06.2026');
    expect([12, 13, 14, 15, 16, 17, 18].map((col) => sheet.getRow(2).getCell(col).value)).toEqual([
      10, 20, 5, 30, 35, 100, 250,
    ]);
    expect(sheet.getRow(2).getCell(4).value).toEqual({
      text: 'https://disk.example/m',
      hyperlink: 'https://disk.example/m',
    });
  });

  it('leaves later-row expense cells empty, not zero', async () => {
    const baseRow = {
      dateDisplay: '04.06.2026',
      opportunityName: 'Заказ',
      positionName: 'Баннер',
      layoutUrl: '',
      comment: '',
      unitPrice: 100,
      lineSum: 200,
      quantity: 2,
      statusLabel: 'Новый',
      tonyUrl: '',
      bitrixUrl: '',
    };
    const buffer = await buildTwentyExportWorkbook([
      { ...baseRow, ...EXPENSE_100, amountDeal: 250 },
      { ...baseRow, positionName: 'Стикер', ...EXPENSE_NULL, amountDeal: null },
    ]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const sheet = wb.getWorksheet('Заказы');
    for (let col = 12; col <= 18; col += 1) {
      expect(sheet.getRow(3).getCell(col).value).not.toBe(0);
      expect(sheet.getRow(3).getCell(col).value == null).toBe(true);
    }
  });

  it('writes headers only when rows empty', async () => {
    const buffer = await buildTwentyExportWorkbook([]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    expect(wb.getWorksheet('Заказы').rowCount).toBe(1);
  });

  it('writes only selected columns in catalog order', async () => {
    const columns = resolveExportColumns(['amountDeal', 'opportunityName', 'date']);
    const buffer = await buildTwentyExportWorkbook(
      [
        {
          dateDisplay: '04.06.2026',
          opportunityName: 'Заказ',
          amountDeal: 250,
        },
      ],
      { columns }
    );
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const sheet = wb.getWorksheet('Заказы');
    expect(sheet.getRow(1).values.slice(1)).toEqual(['Дата', 'Название', 'Сумма сделки']);
    expect(sheet.getRow(2).values.slice(1)).toEqual(['04.06.2026', 'Заказ', 250]);
  });

  it('adds a deals sheet with deal-level columns only', async () => {
    const columns = resolveExportColumns([
      'date',
      'opportunityName',
      'positionName',
      'amountDeal',
    ]);
    const buffer = await buildTwentyExportWorkbook(
      [
        {
          opportunityId: 'a',
          dateDisplay: '04.06.2026',
          opportunityName: 'Заказ',
          positionName: 'Баннер',
          amountDeal: 250,
        },
        {
          opportunityId: 'a',
          dateDisplay: '04.06.2026',
          opportunityName: 'Заказ',
          positionName: 'Стикер',
          amountDeal: null,
        },
      ],
      { columns, includeDealsSheet: true }
    );
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    expect(wb.getWorksheet('Заказы').rowCount).toBe(3);
    const deals = wb.getWorksheet('Сделки');
    expect(deals.getRow(1).values.slice(1)).toEqual(['Дата', 'Название', 'Сумма сделки']);
    expect(deals.rowCount).toBe(2);
    expect(deals.getRow(2).values.slice(1)).toEqual(['04.06.2026', 'Заказ', 250]);
  });

  it('does not add a deals sheet unless requested', async () => {
    const buffer = await buildTwentyExportWorkbook([
      { dateDisplay: '04.06.2026', opportunityName: 'Заказ' },
    ]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    expect(wb.getWorksheet('Сделки')).toBeUndefined();
  });
});

describe('fetchAllDealLineItems', () => {
  it('paginates until hasNextPage false', async () => {
    const calls = [];
    async function fakeGql(_url, _token, _query, variables) {
      calls.push(variables);
      if (!variables.after) {
        return {
          data: {
            data: {
              dealLineItems: {
                edges: [{ node: { id: '1' } }, { node: { id: '2' } }],
                pageInfo: { hasNextPage: true, endCursor: 'c1' },
              },
            },
          },
        };
      }
      return {
        data: {
          data: {
            dealLineItems: {
              edges: [{ node: { id: '3' } }],
              pageInfo: { hasNextPage: false, endCursor: 'c2' },
            },
          },
        },
      };
    }

    const items = await fetchAllDealLineItems(fakeGql, 'http://gql', 'tok', {
      pageSize: 2,
    });

    expect(items.map((item) => item.id)).toEqual(['1', '2', '3']);
    expect(calls).toHaveLength(2);
    expect(calls[1].after).toBe('c1');
  });

  it('uses the last edge cursor when pageInfo is absent', async () => {
    const calls = [];
    const fakeGql = async (_url, _token, _query, variables) => {
      calls.push(variables);
      const firstPage = !variables.after;
      return {
        status: 200,
        data: {
          data: {
            dealLineItems: {
              edges: firstPage
                ? [
                    { cursor: 'c1', node: { id: '1' } },
                    { cursor: 'c2', node: { id: '2' } },
                  ]
                : [{ cursor: 'c3', node: { id: '3' } }],
            },
          },
        },
      };
    };

    const items = await fetchAllDealLineItems(fakeGql, 'http://gql', 'tok', {
      pageSize: 2,
    });

    expect(items.map((item) => item.id)).toEqual(['1', '2', '3']);
    expect(calls).toHaveLength(2);
    expect(calls[1].after).toBe('c2');
  });

  it('throws when dealLineItems connection is missing', async () => {
    const fakeGql = async () => ({
      status: 200,
      data: { data: {} },
    });

    await expect(
      fetchAllDealLineItems(fakeGql, 'http://gql', 'tok')
    ).rejects.toThrow('Twenty GraphQL response is missing dealLineItems');
  });

  it('throws on HTTP failure via assertHttpSuccess', async () => {
    const fakeGql = async () => ({ status: 500, data: {} });

    await expect(
      fetchAllDealLineItems(fakeGql, 'http://gql', 'tok')
    ).rejects.toThrow('Twenty API error: HTTP 500');
  });

  it('throws when hasNextPage is true without endCursor', async () => {
    const fakeGql = async () => ({
      status: 200,
      data: {
        data: {
          dealLineItems: {
            edges: [{ cursor: 'c1', node: { id: '1' } }],
            pageInfo: { hasNextPage: true, endCursor: null },
          },
        },
      },
    });

    await expect(
      fetchAllDealLineItems(fakeGql, 'http://gql', 'tok')
    ).rejects.toThrow(
      'Twenty GraphQL response has hasNextPage but is missing endCursor for dealLineItems'
    );
  });

  it('requests opportunity expense fields', async () => {
    let query = '';
    async function fakeGql(_url, _token, q) {
      query = q;
      return {
        status: 200,
        data: {
          data: {
            dealLineItems: {
              edges: [],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      };
    }
    await fetchAllDealLineItems(fakeGql, 'http://gql', 'tok');
    expect(query).toContain('rashodItogo');
    expect(query).toContain('rashodPechat');
    expect(query).toContain('rashodFrezerovka');
    expect(query).toContain('rashodLogistika');
    expect(query).toContain('rashodVyezdnayaKomanda');
    expect(query).toContain('rashodBeznal');
    expect(query).toContain('productStream');
    expect(query).not.toContain('rashodSyncedAt');
    expect(query).toMatch(/opportunity\s*\{[\s\S]*amount\s*\{\s*amountMicros/);
  });
});

describe('buildRowsFromLineItems', () => {
  it('maps and sorts', () => {
    const rows = buildRowsFromLineItems(
      [
        {
          name: 'B',
          stage: 'NOVYY',
          productStream: ['BRANDING'],
          kolichestvo: 1,
          amount: { amountMicros: 1_000_000 },
          opportunity: { name: 'Z', closeDate: '2026-06-02', stage: 'NOVYY' },
        },
        {
          name: 'A',
          stage: 'NOVYY',
          productStream: ['BRANDING'],
          kolichestvo: 1,
          amount: { amountMicros: 1_000_000 },
          opportunity: { name: 'Z', closeDate: '2026-06-01', stage: 'NOVYY' },
        },
      ],
      { from: '2026-06-01', to: '2026-06-30', includeCancelled: false }
    );

    expect(rows.map((row) => row.positionName)).toEqual(['A', 'B']);
  });
});

describe('buildRowsFromLineItems expenses', () => {
  it('writes deal expenses only on the first sorted row of a deal', () => {
    const rows = buildRowsFromLineItems(
      [
        {
          name: 'B',
          stage: 'NOVYY',
          productStream: ['BRANDING'],
          kolichestvo: 1,
          amount: { amountMicros: 1_000_000 },
          opportunity: {
            id: 'same',
            name: 'Z',
            closeDate: '2026-06-01',
            stage: 'NOVYY',
            rashodItogo: { amountMicros: 50_000_000 },
            amount: { amountMicros: 12_000_000 },
          },
        },
        {
          name: 'A',
          stage: 'NOVYY',
          productStream: ['BRANDING'],
          kolichestvo: 1,
          amount: { amountMicros: 1_000_000 },
          opportunity: {
            id: 'same',
            name: 'Z',
            closeDate: '2026-06-01',
            stage: 'NOVYY',
            rashodItogo: { amountMicros: 50_000_000 },
            amount: { amountMicros: 12_000_000 },
          },
        },
      ],
      { from: '2026-06-01', to: '2026-06-30', includeCancelled: false }
    );
    expect(rows.map((row) => row.positionName)).toEqual(['A', 'B']);
    expect(rows[0].rashodItogo).toBe(50);
    expect(rows[1].rashodItogo).toBeNull();
    expect(rows[0].amountDeal).toBe(12);
    expect(rows[1].amountDeal).toBeNull();
  });
});

describe('resolveExportColumns', () => {
  it('returns the full catalog when columns are omitted', () => {
    expect(resolveExportColumns()).toEqual(TWENTY_EXPORT_COLUMNS);
    expect(resolveExportColumns(null)).toEqual(TWENTY_EXPORT_COLUMNS);
    expect(resolveExportColumns([])).toEqual(TWENTY_EXPORT_COLUMNS);
  });

  it('keeps catalog order and drops unknown keys', () => {
    expect(() => resolveExportColumns(['amountDeal', 'nope'])).toThrow(
      'Неизвестные колонки: nope'
    );
    const resolved = resolveExportColumns(['amountDeal', 'date']);
    expect(resolved.map((c) => c.key)).toEqual(['date', 'amountDeal']);
  });
});

describe('buildDealExportRows', () => {
  it('keeps the first row of each opportunity', () => {
    const rows = buildDealExportRows([
      { opportunityId: 'a', opportunityName: 'A', amountDeal: 1 },
      { opportunityId: 'a', opportunityName: 'A', amountDeal: null },
      { opportunityId: 'b', opportunityName: 'B', amountDeal: 2 },
    ]);
    expect(rows.map((r) => r.opportunityId)).toEqual(['a', 'b']);
    expect(rows.map((r) => r.amountDeal)).toEqual([1, 2]);
  });
});

describe('runTwentyExport', () => {
  beforeEach(() => {
    resetExportJobsForTests();
  });

  it('marks the job failed when Twenty returns GraphQL errors', async () => {
    const job = createExportJob({
      from: '2026-06-01',
      to: '2026-06-30',
      kind: 'twenty',
    });

    await runTwentyExport(
      job.jobId,
      { from: job.from, to: job.to },
      {
        gqlFn: async () => ({
          status: 200,
          data: { errors: [{ message: 'Unknown field "dealLineItems"' }] },
        }),
        requireTwentyConfigFn: () => ({ apiUrl: 'http://gql', apiToken: 'tok' }),
      }
    );

    expect(getExportJob(job.jobId)).toMatchObject({
      status: 'failed',
      error: 'Unknown field "dealLineItems"',
    });
  });

  it('marks the job failed when the date range is invalid', async () => {
    const job = createExportJob({
      from: '2026-06-30',
      to: '2026-06-01',
      kind: 'twenty',
    });

    await runTwentyExport(job.jobId, { from: job.from, to: job.to });

    expect(getExportJob(job.jobId)).toMatchObject({
      status: 'failed',
      error: expect.any(String),
    });
  });

  it('marks the job failed when loadRestorationList throws', async () => {
    const job = createExportJob({
      from: '2026-06-01',
      to: '2026-06-30',
      kind: 'twenty',
    });

    await runTwentyExport(
      job.jobId,
      { from: job.from, to: job.to, includeRestoration: false },
      {
        gqlFn: async () => ({
          status: 200,
          data: {
            data: {
              dealLineItems: {
                edges: [],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        }),
        requireTwentyConfigFn: () => ({ apiUrl: 'http://gql', apiToken: 'tok' }),
        getDbFn: () => ({}),
        loadRestorationListFn: () => {
          throw new Error('db down');
        },
      }
    );

    const failed = getExportJob(job.jobId);
    expect(failed.status).toBe('failed');
    expect(failed.error).toEqual(expect.any(String));
    expect(failed.error.length).toBeGreaterThan(0);
    expect(failed.filePath).toBeNull();
  });

  it('keeps pagesFetched on completed jobs after multi-page fetch', async () => {
    const job = createExportJob({
      from: '2026-06-01',
      to: '2026-06-30',
      kind: 'twenty',
    });

    const lineItem = {
      name: 'Баннер',
      stage: 'NOVYY',
      productStream: ['BRANDING'],
      kolichestvo: 1,
      amount: { amountMicros: 1_000_000 },
      opportunity: { name: 'Test', closeDate: '2026-06-04', stage: 'NOVYY' },
    };

    async function fakeGql(_url, _token, _query, variables) {
      if (!variables.after) {
        return {
          status: 200,
          data: {
            data: {
              dealLineItems: {
                edges: [{ node: { ...lineItem, id: '1' } }],
                pageInfo: { hasNextPage: true, endCursor: 'c1' },
              },
            },
          },
        };
      }
      return {
        status: 200,
        data: {
          data: {
            dealLineItems: {
              edges: [{ node: { ...lineItem, id: '2' } }],
              pageInfo: { hasNextPage: false, endCursor: 'c2' },
            },
          },
        },
      };
    }

    await runTwentyExport(
      job.jobId,
      { from: job.from, to: job.to },
      {
        gqlFn: fakeGql,
        requireTwentyConfigFn: () => ({ apiUrl: 'http://gql', apiToken: 'tok' }),
        getDbFn: () => ({}),
        loadRestorationListFn: () => [],
      }
    );

    const completed = getExportJob(job.jobId);
    expect(completed).toMatchObject({
      status: 'completed',
      progress: {
        pagesFetched: 2,
        lineItemsFetched: 2,
        rowsWritten: 2,
      },
    });
  });
});
