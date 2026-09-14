import { describe, it, expect } from 'vitest';
import { opportunityFieldsEqual } from '../src/services/twenty-opportunity.js';

describe('opportunityFieldsEqual', () => {
  const next = {
    name: 'Deal A',
    amount: { amountMicros: 10_000_000, currencyCode: 'RUB' },
    companyId: 'c1',
    closeDate: '2026-09-14',
  };

  it('matches when name, amount, company, and closeDate agree', () => {
    expect(opportunityFieldsEqual({
      name: 'Deal A',
      amount: { amountMicros: 10_000_000 },
      companyId: 'c1',
      closeDate: '2026-09-14',
    }, next)).toBe(true);
  });

  it('detects amount change', () => {
    expect(opportunityFieldsEqual({
      name: 'Deal A',
      amount: { amountMicros: 1 },
      companyId: 'c1',
      closeDate: '2026-09-14',
    }, next)).toBe(false);
  });

  it('detects payment-only amount change when next includes summaPostupleniy', () => {
    const withPayment = {
      ...next,
      summaPostupleniy: { amountMicros: 1_000_000_000, currencyCode: 'RUB' },
      statusOplaty: 'PREDOPLATA',
    };
    expect(opportunityFieldsEqual({
      ...next,
      summaPostupleniy: { amountMicros: 0, currencyCode: 'RUB' },
      statusOplaty: 'PREDOPLATA',
    }, withPayment)).toBe(false);
  });

  it('detects payment-only status change when next includes statusOplaty', () => {
    const withPayment = {
      ...next,
      summaPostupleniy: { amountMicros: 1_000_000_000, currencyCode: 'RUB' },
      statusOplaty: 'PREDOPLATA',
    };
    expect(opportunityFieldsEqual({
      ...next,
      summaPostupleniy: { amountMicros: 1_000_000_000, currencyCode: 'RUB' },
      statusOplaty: 'NE_OPLACHENO',
    }, withPayment)).toBe(false);
  });

  it('ignores payment fields that are absent on next', () => {
    expect(opportunityFieldsEqual({
      ...next,
      summaPostupleniy: { amountMicros: 9, currencyCode: 'RUB' },
      statusOplaty: 'OPLACHENO_POLNOSTYU',
    }, next)).toBe(true);
  });

  it('treats offset closeDate and UTC instant as equal', () => {
    expect(opportunityFieldsEqual({
      ...next,
      closeDate: '2026-06-09T21:00:00.000Z',
    }, {
      ...next,
      closeDate: '2026-06-10T00:00:00+03:00',
    })).toBe(true);
  });

  it('treats offset loadDate and UTC instant as equal', () => {
    expect(opportunityFieldsEqual({
      ...next,
      loadDate: '2026-06-09T21:00:00.000Z',
    }, {
      ...next,
      loadDate: '2026-06-10T00:00:00+03:00',
    })).toBe(true);
  });

  it('detects a real calendar-day shift on closeDate', () => {
    expect(opportunityFieldsEqual({
      ...next,
      closeDate: '2026-06-11T00:00:00+03:00',
    }, {
      ...next,
      closeDate: '2026-06-10T00:00:00+03:00',
    })).toBe(false);
  });

  it('treats missing closeDate and loadDate as equal', () => {
    expect(opportunityFieldsEqual({
      ...next,
      closeDate: null,
      loadDate: null,
    }, {
      ...next,
      closeDate: null,
      loadDate: undefined,
    })).toBe(true);
  });
});
