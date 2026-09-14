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
          if (sql.includes("key = 'decor_keywords'")) {
            return { value: JSON.stringify(['гирлянда']) };
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
          if (sql.includes('line_item_stage_snapshot_json = NULL')) {
            const deal = deals.get(params[params.length - 1]);
            if (deal) {
              deal.twenty_stage = params[0];
              deal.status = null;
              deal.pre_cancel_opportunity_stage = null;
              deal.line_item_stage_snapshot_json = null;
              deal.calendar_miss_streak = 0;
              deal.synced_at = 'now';
              deal.twenty_error = null;
            }
            return { changes: 1 };
          }
          if (sql.includes('twenty_id = ?') && sql.includes('approval_status')) {
            const deal = deals.get(params[2]);
            if (deal) {
              deal.twenty_id = params[0];
              deal.twenty_stage = params[1];
              deal.synced_at = 'now';
              deal.approval_status = 'synced';
              deal.twenty_error = null;
            }
            return { changes: 1 };
          }
          if (sql.includes('line_item_stage_snapshot_json') && sql.includes('pre_cancel_opportunity_stage')) {
            const deal = deals.get(params[params.length - 1]);
            if (deal) {
              if (sql.includes('IS NULL OR')) {
                if (deal.line_item_stage_snapshot_json) return { changes: 0 };
                deal.pre_cancel_opportunity_stage = params[0];
                deal.line_item_stage_snapshot_json = params[1];
                return { changes: 1 };
              }
              deal.pre_cancel_opportunity_stage = params[0];
              deal.line_item_stage_snapshot_json = params[1];
              if (sql.includes('calendar_miss_streak')) {
                deal.calendar_miss_streak = params[2] ?? 0;
              }
              return { changes: 1 };
            }
            return { changes: 0 };
          }
          if (sql.includes('twenty_stage = ?') && sql.includes('status = ?') && !sql.includes('status = NULL')) {
            const deal = deals.get(params[params.length - 1]);
            if (deal) {
              deal.twenty_stage = params[0];
              deal.status = params[1];
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
          return { changes: 1 };
        },
      };
    },
  };

  return {
    getDb: () => db,
    __seedDeal(deal) {
      const id = deal.id ?? dealSeq++;
      deals.set(id, {
        calendar_miss_streak: 0,
        pre_cancel_opportunity_stage: null,
        line_item_stage_snapshot_json: null,
        ...deal,
        id,
      });
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

const runPrintSheetRefreshMock = vi.fn();
vi.mock('../src/services/print-sheet-runner.js', () => ({
  runPrintSheetRefresh: (...args) => runPrintSheetRefreshMock(...args),
}));

const logTwentyStepMock = vi.fn();
vi.mock('../src/services/twenty-sync-log.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    logTwentyStep: (...args) => logTwentyStepMock(...args),
  };
});

import * as dbMock from '../src/db/connection.js';
import { syncDealToTwenty, cancelDealInTwenty, restoreDealInTwenty } from '../src/services/twenty-sync.js';

function gqlOk(data) {
  return { status: 200, data: { data } };
}

