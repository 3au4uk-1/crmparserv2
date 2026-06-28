import { describe, it, expect } from 'vitest';
import { buildPrintSheetRowValues } from '../src/services/print-sheet-row-builder.js';

describe('buildPrintSheetRowValues', () => {
  const lineItem = {
    name: 'Тайсон',
    kommentariy: 'пленка бб + лам',
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

  it('builds B–K array with 10 cells, skipping F internally as empty', () => {
    const row = buildPrintSheetRowValues(lineItem);
    expect(row).toEqual([
      'Про',
      'ПРО/27.06/ИП Рыбаков/Самолет Тайсон ЛСК',
      'https://prointeractive.bitrix24.ru/crm/deal/details/123/',
      'Тайсон',
      '',
      'https://disk.yandex.ru/mock',
      'Андрей Абалин',
      '27.06.2026',
      '10:00',
      'пленка бб + лам',
    ]);
  });

  it('leaves department empty when company unmapped', () => {
    const row = buildPrintSheetRowValues({
      ...lineItem,
      opportunity: { ...lineItem.opportunity, companyId: 'unknown' },
    });
    expect(row[0]).toBe('');
  });
});
