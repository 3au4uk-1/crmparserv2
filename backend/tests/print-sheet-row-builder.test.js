import { describe, it, expect } from 'vitest';
import { buildPrintSheetRowValues } from '../src/services/print-sheet-row-builder.js';

describe('buildPrintSheetRowValues', () => {
  const lineItem = {
    name: 'Тайсон',
    kommentariy: 'общий комментарий из Tony',
    kommentariyDlyaPechati: 'пленка бб + лам по коп-ву',
    dataGotovnostiPechati: '2026-06-27',
    vremyaGotovnostiPechati: '10:00',
    ssylkaNaMakety: { primaryLinkUrl: 'https://disk.yandex.ru/mock' },
    updatedBy: { name: { firstName: 'Андрей', lastName: 'Абалин' } },
    opportunity: {
      name: 'ПРО/27.06/ИП Рыбаков/Самолет Тайсон ЛСК',
      companyId: '8814cccb-471e-4d05-90cb-261a9395ada8',
      bitrixLink: { primaryLinkUrl: 'https://prointeractive.bitrix24.ru/crm/deal/details/123/' },
    },
  };

  it('builds B–P array: print comment in column P, not general kommentariy', () => {
    const row = buildPrintSheetRowValues(lineItem);
    expect(row).toHaveLength(15);
    expect(row[0]).toBe('Про');
    expect(row[8]).toBe('10:00');
    expect(row[9]).toBe('');
    expect(row[14]).toBe('пленка бб + лам по коп-ву');
    expect(row).not.toContain('общий комментарий из Tony');
  });

  it('leaves department empty when company unmapped', () => {
    const row = buildPrintSheetRowValues({
      ...lineItem,
      opportunity: { ...lineItem.opportunity, companyId: 'unknown' },
    });
    expect(row[0]).toBe('');
  });

  it('resolves responsible via workspaceMemberId', () => {
    const row = buildPrintSheetRowValues(
      {
        ...lineItem,
        updatedBy: { workspaceMemberId: 'wm-1', name: 'ignored' },
      },
      {
        workspaceMemberById: {
          'wm-1': { name: { firstName: 'Василий', lastName: 'Добжанский' } },
        },
      }
    );
    expect(row[6]).toBe('Василий Добжанский');
  });

  it('writes restoration checkbox to column F', () => {
    const row = buildPrintSheetRowValues({
      ...lineItem,
      restavraciyaPechati: true,
    });
    expect(row[4]).toBe('TRUE');
  });

  it('writes FALSE to column F when restoration unchecked', () => {
    const row = buildPrintSheetRowValues(lineItem);
    expect(row[4]).toBe('FALSE');
  });
});
