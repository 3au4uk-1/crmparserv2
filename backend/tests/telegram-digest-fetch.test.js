import { describe, expect, it, vi } from 'vitest';
import { fetchDigestDayData } from '../src/telegram/digest/fetch.js';

describe('fetchDigestDayData', () => {
  it('maps opportunities and groups line items', async () => {
    const gqlClient = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          data: {
            opportunities: {
              pageInfo: { hasNextPage: false, endCursor: null },
              edges: [
                {
                  node: {
                    id: 'o1',
                    name: 'N',
                    stage: 'NOVYY',
                    loadDate: '2026-08-07',
                    amount: { amountMicros: 1e6 },
                    company: { name: 'Co' },
                  },
                },
              ],
            },
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          data: {
            dealLineItems: {
              pageInfo: { hasNextPage: false, endCursor: null },
              edges: [
                { node: { id: 'li1', opportunityId: 'o1', stage: 'NOVYY' } },
                { node: { id: 'li2', opportunityId: 'o1', stage: 'OTMENA' } },
              ],
            },
          },
        },
      });

    const data = await fetchDigestDayData(gqlClient, {
      gte: '2026-08-07T00:00:00+03:00',
      lt: '2026-08-08T00:00:00+03:00',
    });
    expect(data.deals).toHaveLength(1);
    expect(data.deals[0].companyName).toBe('Co');
    expect(data.lineItemsByOppId.o1).toHaveLength(2);
    expect(gqlClient).toHaveBeenCalled();
  });
});
