import { describe, it, expect, vi, beforeEach } from 'vitest';

const gqlMock = vi.fn();
vi.mock('../src/services/twenty-gql.js', () => ({
  gql: (...args) => gqlMock(...args),
}));

vi.mock('../src/services/twenty-config.js', () => ({
  requireTwentyConfig: () => ({ apiUrl: 'https://crm.example/graphql', apiToken: 'tok' }),
}));

import { findTwentyOpportunityIdByBooking } from '../src/services/twenty-lookup.js';

describe('findTwentyOpportunityIdByBooking', () => {
  beforeEach(() => gqlMock.mockReset());

  it('returns id when opportunity matches tonyLink', async () => {
    gqlMock.mockResolvedValue({
      status: 200,
      data: {
        data: {
          opportunities: { edges: [{ node: { id: 'opp-abc' } }] },
        },
      },
    });

    const id = await findTwentyOpportunityIdByBooking('169120');
    expect(id).toBe('opp-abc');
    expect(gqlMock).toHaveBeenCalledOnce();
  });

  it('returns null when no match', async () => {
    gqlMock.mockResolvedValue({
      status: 200,
      data: { data: { opportunities: { edges: [] } } },
    });
    expect(await findTwentyOpportunityIdByBooking('999')).toBeNull();
  });
});