describe('syncDealToTwenty', () => {
  beforeEach(() => {
    axiosPost.mockReset();
    dbMock.__reset();
    runPrintSheetRefreshMock.mockReset();
    logTwentyStepMock.mockReset();
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
      .mockResolvedValueOnce(gqlOk({ updateDealLineItem: { id: 'li-1' } }))
      .mockResolvedValueOnce(gqlOk({
        dealLineItems: {
          edges: [{ node: { id: 'li-1', name: 'Баннер', stage: 'NOVYY', amount: { amountMicros: 2_000_000_000, currencyCode: 'RUB' } } }],
        },
      }))
      .mockResolvedValueOnce(gqlOk({ updateOpportunity: { id: 'opp-existing' } }));

    runPrintSheetRefreshMock.mockResolvedValue({ exported: 0, readbackUpdated: 0, sessionsCleared: 0 });

    const result = await syncDealToTwenty(dealId);

    expect(result.action).toBe('updated');
    expect(axiosPost.mock.calls.some(([_, body]) =>
      body.query.includes('updateOpportunity')
    )).toBe(true);
    expect(runPrintSheetRefreshMock).toHaveBeenCalledTimes(1);
  });

  it('recalculates opportunity amount from non-OTMENA line items after sync', async () => {
    const dealId = dbMock.__seedDeal({
      id: 12,
      twenty_id: 'opp-amount',
      approval_status: 'synced',
      title: 'Amount deal',
      start_date: '2026-06-10',
      crm_event_id: 'e12',
    });
    dbMock.__seedItem({
      deal_id: dealId,
      name: 'Баннер',
      price: 2000,
      classification: 'keyword_match',
      sync_override: null,
    });

    axiosPost
      .mockResolvedValueOnce(gqlOk({ updateOpportunity: { id: 'opp-amount' } }))
      .mockResolvedValueOnce(gqlOk({
        dealLineItems: {
          edges: [
            { node: { id: 'li-active', name: 'Баннер', stage: 'NOVYY', amount: { amountMicros: 10_000_000_000, currencyCode: 'RUB' } } },
            { node: { id: 'li-cancelled', name: 'Old', stage: 'OTMENA', amount: { amountMicros: 5_000_000_000, currencyCode: 'RUB' } } },
          ],
        },
      }))
      .mockResolvedValueOnce(gqlOk({ updateDealLineItem: { id: 'li-active' } }))
      .mockResolvedValueOnce(gqlOk({
        dealLineItems: {
          edges: [
            { node: { id: 'li-active', name: 'Баннер', stage: 'NOVYY', amount: { amountMicros: 10_000_000_000, currencyCode: 'RUB' } } },
            { node: { id: 'li-cancelled', name: 'Old', stage: 'OTMENA', amount: { amountMicros: 5_000_000_000, currencyCode: 'RUB' } } },
          ],
        },
      }))
      .mockResolvedValueOnce(gqlOk({ updateOpportunity: { id: 'opp-amount' } }));

    await syncDealToTwenty(dealId);

    const updateCalls = axiosPost.mock.calls.filter(([_, body]) =>
      body.query.includes('updateOpportunity')
    );
    expect(updateCalls).toHaveLength(2);
    expect(updateCalls[1][1].variables.input).toEqual({
      amount: { amountMicros: 10_000_000_000, currencyCode: 'RUB' },
    });
    expect(updateCalls[1][1].variables.input).not.toHaveProperty('name');
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
      .mockResolvedValueOnce(gqlOk({ createDealLineItems: [{ id: 'li-new' }] }))
      .mockResolvedValueOnce(gqlOk({
        dealLineItems: {
          edges: [{ node: { id: 'li-new', name: 'Баннер', stage: 'NOVYY', amount: { amountMicros: 1_000_000_000, currencyCode: 'RUB' } } }],
        },
      }))
      .mockResolvedValueOnce(gqlOk({ updateOpportunity: { id: 'opp-new' } }));

    runPrintSheetRefreshMock.mockResolvedValue({ exported: 0, readbackUpdated: 0, sessionsCleared: 0 });

    const result = await syncDealToTwenty(dealId);
    expect(result.action).toBe('created');
    expect(runPrintSheetRefreshMock).toHaveBeenCalledTimes(1);
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
      .mockResolvedValueOnce(gqlOk({ updateDealLineItem: { id: 'li-1' } }))
      .mockResolvedValueOnce(gqlOk({
        dealLineItems: {
          edges: [{ node: { id: 'li-1', name: 'Баннер', stage: 'NOVYY', amount: { amountMicros: 1_000_000_000, currencyCode: 'RUB' } } }],
        },
      }))
      .mockResolvedValueOnce(gqlOk({ updateOpportunity: { id: 'opp-skip-print' } }));

    runPrintSheetRefreshMock.mockResolvedValue({ exported: 0, readbackUpdated: 0, sessionsCleared: 0 });

    await syncDealToTwenty(dealId, { skipPrintSheetRefresh: true });

    expect(runPrintSheetRefreshMock).not.toHaveBeenCalled();
  });

  it('skips Twenty calls when productStreams filter leaves no items', async () => {
    const dealId = dbMock.__seedDeal({
      id: 11,
      twenty_id: 'opp-streams',
      approval_status: 'synced',
      title: 'Branding only',
      start_date: '2026-06-10',
      crm_event_id: 'e11',
    });
    dbMock.__seedItem({
      deal_id: dealId,
      name: 'Баннер',
      price: 1000,
      classification: 'keyword_match',
      sync_override: null,
    });

    const result = await syncDealToTwenty(dealId, {
      productStreams: ['DECOR', 'MK'],
      skipPrintSheetRefresh: true,
    });

    expect(result).toEqual({ action: 'skipped', itemCount: 0 });
    expect(axiosPost).not.toHaveBeenCalled();
  });

  it('scoped productStreams update skips header UpdateOpportunity and preserves branding line items', async () => {
    const dealId = dbMock.__seedDeal({
      id: 13,
      twenty_id: 'opp-scoped',
      approval_status: 'synced',
      title: 'Decor scoped deal',
      start_date: '2026-06-10',
      crm_event_id: 'e13',
    });
    dbMock.__seedItem({
      deal_id: dealId,
      name: 'Гирлянда',
      price: 1500,
      classification: 'unclassified',
      sync_override: null,
      productStream: 'DECOR',
    });
    dbMock.__seedItem({
      deal_id: dealId,
      name: 'Баннер',
      price: 1000,
      classification: 'keyword_match',
      sync_override: null,
    });

    axiosPost
      .mockResolvedValueOnce(gqlOk({
        dealLineItems: {
          edges: [
            { node: { id: 'li-branding', name: 'Баннер', stage: 'NOVYY' } },
            { node: { id: 'li-decor', name: 'Гирлянда', stage: 'NOVYY' } },
          ],
        },
      }))
      .mockResolvedValueOnce(gqlOk({ upsertDealLineItems: [{ id: 'li-decor' }] }))
      .mockResolvedValueOnce(gqlOk({
        dealLineItems: {
          edges: [
            { node: { id: 'li-branding', name: 'Баннер', stage: 'NOVYY', amount: { amountMicros: 1_000_000_000, currencyCode: 'RUB' } } },
            { node: { id: 'li-decor', name: 'Гирлянда', stage: 'NOVYY', amount: { amountMicros: 1_500_000_000, currencyCode: 'RUB' } } },
          ],
        },
      }))
      .mockResolvedValueOnce(gqlOk({ updateOpportunity: { id: 'opp-scoped' } }));

    const result = await syncDealToTwenty(dealId, {
      productStreams: ['DECOR', 'MK'],
      skipPrintSheetRefresh: true,
    });

    expect(result.action).toBe('updated');

    const headerOppUpdates = axiosPost.mock.calls.filter(([_, body]) =>
      body.query.includes('mutation UpdateOpportunity')
      && body.variables?.input
      && ('name' in body.variables.input || 'closeDate' in body.variables.input)
    );
    expect(headerOppUpdates).toHaveLength(0);

    const amountOppUpdates = axiosPost.mock.calls.filter(([_, body]) =>
      body.query.includes('mutation UpdateOpportunity')
      && body.variables?.input
      && Object.keys(body.variables.input).length === 1
      && 'amount' in body.variables.input
    );
    expect(amountOppUpdates).toHaveLength(1);

    const deleteCalls = axiosPost.mock.calls.filter(([_, body]) =>
      body.query.includes('deleteDealLineItem')
    );
    expect(deleteCalls.every(([, body]) => body.variables.id !== 'li-branding')).toBe(true);
    expect(deleteCalls).toHaveLength(0);

    const lineItemUpdates = axiosPost.mock.calls.filter(([_, body]) =>
      /upsertDealLineItems|updateDealLineItems\(|updateDealLineItem\(/.test(body.query)
    );
    expect(lineItemUpdates).toHaveLength(1);
    const updateVars = lineItemUpdates[0][1].variables;
    const payload = updateVars.data?.[0] ?? updateVars.input ?? updateVars.data;
    const productStream = payload.productStream;
    expect(productStream === 'DECOR' || (Array.isArray(productStream) && productStream.includes('DECOR'))).toBe(true);
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
      .mockResolvedValueOnce(gqlOk({ dealLineItems: { edges: [] } }))
      .mockResolvedValueOnce(gqlOk({ dealLineItems: { edges: [] } }))
      .mockResolvedValueOnce(gqlOk({ updateOpportunity: { id: 'opp-print' } }));

    runPrintSheetRefreshMock.mockResolvedValue({ exported: 0, readbackUpdated: 1, sessionsCleared: 0 });

    const result = await syncDealToTwenty(dealId);

    expect(result.action).toBe('updated_empty');
    expect(runPrintSheetRefreshMock).toHaveBeenCalledTimes(1);
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
      }))
      .mockResolvedValueOnce(gqlOk({
        dealLineItems: {
          edges: [{ node: { id: 'li-protected', name: 'Баннер', stage: 'V_PECHATI', amount: { amountMicros: 2_000_000_000, currencyCode: 'RUB' } } }],
        },
      }))
      .mockResolvedValueOnce(gqlOk({ updateOpportunity: { id: 'opp-dates' } }));

    runPrintSheetRefreshMock.mockResolvedValue({ exported: 0, readbackUpdated: 0, sessionsCleared: 0 });

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
      .mockResolvedValueOnce(gqlOk({
        dealLineItems: {
          edges: [
            { node: { id: 'li-novyy', name: 'Баннер', stage: 'NOVYY' } },
            { node: { id: 'li-protected', name: 'Ролл-ап', stage: 'V_PECHATI' } },
            { node: { id: 'li-cancelled', name: 'Наклейка', stage: 'OTMENA' } },
          ],
        },
      }))
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
      .mockResolvedValueOnce(gqlOk({
        updateDealLineItems: [{ id: 'li-novyy' }, { id: 'li-protected' }],
      }));

    const result = await cancelDealInTwenty(dealId);

    expect(result.action).toBe('cancelled');

    const opportunityInput = axiosPost.mock.calls[1][1].variables.input;
    expect(opportunityInput).toMatchObject({
      stage: 'OTMENA',
      amount: { amountMicros: 0, currencyCode: 'RUB' },
    });

    const lineItemCancelCalls = axiosPost.mock.calls.filter(([_, body]) =>
      /updateDealLineItems\(|upsertDealLineItems|updateDealLineItem\(/.test(body.query)
    );
    expect(lineItemCancelCalls).toHaveLength(1);
    const cancelVars = lineItemCancelCalls[0][1].variables;
    const cancelledIds = cancelVars.ids
      || (cancelVars.data || []).map((row) => row.id)
      || [cancelVars.id];
    expect([...cancelledIds].sort()).toEqual(['li-novyy', 'li-protected']);
    const cancelData = cancelVars.data && !Array.isArray(cancelVars.data)
      ? cancelVars.data
      : cancelVars.input;
    expect(cancelData).toMatchObject({
      stage: 'OTMENA',
      amount: { amountMicros: 0, currencyCode: 'RUB' },
    });
  });

  it('writes line-item stage snapshot before cancelling', async () => {
    const dealId = dbMock.__seedDeal({
      id: 7,
      twenty_id: 'opp-snap',
      twenty_stage: 'V_RABOTE',
      approval_status: 'synced',
      title: 'Snap deal',
      start_date: '2026-06-10',
      crm_event_id: 'e7',
    });

    axiosPost
      .mockResolvedValueOnce(gqlOk({
        dealLineItems: {
          edges: [
            { node: { id: 'li-a', name: 'Фриз', stage: 'V_PECHATI' } },
            { node: { id: 'li-b', name: 'Стойка', stage: 'NOVYY' } },
            { node: { id: 'li-c', name: 'Старое', stage: 'OTMENA' } },
          ],
        },
      }))
      .mockResolvedValueOnce(gqlOk({ updateOpportunity: { id: 'opp-snap' } }))
      .mockResolvedValueOnce(gqlOk({
        dealLineItems: {
          edges: [
            { node: { id: 'li-a', name: 'Фриз', stage: 'V_PECHATI' } },
            { node: { id: 'li-b', name: 'Стойка', stage: 'NOVYY' } },
            { node: { id: 'li-c', name: 'Старое', stage: 'OTMENA' } },
          ],
        },
      }))
      .mockResolvedValueOnce(gqlOk({ updateDealLineItem: { id: 'li-a' } }))
      .mockResolvedValueOnce(gqlOk({ updateDealLineItem: { id: 'li-b' } }));

    await cancelDealInTwenty(dealId);

    const deal = dbMock.getDb().prepare('SELECT * FROM deals WHERE id = ?').get(dealId);
    expect(deal.pre_cancel_opportunity_stage).toBe('V_RABOTE');
    expect(JSON.parse(deal.line_item_stage_snapshot_json)).toEqual([
      { id: 'li-a', stage: 'V_PECHATI' },
      { id: 'li-b', stage: 'NOVYY' },
      { id: 'li-c', stage: 'OTMENA' },
    ]);
    expect(deal.twenty_stage).toBe('OTMENA');
    expect(logTwentyStepMock).toHaveBeenCalledWith('cancel.snapshot', {
      lineItemCount: 3,
      opportunityStage: 'V_RABOTE',
    });
  });

  it('does not overwrite an existing cancel snapshot when already cancelled', async () => {
    const existing = JSON.stringify([{ id: 'li-old', stage: 'OKLEYKA' }]);
    const dealId = dbMock.__seedDeal({
      id: 8,
      twenty_id: 'opp-keep-snap',
      twenty_stage: 'OTMENA',
      pre_cancel_opportunity_stage: 'V_RABOTE',
      line_item_stage_snapshot_json: existing,
      crm_event_id: 'e8',
    });

    const result = await cancelDealInTwenty(dealId);
    expect(result.skipped).toBe(true);
    const deal = dbMock.getDb().prepare('SELECT * FROM deals WHERE id = ?').get(dealId);
    expect(deal.line_item_stage_snapshot_json).toBe(existing);
    expect(axiosPost).not.toHaveBeenCalled();
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

  it('restores opportunity and line-item stages from snapshot', async () => {
    const snapshot = [
      { id: 'li-a', stage: 'V_PECHATI' },
      { id: 'li-b', stage: 'NOVYY' },
      { id: 'li-c', stage: 'OTMENA' },
    ];
    const dealId = dbMock.__seedDeal({
      id: 5,
      twenty_id: 'opp-restore',
      twenty_stage: 'OTMENA',
      status: 'отмена',
      pre_cancel_opportunity_stage: 'V_RABOTE',
      line_item_stage_snapshot_json: JSON.stringify(snapshot),
      calendar_miss_streak: 3,
      crm_event_id: 'e5',
    });

    axiosPost
      .mockResolvedValueOnce(gqlOk({ updateOpportunity: { id: 'opp-restore' } }))
      .mockResolvedValueOnce(gqlOk({
        dealLineItems: {
          edges: [
            { node: { id: 'li-a', name: 'A', stage: 'OTMENA' } },
            { node: { id: 'li-b', name: 'B', stage: 'OTMENA' } },
            { node: { id: 'li-c', name: 'C', stage: 'OTMENA' } },
          ],
        },
      }))
      .mockResolvedValueOnce(gqlOk({
        upsertDealLineItems: [{ id: 'li-a' }, { id: 'li-b' }, { id: 'li-c' }],
      }));

    const result = await restoreDealInTwenty(dealId);

    expect(result.action).toBe('restored');
    expect(result.stage).toBe('V_RABOTE');
    expect(axiosPost.mock.calls[0][1].variables.input.stage).toBe('V_RABOTE');

    const lineUpdates = axiosPost.mock.calls.filter(([, body]) =>
      /upsertDealLineItems|updateDealLineItems\(|updateDealLineItem\(/.test(body.query)
    );
    expect(lineUpdates).toHaveLength(1);
    expect(lineUpdates[0][1].variables.data).toEqual([
      { id: 'li-a', stage: 'V_PECHATI' },
      { id: 'li-b', stage: 'NOVYY' },
      { id: 'li-c', stage: 'OTMENA' },
    ]);

    const deal = dbMock.getDb().prepare('SELECT * FROM deals WHERE id = ?').get(dealId);
    expect(deal.twenty_stage).toBe('V_RABOTE');
    expect(deal.status).toBeNull();
    expect(deal.pre_cancel_opportunity_stage).toBeNull();
    expect(deal.line_item_stage_snapshot_json).toBeNull();
    expect(deal.calendar_miss_streak).toBe(0);
  });

  it('falls back to settings opportunity stage when snapshot stage missing', async () => {
    const dealId = dbMock.__seedDeal({
      id: 9,
      twenty_id: 'opp-fallback',
      twenty_stage: 'OTMENA',
      status: 'отмена',
      pre_cancel_opportunity_stage: null,
      line_item_stage_snapshot_json: '[]',
      crm_event_id: 'e9',
    });

    axiosPost.mockResolvedValueOnce(gqlOk({ updateOpportunity: { id: 'opp-fallback' } }))
      .mockResolvedValueOnce(gqlOk({ dealLineItems: { edges: [] } }));

    const result = await restoreDealInTwenty(dealId);
    expect(result.stage).toBe('NOVYY');
    expect(axiosPost.mock.calls[0][1].variables.input.stage).toBe('NOVYY');
  });

  it('keeps snapshot when a line-item restore hits a GQL error', async () => {
    const snapshot = [{ id: 'li-a', stage: 'V_PECHATI' }, { id: 'li-b', stage: 'NOVYY' }];
    const dealId = dbMock.__seedDeal({
      id: 10,
      twenty_id: 'opp-partial',
      twenty_stage: 'OTMENA',
      status: 'отмена',
      pre_cancel_opportunity_stage: 'V_RABOTE',
      line_item_stage_snapshot_json: JSON.stringify(snapshot),
      crm_event_id: 'e10',
    });

    axiosPost
      .mockResolvedValueOnce(gqlOk({ updateOpportunity: { id: 'opp-partial' } }))
      .mockResolvedValueOnce(gqlOk({
        dealLineItems: {
          edges: [
            { node: { id: 'li-a', name: 'A', stage: 'OTMENA' } },
            { node: { id: 'li-b', name: 'B', stage: 'OTMENA' } },
          ],
        },
      }))
      .mockResolvedValueOnce({
        status: 200,
        data: { errors: [{ message: 'boom' }] },
      });

    await expect(restoreDealInTwenty(dealId)).rejects.toThrow(/boom|Failed/);

    const deal = dbMock.getDb().prepare('SELECT * FROM deals WHERE id = ?').get(dealId);
    expect(deal.line_item_stage_snapshot_json).toBe(JSON.stringify(snapshot));
    expect(deal.pre_cancel_opportunity_stage).toBe('V_RABOTE');
  });

  it('skips snapshot line items missing from Twenty list and clears snapshot on success', async () => {
    const snapshot = [
      { id: 'li-gone', stage: 'V_PECHATI' },
      { id: 'li-keep', stage: 'NOVYY' },
    ];
    const dealId = dbMock.__seedDeal({
      id: 11,
      twenty_id: 'opp-skip-missing',
      twenty_stage: 'OTMENA',
      status: 'отмена',
      pre_cancel_opportunity_stage: 'V_RABOTE',
      line_item_stage_snapshot_json: JSON.stringify(snapshot),
      crm_event_id: 'e11',
    });

    axiosPost
      .mockResolvedValueOnce(gqlOk({ updateOpportunity: { id: 'opp-skip-missing' } }))
      .mockResolvedValueOnce(gqlOk({
        dealLineItems: {
          edges: [{ node: { id: 'li-keep', name: 'Keep', stage: 'OTMENA' } }],
        },
      }))
      .mockResolvedValueOnce(gqlOk({ upsertDealLineItems: [{ id: 'li-keep' }] }));

    const result = await restoreDealInTwenty(dealId);

    expect(result.action).toBe('restored');
    expect(logTwentyStepMock).toHaveBeenCalledWith('restore.line_item_skipped', { lineItemId: 'li-gone' });

    const lineUpdates = axiosPost.mock.calls.filter(([, body]) =>
      /upsertDealLineItems|updateDealLineItems\(|updateDealLineItem\(/.test(body.query)
    );
    expect(lineUpdates).toHaveLength(1);
    expect(lineUpdates[0][1].variables.data).toEqual([{ id: 'li-keep', stage: 'NOVYY' }]);

    const deal = dbMock.getDb().prepare('SELECT * FROM deals WHERE id = ?').get(dealId);
    expect(deal.line_item_stage_snapshot_json).toBeNull();
    expect(deal.twenty_stage).toBe('V_RABOTE');
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
