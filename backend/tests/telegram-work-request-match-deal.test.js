import { describe, expect, it } from 'vitest';
import {
  bookingInName,
  matchOpportunity,
  pickMatchedOpportunity,
  searchOpportunitiesByBooking,
} from '../src/telegram/work-requests/match-deal.js';

describe('bookingInName', () => {
  it('rejects booking that is not exactly 6 digits even as a whole token', () => {
    expect(bookingInName('АРЕНДА/12345/Иванов', '12345')).toBe(false);
    expect(bookingInName('АРЕНДА/1234567/Петров', '1234567')).toBe(false);
  });
});

describe('searchOpportunitiesByBooking', () => {
  it('throws on HTTP 500 instead of returning empty results', async () => {
    const gql = async () => ({ status: 500, data: {} });
    await expect(searchOpportunitiesByBooking(gql, '123456')).rejects.toThrow(
      'Twenty API error: HTTP 500',
    );
  });
});

describe('matchOpportunity', () => {
  it('propagates HTTP failures from gql', async () => {
    const gql = async () => ({ status: 500, data: {} });
    await expect(matchOpportunity({ gql, booking: '123456' })).rejects.toThrow(
      'Twenty API error: HTTP 500',
    );
  });
});

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
