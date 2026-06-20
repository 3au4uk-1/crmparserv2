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
  const tonyItem = {
    name: 'Навигационные наклейки',
    price: 2640,
    quantity: '9',
    sum: 23760,
    comment: '+ монтаж',
    quantity_num: 9,
  };

  it('builds create input with kolichestvo, kommentariy, effective amount', () => {
    const input = buildLineItemCreateInput(
      tonyItem, 'wh-001', 'opp-456', 'first', { dataSource: 'tony' }
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
    expect(input.quantity).toBeUndefined();
  });

  it('omits kommentariy when comment is empty', () => {
    const input = buildLineItemCreateInput(
      { ...tonyItem, comment: '' }, 'wh-001', 'opp-456', 'first', { dataSource: 'tony' }
    );
    expect(input.kommentariy).toBeUndefined();
  });

  it('effective price is 0 when sum is 0', () => {
    const input = buildLineItemCreateInput(
      { ...tonyItem, sum: 0, price: 100 }, 'wh-001', 'opp-456', 'first', { dataSource: 'tony' }
    );
    expect(input.amount.amountMicros).toBe(0);
  });

  it('builds update input for Tony items', () => {
    const input = buildLineItemUpdateInput(tonyItem, { dataSource: 'tony' });
    expect(input).toEqual({
      kolichestvo: 9,
      kommentariy: '+ монтаж',
      amount: { amountMicros: 2640000000, currencyCode: 'RUB' },
    });
  });
});

describe('calendar line items (unchanged)', () => {
  it('builds create input with quantity TEXT and raw price', () => {
    const input = buildLineItemCreateInput(
      { name: 'Наклейка', price: 15000, quantity: '3 шт.' },
      'wh-001', 'opp-456'
    );
    expect(input.quantity).toBe('3 шт.');
    expect(input.amount.amountMicros).toBe(15000000000);
    expect(input.kolichestvo).toBeUndefined();
  });

  it('omits optional fields when missing', () => {
    const input = buildLineItemCreateInput({ name: 'Баннер' }, 'wh-002', 'opp-456');
    expect(input).toEqual({
      name: 'Баннер',
      position: 'first',
      warehouseItemId: 'wh-002',
      opportunityId: 'opp-456',
    });
  });

  it('builds update input with only quantity and amount', () => {
    const input = buildLineItemUpdateInput({ price: 30000, quantity: '5 шт.' });
    expect(input).toEqual({
      quantity: '5 шт.',
      amount: { amountMicros: 30000000000, currencyCode: 'RUB' },
    });
  });

  it('update input is empty when no price or quantity', () => {
    const input = buildLineItemUpdateInput({ name: 'Баннер' });
    expect(input).toEqual({});
  });
});
