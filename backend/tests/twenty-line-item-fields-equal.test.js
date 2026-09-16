import { describe, it, expect } from 'vitest';
import { buildLineItemUpdateInput } from '../src/services/twenty-line-item.js';
import { lineItemFieldsEqual } from '../src/services/twenty-line-item.js';

function existing(overrides = {}) {
  return {
    id: 'li-1',
    name: 'Баннер',
    stage: 'V_RABOTE',
    istochnik: 'PARSER',
    productStream: ['BRANDING'],
    kolichestvo: 2,
    amount: { amountMicros: 2_500_000, currencyCode: 'RUB' },
    kommentariy: 'old',
    tip: 'BANNERA',
    tipDetail: null,
    ...overrides,
  };
}

describe('lineItemFieldsEqual', () => {
  it('is true when payload fields match, ignoring stage', () => {
    const item = {
      name: 'Баннер',
      quantity_num: 2,
      price: 5,
      comment: '',
      productStreams: ['BRANDING'],
    };
    const desired = buildLineItemUpdateInput(item, {});
    expect(lineItemFieldsEqual(existing(), desired)).toBe(true);
  });

  it('is false when amount micros differ', () => {
    const item = {
      name: 'Баннер',
      quantity_num: 2,
      price: 6,
      comment: '',
      productStreams: ['BRANDING'],
    };
    const desired = buildLineItemUpdateInput(item, {});
    expect(lineItemFieldsEqual(existing(), desired)).toBe(false);
  });

  it('does not treat empty local comment as a change', () => {
    const item = {
      name: 'Баннер',
      quantity_num: 2,
      price: 5,
      comment: '',
      productStreams: ['BRANDING'],
    };
    const desired = buildLineItemUpdateInput(item, {});
    expect(desired.kommentariy).toBeUndefined();
    expect(lineItemFieldsEqual(existing({ kommentariy: 'kept' }), desired)).toBe(true);
  });
});
