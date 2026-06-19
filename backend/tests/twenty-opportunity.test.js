import { describe, it, expect } from 'vitest';
import { buildOpportunityInput, parseQuantity } from '../src/services/twenty-opportunity.js';

describe('buildOpportunityInput', () => {
  it('computes amount from price * quantity of items', () => {
    const deal = { title: 'T', crm_event_id: 'e1', start_date: '2026-06-16T00:00:00+03:00' };
    const items = [
      { price: 2640, quantity: '9' },
      { price: 5000, quantity: '1' },
    ];
    const input = buildOpportunityInput(deal, items);
    expect(input.amount.amountMicros).toBe((2640 * 9 + 5000) * 1_000_000);
  });

  it('includes loadDate when deal has load_date', () => {
    const deal = { title: 'T', crm_event_id: 'e1', load_date: '2026-06-16', load_time: '04:00' };
    const input = buildOpportunityInput(deal, []);
    expect(input.loadDate).toBe('2026-06-16T04:00:00+03:00');
  });

  it('omits loadDate when no load_date', () => {
    const input = buildOpportunityInput({ title: 'T', crm_event_id: 'e1' }, []);
    expect(input.loadDate).toBeUndefined();
  });
});

describe('parseQuantity', () => {
  it('parses numeric strings, defaults to 1 for non-numeric', () => {
    expect(parseQuantity('9')).toBe(9);
    expect(parseQuantity('∞')).toBe(1);
    expect(parseQuantity(null)).toBe(1);
  });
});
