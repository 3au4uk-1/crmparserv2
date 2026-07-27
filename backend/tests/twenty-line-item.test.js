import { describe, it, expect } from 'vitest';
import {
  buildWarehouseItemCreateInput,
  buildLineItemCreateInput,
  buildLineItemUpdateInput,
} from '../src/services/twenty-line-item.js';

describe('twenty-line-item', () => {
  it('builds warehouse item with name only', () => {
    expect(buildWarehouseItemCreateInput('Наклейка')).toEqual({
      name: 'Наклейка',
      position: 'first',
    });
  });

  it('buildLineItemCreateInput includes istochnik PARSER', () => {
    const input = buildLineItemCreateInput(
      { name: 'Наклейка', price: 1000, quantity: '1' },
      'wh-001',
      'opp-456',
    );
    expect(input.istochnik).toBe('PARSER');
  });

  it('buildLineItemUpdateInput includes istochnik PARSER', () => {
    const input = buildLineItemUpdateInput({ name: 'Наклейка', price: 1000, quantity: '1' });
    expect(input.istochnik).toBe('PARSER');
  });
});

describe('Tony line items', () => {
  const tonyDeal = { data_source: 'tony' };
  const tonyItem = {
    name: 'Навигационные наклейки',
    price: 2640,
    quantity: '9',
    sum: 23760,
    comment: '+ монтаж',
    quantity_num: 9,
  };

  it('builds create input with kolichestvo, kommentariy, and effective amount', () => {
    const input = buildLineItemCreateInput(
      tonyItem, 'wh-001', 'opp-456', 'first', { deal: tonyDeal }
    );
    expect(input).toEqual({
      name: 'Навигационные наклейки',
      position: 'first',
      warehouseItemId: 'wh-001',
      opportunityId: 'opp-456',
      kolichestvo: 9,
      kommentariy: '+ монтаж',
      amount: { amountMicros: 2640000000, currencyCode: 'RUB' },
      istochnik: 'PARSER',
    });
  });

  it('omits kommentariy when comment is empty', () => {
    const input = buildLineItemCreateInput(
      { ...tonyItem, comment: '' }, 'wh-001', 'opp-456', 'first', { deal: tonyDeal }
    );
    expect(input.kommentariy).toBeUndefined();
  });

  it('effective price is 0 when sum is 0', () => {
    const input = buildLineItemCreateInput(
      { ...tonyItem, sum: 0, price: 100 }, 'wh-001', 'opp-456', 'first', { deal: tonyDeal }
    );
    expect(input.amount.amountMicros).toBe(0);
  });

  it('falls back to price * qty when sum is missing on Tony item', () => {
    const input = buildLineItemCreateInput(
      { ...tonyItem, sum: null, price: 100, quantity_num: 2 },
      'wh-001', 'opp-456', 'first', { deal: tonyDeal }
    );
    expect(input.amount.amountMicros).toBe(100_000_000);
    expect(input.kolichestvo).toBe(2);
  });

  it('builds update input for Tony items', () => {
    const input = buildLineItemUpdateInput(tonyItem, { deal: tonyDeal });
    expect(input).toEqual({
      kolichestvo: 9,
      kommentariy: '+ монтаж',
      amount: { amountMicros: 2640000000, currencyCode: 'RUB' },
      istochnik: 'PARSER',
    });
  });
});

describe('calendar line items', () => {
  const calendarDeal = { data_source: 'calendar' };

  it('uses kolichestvo from parsed quantity text', () => {
    const input = buildLineItemCreateInput(
      { name: 'Наклейка', price: 15000, quantity: '3 шт.' },
      'wh-001', 'opp-456', 'first', { deal: calendarDeal }
    );
    expect(input.kolichestvo).toBe(3);
    expect(input.amount.amountMicros).toBe(15000000000);
  });

  it('omits optional fields when missing price and quantity', () => {
    const input = buildLineItemCreateInput({ name: 'Баннер' }, 'wh-002', 'opp-456', 'first', { deal: calendarDeal });
    expect(input).toEqual({
      name: 'Баннер',
      position: 'first',
      warehouseItemId: 'wh-002',
      opportunityId: 'opp-456',
      kolichestvo: 1,
      amount: { amountMicros: 0, currencyCode: 'RUB' },
      istochnik: 'PARSER',
    });
  });

  it('builds update input with kolichestvo and amount', () => {
    const input = buildLineItemUpdateInput({ price: 30000, quantity: '5 шт.' }, { deal: calendarDeal });
    expect(input).toEqual({
      kolichestvo: 5,
      amount: { amountMicros: 30000000000, currencyCode: 'RUB' },
      istochnik: 'PARSER',
    });
  });
});

describe('restoration line items', () => {
  const restorationList = [{ id: 1, pattern: 'колесо фортуны', matchType: 'exact' }];
  const tonyDeal = { data_source: 'tony' };
  const item = {
    name: 'Колесо фортуны',
    price: 18900,
    quantity: '1',
    sum: 18900,
    quantity_num: 1,
  };

  it('builds create input with zero amount when restoration match', () => {
    const input = buildLineItemCreateInput(
      item, 'wh-001', 'opp-456', 'first', { deal: tonyDeal, restorationList }
    );
    expect(input.amount.amountMicros).toBe(0);
    expect(input.kolichestvo).toBe(1);
    expect(input.stage).toBeUndefined();
  });

  it('builds update input with zero amount when restoration match', () => {
    const input = buildLineItemUpdateInput(item, { deal: tonyDeal, restorationList });
    expect(input.amount.amountMicros).toBe(0);
  });
});

describe('tip rule line items', () => {
  it('sets tip+tipDetail from tipRules match', () => {
    const input = buildLineItemCreateInput(
      { name: 'Клише герб', quantity_num: 1, quantity: '1' },
      'wh',
      'opp',
      'first',
      {
        tipRules: [
          {
            pattern: 'клише',
            matchType: 'substring',
            tip: 'PODRYAD',
            tipDetail: 'KUVALDIN_KLISHE',
            priority: 50,
          },
        ],
      }
    );
    expect(input.tip).toBe('PODRYAD');
    expect(input.tipDetail).toBe('KUVALDIN_KLISHE');
  });

  it('defaults BANNERA tipDetail to KTO_EDET', () => {
    const input = buildLineItemCreateInput(
      { name: 'Баннер 3x6', quantity_num: 1, quantity: '1' },
      'wh',
      'opp',
      'first',
      {
        tipRules: [
          {
            pattern: 'баннер',
            matchType: 'substring',
            tip: 'BANNERA',
            tipDetail: null,
            priority: 100,
          },
        ],
      }
    );
    expect(input.tip).toBe('BANNERA');
    expect(input.tipDetail).toBe('KTO_EDET');
  });

  it('sets PODRYAD tipDetail to null when the matching rule has no detail', () => {
    const input = buildLineItemUpdateInput(
      { name: 'Подрядная работа', quantity_num: 1, quantity: '1' },
      {
        tipRules: [
          {
            pattern: 'подрядная',
            matchType: 'substring',
            tip: 'PODRYAD',
            tipDetail: null,
            priority: 100,
          },
        ],
      }
    );

    expect(input.tip).toBe('PODRYAD');
    expect(input).toHaveProperty('tipDetail', null);
  });

  it('omits tip fields when no rule matches', () => {
    const input = buildLineItemCreateInput(
      { name: 'Скотч', quantity_num: 1, quantity: '1' },
      'wh',
      'opp',
      'first',
      { tipRules: [] }
    );
    expect(input.tip).toBeUndefined();
    expect(input.tipDetail).toBeUndefined();
  });
});
