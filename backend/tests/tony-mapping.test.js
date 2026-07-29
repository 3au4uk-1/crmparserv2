import { describe, it, expect } from 'vitest';
import {
  buildTonyDealFields,
  buildTonyItems,
  normalizeFreeEntryItem,
  tonyContentHash,
} from '../src/services/tony-mapping.js';

const parsed = {
  items: [
    { name: 'Навигационные наклейки', price: 2640, quantity: '9', discount: 0, sum: 23760, category: 'products' },
    { name: 'Монтажник', price: 5000, quantity: '1', discount: 0, sum: 5000, category: 'personnel' },
  ],
  dates: {
    loadDate: '16.06.2026', loadTime: '04:00',
    eventBegin: '16.06.2026', eventEnd: '17.06.2026',
    deinstallDate: '17.06.2026', deinstallTime: '01:00',
    workTimeBegin: '11:00', workTimeEnd: '21:00',
  },
  address: 'г Москва, Ленинградское шоссе, д 46',
  budget: 28760,
};

describe('tony-mapping', () => {
  it('maps dates and address to deal fields', () => {
    const f = buildTonyDealFields(parsed);
    expect(f.load_date).toBe('2026-06-16');
    expect(f.load_time).toBe('04:00');
    expect(f.start_date).toBe('2026-06-16T00:00:00+03:00');
    expect(f.end_date).toBe('2026-06-17T00:00:00+03:00');
    expect(f.dismantle_time).toBe('17.06.2026 01:00');
    expect(f.work_time).toBe('11:00-21:00');
    expect(f.address).toBe('г Москва, Ленинградское шоссе, д 46');
    expect(f.budget).toBe(28760);
  });

  it('builds item rows with sum, comment, and quantity_num', () => {
    const withComment = {
      ...parsed,
      items: parsed.items.map((i, idx) =>
        idx === 0 ? { ...i, comment: '+ монтаж' } : { ...i, comment: '' }
      ),
    };
    const items = buildTonyItems(withComment);
    expect(items[0]).toMatchObject({
      name: 'Навигационные наклейки',
      price: 2640,
      quantity: '9',
      discount: 0,
      sum: 23760,
      comment: '+ монтаж',
      quantity_num: 9,
    });
    expect(items[1]).toMatchObject({
      name: 'Монтажник',
      price: 5000,
      quantity: '1',
      discount: 0,
      sum: 5000,
      comment: '',
      quantity_num: 1,
    });
  });

  it('produces a stable hash that changes with content', () => {
    const h1 = tonyContentHash(parsed);
    const h2 = tonyContentHash(parsed);
    expect(h1).toBe(h2);
    const changed = { ...parsed, budget: 1 };
    expect(tonyContentHash(changed)).not.toBe(h1);
  });

  it('hash changes when comment or sum changes', () => {
    const withComment = {
      ...parsed,
      items: parsed.items.map((i, idx) =>
        idx === 0 ? { ...i, comment: '+ монтаж' } : { ...i, comment: '' }
      ),
    };
    const base = tonyContentHash(parsed);
    expect(tonyContentHash(withComment)).not.toBe(base);

    const sumChanged = {
      ...parsed,
      items: parsed.items.map((i, idx) => (idx === 0 ? { ...i, sum: 1 } : i)),
    };
    expect(tonyContentHash(sumChanged)).not.toBe(base);
  });

  const FREE_ENTRY_NAME =
    'БРЕНДИНГ свободная запись ( КОМЕНТАРИЙ ОБЯЗАТЕЛЕН )';

  describe('normalizeFreeEntryItem / free-entry in buildTonyItems', () => {
    it('uses comment as name and clears comment when free-entry has comment', () => {
      expect(
        normalizeFreeEntryItem({
          name: FREE_ENTRY_NAME,
          comment: 'Наклейка на зеркало',
          price: 5950,
        }),
      ).toEqual({
        name: 'Наклейка на зеркало',
        comment: '',
        price: 5950,
      });
    });

    it('keeps template name when free-entry comment is empty or whitespace', () => {
      expect(
        normalizeFreeEntryItem({
          name: FREE_ENTRY_NAME,
          comment: '   ',
          price: 0,
        }),
      ).toMatchObject({ name: FREE_ENTRY_NAME, comment: '' });
    });

    it('leaves ordinary items unchanged', () => {
      const item = {
        name: 'Навигационные наклейки',
        comment: '+ монтаж',
        price: 2640,
      };
      expect(normalizeFreeEntryItem(item)).toEqual(item);
    });

    it('buildTonyItems yields distinct names for two free-entry rows', () => {
      const items = buildTonyItems({
        items: [
          {
            name: FREE_ENTRY_NAME,
            price: 5950,
            quantity: '1',
            discount: 0,
            sum: 5950,
            category: 'products',
            comment: 'ПВХ',
          },
          {
            name: FREE_ENTRY_NAME,
            price: 5950,
            quantity: '1',
            discount: 0,
            sum: 5950,
            category: 'products',
            comment: 'Наклейка на зеркало',
          },
        ],
        dates: parsed.dates,
        address: '',
        budget: 11900,
      });

      expect(items.map((i) => i.name)).toEqual(['ПВХ', 'Наклейка на зеркало']);
      expect(items.every((i) => i.comment === '')).toBe(true);
    });

    it('detects free-entry case-insensitively', () => {
      expect(
        normalizeFreeEntryItem({
          name: 'Брендинг СВОБОДНАЯ ЗАПИСЬ (тест)',
          comment: 'Ролл-ап',
        }),
      ).toMatchObject({ name: 'Ролл-ап', comment: '' });
    });
  });
});
