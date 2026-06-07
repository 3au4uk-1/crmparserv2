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

  it('builds create input with warehouse ref, opportunity, quantity and amount', () => {
    const input = buildLineItemCreateInput(
      { name: 'Наклейка', price: 15000, quantity: '3 шт.' },
      'wh-001',
      'opp-456'
    );
    expect(input).toEqual({
      name: 'Наклейка',
      position: 'first',
      warehouseItemId: 'wh-001',
      opportunityId: 'opp-456',
      quantity: '3 шт.',
      amount: { amountMicros: 15000000000, currencyCode: 'RUB' },
    });
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
