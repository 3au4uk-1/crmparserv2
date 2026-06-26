import { describe, it, expect } from 'vitest';
import {
  buildExportDealsFromEvent,
  filterExportItems,
} from '../src/services/historical-export.js';

const keywords = ['баннер', 'печать'];
const blacklist = [{ pattern: 'тест', matchType: 'substring' }];

describe('filterExportItems', () => {
  it('keeps keyword_match not in blacklist', () => {
    const items = [
      { name: 'Баннер 3x6', classification: 'keyword_match' },
      { name: 'тестовый баннер', classification: 'keyword_match' },
      { name: 'Кофе', classification: 'unclassified' },
    ];
    expect(filterExportItems(items, blacklist).map((i) => i.name)).toEqual(['Баннер 3x6']);
  });
});

describe('buildExportDealsFromEvent', () => {
  const event = {
    title: 'ПРО Иванов 12345 Конференция',
    start: '2025-03-15T10:00:00+03:00',
    department: 'Брендинг',
  };
  const eventId = 'evt-1';

  it('uses Tony items when order present', () => {
    const order = {
      items: [{ name: 'Баннер', price: 1000, quantity: '1', sum: 1000 }],
      budget: '5000',
      start_date: '2025-03-15',
    };
    const data = {
      bookingNumbers: ['12345'],
      calParsed: { items: [{ name: 'Кофе-брейк', price: 100 }], meta: {}, contact: {}, event: {} },
      tonyOrders: new Map([['12345', order]]),
    };
    const deals = buildExportDealsFromEvent(event, eventId, data, ['ПРО'], keywords, blacklist);
    expect(deals).toHaveLength(1);
    expect(deals[0].exportId).toBe('evt-1#12345');
    expect(deals[0].items[0].name).toBe('Баннер');
  });

  it('falls back to calendar items when no Tony order', () => {
    const data = {
      bookingNumbers: [],
      calParsed: {
        items: [{ name: 'Печать наклеек', price: 500 }],
        meta: { budget: '3000' },
        contact: {},
        event: {},
      },
      tonyOrders: new Map(),
    };
    const deals = buildExportDealsFromEvent(event, eventId, data, ['ПРО'], keywords, blacklist);
    expect(deals).toHaveLength(1);
    expect(deals[0].exportId).toBe('evt-1#cal');
    expect(deals[0].items[0].name).toBe('Печать наклеек');
  });

  it('skips deal with no keyword_match items', () => {
    const data = {
      bookingNumbers: [],
      calParsed: { items: [{ name: 'Кофе' }], meta: {}, contact: {}, event: {} },
      tonyOrders: new Map(),
    };
    expect(buildExportDealsFromEvent(event, eventId, data, ['ПРО'], keywords, blacklist)).toEqual([]);
  });

  it('filters by company when companyFilter set', () => {
    const data = {
      bookingNumbers: [],
      calParsed: { items: [{ name: 'Баннер' }], meta: { budget: '1' }, contact: {}, event: {} },
      tonyOrders: new Map(),
    };
    expect(
      buildExportDealsFromEvent(event, eventId, data, ['ПРО'], keywords, blacklist, 'АРТ')
    ).toEqual([]);
  });
});
