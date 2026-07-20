import { describe, it, expect } from 'vitest';
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
} from '../src/services/twenty-export.js';

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
    kommentariy: 'ок',
    kommentariyDlyaPechati: null,
    kolichestvo: 2,
    amount: { amountMicros: 1_000_000 },
    ssylkaNaMakety: { primaryLinkUrl: 'https://disk.example/m' },
    opportunity: {
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

  it('returns null lineSum when quantity missing', () => {
    const row = mapLineItemToRow(
      { ...base, kolichestvo: null },
      { from: '2026-06-01', to: '2026-06-30', includeCancelled: false }
    );
    expect(row.quantity).toBeNull();
    expect(row.lineSum).toBeNull();
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
    ]);
    expect(sheet.getRow(2).getCell(1).value).toBe('04.06.2026');
    expect(sheet.getRow(2).getCell(4).value).toEqual({
      text: 'https://disk.example/m',
      hyperlink: 'https://disk.example/m',
    });
  });

  it('writes headers only when rows empty', async () => {
    const buffer = await buildTwentyExportWorkbook([]);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    expect(wb.getWorksheet('Заказы').rowCount).toBe(1);
  });
});
