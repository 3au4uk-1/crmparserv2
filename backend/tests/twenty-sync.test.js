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
          if (sql.includes('twenty_error = ?')) {
            const deal = deals.get(params[params.length - 1]);
            if (deal) deal.twenty_error = params[0];
            return { changes: 1 };
          }
          if (sql.includes('status = NULL')) {
            const deal = deals.get(params[params.length - 1]);
            if (deal) {
              deal.twenty_stage = params[0];
              deal.status = null;
              deal.synced_at = 'now';
              deal.twenty_error = null;
            }
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
            const deal = deals.get(params[2]);
            if (deal) {
              deal.twenty_id = params[0];
              deal.twenty_stage = params[1];
              deal.synced_at = 'now';
              deal.approval_status = 'synced';
            }
            return { changes: 1 };
          }
          if (sql.includes('twenty_stage = ?')) {
            const deal = deals.get(params[params.length - 1]);
            if (deal) {
              deal.twenty_stage = params[0];
              if (params[1]) deal.status = params[1];
              deal.synced_at = 'now';
              deal.twenty_error = null;
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

vi.mock('../src/services/blacklist.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    loadBlacklist: () => [],
    isBlacklisted: () => false,
  };
});

const runPrintSheetCycleMock = vi.fn();
vi.mock('../src/services/print-sheet-cycle.js', () => ({
  runPrintSheetCycle: (...args) => runPrintSheetCycleMock(...args),
}));

import * as dbMock from '../src/db/connection.js';
import { syncDealToTwenty, cancelDealInTwenty, restoreDealInTwenty } from '../src/services/twenty-sync.js';

function gqlOk(data) {
  return { status: 200, data: { data } };
}

