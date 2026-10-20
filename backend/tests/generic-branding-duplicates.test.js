import { describe, expect, it, vi } from 'vitest';
import {
  cleanupGenericBrandingDuplicates,
  planGenericBrandingDuplicates,
} from '../src/services/generic-branding-duplicates.js';

const amount = (micros) => ({ amountMicros: micros, currencyCode: 'RUB' });

describe('planGenericBrandingDuplicates', () => {
  it('lists parser-created generic names that match a real item by qty and amount', () => {
    const plan = planGenericBrandingDuplicates([
      { id: 'real-1', name: 'Брендинг сукна на игровой стол', kolichestvo: 1, amount: amount(16_500_000_000), istochnik: 'PARSER' },
      { id: 'dup-1', name: 'Брендинг', kolichestvo: 1, amount: amount(16_500_000_000), istochnik: 'PARSER' },
      { id: 'real-2', name: 'Брендированная подарочная фишка', kolichestvo: 60, amount: amount(9_600_000_000), istochnik: 'PARSER' },
      { id: 'dup-2', name: 'Брендинг (#2)', kolichestvo: 60, amount: amount(9_600_000_000) },
      { id: 'keep', name: 'Брендинг (#3)', kolichestvo: 2, amount: amount(100), istochnik: 'PARSER' },
      { id: 'manual', name: 'Брендинг', kolichestvo: 1, amount: amount(16_500_000_000), istochnik: 'TWENTY_RUCHNAYA' },
    ]);
    expect(plan).toEqual([
      {
        id: 'dup-1',
        name: 'Брендинг',
        kolichestvo: 1,
        amountMicros: 16_500_000_000,
        equivalentId: 'real-1',
        equivalentName: 'Брендинг сукна на игровой стол',
      },
      {
        id: 'dup-2',
        name: 'Брендинг (#2)',
        kolichestvo: 60,
        amountMicros: 9_600_000_000,
        equivalentId: 'real-2',
        equivalentName: 'Брендированная подарочная фишка',
      },
    ]);
  });
});

describe('cleanupGenericBrandingDuplicates', () => {
  it('dry-runs by default and deletes only when asked', async () => {
    const db = {
      prepare: () => ({
        all: () => [{ id: 7, title: 'Deal', twenty_id: 'opp-1', tony_order_id: '197462' }],
      }),
    };
    const listLineItems = vi.fn().mockResolvedValue([
      { id: 'real', name: 'Брендинг сукна на игровой стол', kolichestvo: 1, amount: amount(100), istochnik: 'PARSER' },
      { id: 'dup', name: 'Брендинг', kolichestvo: 1, amount: amount(100), istochnik: 'PARSER' },
    ]);
    const gql = vi.fn().mockResolvedValue({ status: 200, data: { data: { deleteDealLineItems: [{ id: 'dup' }] } } });
    const args = {
      db,
      gql,
      apiUrl: 'http://t',
      apiToken: 'tok',
      assertHttpSuccess: () => {},
      assertGqlSuccess: () => {},
      listLineItems,
    };

    const listed = await cleanupGenericBrandingDuplicates(args);
    expect(listed.dryRun).toBe(true);
    expect(listed.count).toBe(1);
    expect(listed.duplicates[0]).toMatchObject({ id: 'dup', orderId: '197462', equivalentId: 'real' });
    expect(gql).not.toHaveBeenCalled();

    const deleted = await cleanupGenericBrandingDuplicates({ ...args, deleteDuplicates: true });
    expect(deleted.dryRun).toBe(false);
    expect(deleted.deleted).toBe(1);
    expect(gql.mock.calls[0][2]).toMatch(/deleteDealLineItems/);
    expect(gql.mock.calls[0][3]).toEqual({ ids: ['dup'] });
  });
});
