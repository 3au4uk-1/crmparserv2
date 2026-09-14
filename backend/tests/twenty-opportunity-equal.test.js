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
});