describe('syncDealToTwenty', () => {
  beforeEach(() => {
    axiosPost.mockReset();
    dbMock.__reset();
    runPrintSheetCycleMock.mockReset();
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

    runPrintSheetCycleMock.mockResolvedValue({ exported: 0, readbackUpdated: 0, sessionsCleared: 0 });

    const result = await syncDealToTwenty(dealId);

    expect(result.action).toBe('updated');
    expect(axiosPost.mock.calls.some(([_, body]) =>
      body.query.includes('updateOpportunity')
    )).toBe(true);
    expect(runPrintSheetCycleMock).toHaveBeenCalledWith(expect.any(Function));
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

    runPrintSheetCycleMock.mockResolvedValue({ exported: 0, readbackUpdated: 0, sessionsCleared: 0 });

    const result = await syncDealToTwenty(dealId);
    expect(result.action).toBe('created');
    expect(runPrintSheetCycleMock).toHaveBeenCalledWith(expect.any(Function));
  });

  it('skips print sheet refresh when skipPrintSheetRefresh is true', async () => {
    const dealId = dbMock.__seedDeal({
      id: 10,
      twenty_id: 'opp-skip-print',
      approval_status: 'synced',
      title: 'Deal skip print',
      start_date: '2026-06-10',
      crm_event_id: 'e10',
    });
    dbMock.__seedItem({
      deal_id: dealId,
      name: 'Баннер',
      price: 1000,
      classification: 'keyword_match',
      sync_override: null,
    });

    axiosPost
      .mockResolvedValueOnce(gqlOk({ updateOpportunity: { id: 'opp-skip-print' } }))
      .mockResolvedValueOnce(gqlOk({
        dealLineItems: { edges: [{ node: { id: 'li-1', name: 'Баннер', stage: 'NOVYY' } }] },
      }))
      .mockResolvedValueOnce(gqlOk({ updateDealLineItem: { id: 'li-1' } }));

    runPrintSheetCycleMock.mockResolvedValue({ exported: 0, readbackUpdated: 0, sessionsCleared: 0 });

    await syncDealToTwenty(dealId, { skipPrintSheetRefresh: true });

    expect(runPrintSheetCycleMock).not.toHaveBeenCalled();
  });

  it('refreshes plenka for print-stage line items after sync', async () => {
    const dealId = dbMock.__seedDeal({
      id: 5,
      twenty_id: 'opp-print',
      approval_status: 'synced',
      title: 'Print stage deal',
      start_date: '2026-06-10',
      crm_event_id: 'e5',
    });

    axiosPost
      .mockResolvedValueOnce(gqlOk({ updateOpportunity: { id: 'opp-print' } }))
      .mockResolvedValueOnce(gqlOk({ dealLineItems: { edges: [] } }));

    runPrintSheetCycleMock.mockResolvedValue({ exported: 0, readbackUpdated: 1, sessionsCleared: 0 });

    const result = await syncDealToTwenty(dealId);

    expect(result.action).toBe('updated_empty');
    expect(runPrintSheetCycleMock).toHaveBeenCalledTimes(1);
  });

  it('updates opportunity dates even when all line items are protected', async () => {
    const dealId = dbMock.__seedDeal({
      id: 7,
      twenty_id: 'opp-dates',
      approval_status: 'synced',
      title: 'Dates deal',
      start_date: '2026-06-16T00:00:00+03:00',
      end_date: '2026-06-17T00:00:00+03:00',
      load_date: '2026-06-16',
      load_time: '04:00',
      crm_event_id: 'e7',
    });
    dbMock.__seedItem({
      deal_id: dealId,
      name: 'Баннер',
      price: 2000,
      classification: 'keyword_match',
      sync_override: null,
    });

    axiosPost
      .mockResolvedValueOnce(gqlOk({ updateOpportunity: { id: 'opp-dates' } }))
      .mockResolvedValueOnce(gqlOk({
        dealLineItems: { edges: [{ node: { id: 'li-protected', name: 'Баннер', stage: 'V_PECHATI' } }] },
      }));

    runPrintSheetCycleMock.mockResolvedValue({ exported: 0, readbackUpdated: 0, sessionsCleared: 0 });

    await syncDealToTwenty(dealId);

    const oppUpdateCall = axiosPost.mock.calls.find(([_, body]) =>
      body.query.includes('updateOpportunity')
    );
    expect(oppUpdateCall).toBeTruthy();
    expect(oppUpdateCall[1].variables.input.closeDate).toBeTruthy();
    expect(oppUpdateCall[1].variables.input.loadDate).toBe('2026-06-16T04:00:00+03:00');

    const lineItemUpdateCalls = axiosPost.mock.calls.filter(([_, body]) =>
      body.query.includes('updateDealLineItem')
    );
    expect(lineItemUpdateCalls).toHaveLength(0);
  });

  it('cancels opportunity when deal disappears from calendar', async () => {
    const dealId = dbMock.__seedDeal({
      id: 3,
      twenty_id: 'opp-cancel',
      approval_status: 'synced',
      title: 'Cancelled deal',
      start_date: '2026-06-10',
      crm_event_id: 'e3',
      twenty_stage: null,
    });

    axiosPost
      .mockResolvedValueOnce(gqlOk({ updateOpportunity: { id: 'opp-cancel' } }))
      .mockResolvedValueOnce(gqlOk({
        dealLineItems: {
          edges: [
            { node: { id: 'li-novyy', name: 'Баннер', stage: 'NOVYY' } },
            { node: { id: 'li-protected', name: 'Ролл-ап', stage: 'V_PECHATI' } },
            { node: { id: 'li-cancelled', name: 'Наклейка', stage: 'OTMENA' } },
          ],
        },
      }))
      .mockResolvedValueOnce(gqlOk({ updateDealLineItem: { id: 'li-novyy' } }))
      .mockResolvedValueOnce(gqlOk({ updateDealLineItem: { id: 'li-protected' } }));

    const result = await cancelDealInTwenty(dealId);

    expect(result.action).toBe('cancelled');
    expect(axiosPost.mock.calls[0][1].variables.input.stage).toBe('OTMENA');

    const lineItemCancelCalls = axiosPost.mock.calls.filter(([_, body]) =>
      body.query.includes('updateDealLineItem')
    );
    expect(lineItemCancelCalls).toHaveLength(2);
    expect(lineItemCancelCalls.map(([, body]) => body.variables.id).sort()).toEqual([
      'li-novyy',
      'li-protected',
    ]);
    for (const [, body] of lineItemCancelCalls) {
      expect(body.variables.input.stage).toBe('OTMENA');
    }
  });

  it('skips cancel when deal already cancelled in Twenty', async () => {
    const dealId = dbMock.__seedDeal({
      id: 4,
      twenty_id: 'opp-cancelled',
      twenty_stage: 'OTMENA',
      crm_event_id: 'e4',
    });

    const result = await cancelDealInTwenty(dealId);

    expect(result.skipped).toBe(true);
    expect(axiosPost).not.toHaveBeenCalled();
  });

  it('restores opportunity stage when deal is cancelled locally', async () => {
    const dealId = dbMock.__seedDeal({
      id: 5,
      twenty_id: 'opp-restore',
      twenty_stage: 'OTMENA',
      status: 'отмена',
      crm_event_id: 'e5',
    });

    axiosPost.mockResolvedValueOnce(gqlOk({ updateOpportunity: { id: 'opp-restore' } }));

    const result = await restoreDealInTwenty(dealId);

    expect(result.action).toBe('restored');
    expect(result.stage).toBe('NOVYY');
    expect(axiosPost.mock.calls[0][1].variables.input.stage).toBe('NOVYY');

    const deal = dbMock.getDb().prepare('SELECT * FROM deals WHERE id = ?').get(dealId);
    expect(deal.twenty_stage).toBe('NOVYY');
    expect(deal.status).toBeNull();
  });

  it('skips restore when deal is not cancelled', async () => {
    const dealId = dbMock.__seedDeal({
      id: 6,
      twenty_id: 'opp-active',
      twenty_stage: 'V_RABOTE',
      crm_event_id: 'e6',
    });

    const result = await restoreDealInTwenty(dealId);

    expect(result.skipped).toBe(true);
    expect(axiosPost).not.toHaveBeenCalled();
  });
});
