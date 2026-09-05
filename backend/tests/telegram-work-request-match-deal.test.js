import { describe, expect, it } from 'vitest';
import { bookingInName, pickMatchedOpportunity } from '../src/telegram/work-requests/match-deal.js';

describe('pickMatchedOpportunity', () => {
  const nodes = [
    { id: 'a', name: 'АРЕНДА/05.09/Маяк/123456/Иванов' },
    { id: 'b', name: 'АРЕНДА/05.09/Маяк/1234567/Петров' },
  ];
  it('matches exactly one 6-digit booking as its own number', () => {
    expect(pickMatchedOpportunity(nodes, { booking: '123456' })?.id).toBe('a');
  });
  it('returns null when two names contain the booking', () => {
    const dup = [...nodes, { id: 'c', name: 'другое 123456 ещё' }];
    expect(pickMatchedOpportunity(dup, { booking: '123456' })).toBe(null);
  });
  it('matches exact deal name when no booking', () => {
    expect(
      pickMatchedOpportunity([{ id: 'x', name: 'Ровно так' }], { dealName: 'Ровно так' })?.id,
    ).toBe('x');
  });
});
