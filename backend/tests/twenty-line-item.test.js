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
    });
  });

  it('builds update input with kolichestvo and amount', () => {
    const input = buildLineItemUpdateInput({ price: 30000, quantity: '5 шт.' }, { deal: calendarDeal });
    expect(input).toEqual({
      kolichestvo: 5,
      amount: { amountMicros: 30000000000, currencyCode: 'RUB' },
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
