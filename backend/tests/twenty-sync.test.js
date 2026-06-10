import { describe, it, expect, vi, beforeEach } from 'vitest';

const axiosPost = vi.fn();
vi.mock('axios', () => ({
  default: { post: (...args) => axiosPost(...args) },
}));

vi.mock('../src/db/connection.js', () => {
  const deals = new Map();
  const items = new Map();
  let dealSeq = 1;
  let itemSeq = 1;

  const db = {
    prepare(sql) {
      return {
        get(...params) {
          if (sql.includes('FROM deals WHERE id')) {
            return deals.get(params[0]) || null;
          }
          if (sql.includes("key = 'opportunity_stage'")) {
            return { value: 'NOVYY' };
          }
          return null;
        },
        all(...params) {
          if (sql.includes('FROM deal_items WHERE deal_id')) {
            return [...items.values()].filter((i) => i.deal_id === params[0]);
          }
          return [];
        },
        run(...params) {
          if (sql.includes('INSERT INTO sync_runs')) return { changes: 1 };
          if (sql.includes('twenty_error')) {
            const deal = deals.get(params[params.length - 1]);
            if (deal) deal.twenty_error = params[0];
            return { changes: 1 };
          }
          if (sql.includes('synced_at')) {
            const deal = deals.get(params[params.length - 1]);
            if (deal) {
              deal.synced_at = 'now';
              deal.twenty_error = null;
            }
            return { changes: 1 };
          }
          if (sql.includes('UPDATE deal_items SET twenty_id')) {
            const item = [...items.values()].find((i) => i.id === params[1]);
            if (item) item.twenty_id = params[0];
            return { changes: 1 };
          }
          if (sql.includes('twenty_id = ?') && sql.includes('approval_status')) {
            const deal = deals.get(params[1]);
            if (deal) {
              deal.twenty_id = params[0];
              deal.synced_at = 'now';
              deal.approval_status = 'synced';
            }
            return { changes: 1 };
          }
          return { changes: 1 };
        },
      };
    },
  };

  return {
    getDb: () => db,
    __seedDeal(deal) {
      const id = deal.id ?? dealSeq++;
      deals.set(id, { ...deal, id });
      return id;
    },
    __seedItem(item) {
      const id = item.id ?? itemSeq++;
      items.set(id, { ...item, id });
      return id;
    },
    __reset() {
      deals.clear();
      items.clear();
      dealSeq = 1;
      itemSeq = 1;
    },
  };
});

vi.mock('../src/services/twenty-config.js', () => ({
  requireTwentyConfig: () => ({ apiUrl: 'https://twenty.test/graphql', apiToken: 'token' }),
  getTwentyConfig: () => ({ apiUrl: 'https://twenty.test/graphql', apiToken: 'token', source: 'env' }),
}));

vi.mock('../src/services/blacklist.js', () => ({
  loadBlacklist: () => [],
  isBlacklisted: () => false,
}));

import * as dbMock from '../src/db/connection.js';
import { syncDealToTwenty } from '../src/services/twenty-sync.js';

function gqlOk(data) {
  return { status: 200, data: { data } };
}

describe('syncDealToTwenty', () => {
  beforeEach(() => {
    axiosPost.mockReset();
    dbMock.__reset();
  });

  it('updates opportunity when twenty_id exists', async () => {
    const dealId = dbMock.__seedDeal({
      id: 1,
      twenty_id: 'opp-existing',
      approval_status: 'synced',
      title: 'Updated deal',
      start_date: '2026-06-10',
      crm_event_id: 'e1',
    });
    dbMock.__seedItem({
      deal_id: dealId,
      name: 'Баннер',
      price: 2000,
      classification: 'keyword_match',
      sync_override: null,
    });

    axiosPost
      .mockResolvedValueOnce(gqlOk({ updateOpportunity: { id: 'opp-existing' } }))
      .mockResolvedValueOnce(gqlOk({
        dealLineItems: { edges: [{ node: { id: 'li-1', name: 'Баннер' } }] },
      }))
      .mockResolvedValueOnce(gqlOk({ updateDealLineItem: { id: 'li-1' } }));

    const result = await syncDealToTwenty(dealId);

    expect(result.action).toBe('updated');
    expect(axiosPost.mock.calls.some(([_, body]) =>
      body.query.includes('updateOpportunity')
    )).toBe(true);
  });

  it('creates opportunity when no twenty_id', async () => {
    const dealId = dbMock.__seedDeal({
      id: 2,
      twenty_id: null,
      title: 'New deal',
      start_date: '2026-06-10',
      crm_event_id: 'e2',
    });
    dbMock.__seedItem({
      deal_id: dealId,
      name: 'Баннер',
      price: 1000,
      classification: 'keyword_match',
    });

    axiosPost
      .mockResolvedValueOnce(gqlOk({ createOpportunity: { id: 'opp-new' } }))
      .mockResolvedValueOnce(gqlOk({ products: { edges: [] } }))
      .mockResolvedValueOnce(gqlOk({ createProduct: { id: 'wh-1' } }))
      .mockResolvedValueOnce(gqlOk({ createDealLineItem: { id: 'li-new' } }));

    const result = await syncDealToTwenty(dealId);
    expect(result.action).toBe('created');
  });
});
