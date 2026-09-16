import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const confirmDealGroupMock = vi.fn();
const mirrorDealGroupToTwentyMock = vi.fn();
const clearDealGroupTwentyMock = vi.fn();
const planExpenseRollupMock = vi.fn();
const suggestDealGroupsMock = vi.fn();
const buildExpenseUpdateInputMock = vi.fn();
const gqlMock = vi.fn();
const requireTwentyConfigMock = vi.fn();

vi.mock('../src/config.js', () => ({
  config: {
    twentyAppApiSecret: 'test-secret',
    dbPath: ':memory:',
  },
}));

vi.mock('../src/services/deal-groups.js', () => ({
  confirmDealGroup: (...args) => confirmDealGroupMock(...args),
  planExpenseRollup: (...args) => planExpenseRollupMock(...args),
  dissolveDealGroup: vi.fn(),
  unlinkDealFromGroup: vi.fn(),
  maybeAutoSwitchCanonical: vi.fn(),
  pickCanonicalDeal: vi.fn(),
  computeParentMoney: vi.fn(),
}));

vi.mock('../src/services/deal-group-twenty.js', () => ({
  mirrorDealGroupToTwenty: (...args) => mirrorDealGroupToTwentyMock(...args),
  clearDealGroupTwenty: (...args) => clearDealGroupTwentyMock(...args),
}));

vi.mock('../src/services/deal-group-suggest.js', () => ({
  suggestDealGroups: (...args) => suggestDealGroupsMock(...args),
}));

vi.mock('../src/services/expense-sync.js', () => ({
  buildExpenseUpdateInput: (...args) => buildExpenseUpdateInputMock(...args),
}));

vi.mock('../src/services/twenty-config.js', () => ({
  requireTwentyConfig: (...args) => requireTwentyConfigMock(...args),
}));

vi.mock('../src/services/twenty-gql.js', () => ({
  gql: (...args) => gqlMock(...args),
  assertHttpSuccess: () => {},
  assertGqlSuccess: () => {},
}));

vi.mock('../src/services/twenty-sync.js', () => ({
  syncDealToTwenty: vi.fn(),
}));

vi.mock('../src/services/list-change-resync.js', () => ({
  scheduleListChangeResync: vi.fn(),
}));

import { getDb, initDb } from '../src/db/connection.js';
import { migrate } from '../src/db/migrate.js';
import twentyRouter from '../src/routes/twenty.js';

function createApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/twenty', twentyRouter);
  app.use((err, req, res, next) => {
    res.status(err.status || 500).json({ error: err.message, code: err.code });
  });
  return app;
}

function auth(req) {
  return req.set('Authorization', 'Bearer test-secret');
}

function seedSyncedDeals() {
  const db = getDb();
  db.prepare(`
    INSERT INTO deals (crm_event_id, deal_key, data_source, title, twenty_id, approval_status, payment_amount)
    VALUES ('evt1', 'evt1#1', 'calendar', 'A7 pay', 'opp-1', 'synced', 100)
  `).run();
  db.prepare(`
    INSERT INTO deals (crm_event_id, deal_key, data_source, title, twenty_id, approval_status, payment_amount)
    VALUES ('evt2', 'evt2#1', 'calendar', 'A7 point', 'opp-2', 'synced', 50)
  `).run();
  db.prepare(`
    INSERT INTO deal_bitrix_links (deal_id, bitrix_id, role, is_canonical)
    VALUES (1, '2049067', 'payment', 1), (2, '2050903', 'booking', 1)
  `).run();
}

describe('POST /api/twenty/deal-groups', () => {
  beforeEach(() => {
    initDb();
    migrate();
    const db = getDb();
    db.prepare('DELETE FROM deal_group_members').run();
    db.prepare('DELETE FROM deal_groups').run();
    db.prepare('DELETE FROM deal_bitrix_links').run();
    db.prepare('DELETE FROM deal_items').run();
    db.prepare('DELETE FROM deals').run();
    seedSyncedDeals();

    confirmDealGroupMock.mockReset();
    mirrorDealGroupToTwentyMock.mockReset();
    clearDealGroupTwentyMock.mockReset();
    planExpenseRollupMock.mockReset();
    suggestDealGroupsMock.mockReset();
    buildExpenseUpdateInputMock.mockReset();
    gqlMock.mockReset();
    requireTwentyConfigMock.mockReset();

    requireTwentyConfigMock.mockReturnValue({
      apiUrl: 'https://twenty.test/graphql',
      apiToken: 'tok',
    });
    planExpenseRollupMock.mockReturnValue({
      canonicalDealId: 1,
      amounts: { printing: 100 },
    });
    buildExpenseUpdateInputMock.mockReturnValue({ rashodPechat: { amountMicros: 100_000_000, currencyCode: 'RUB' } });
    gqlMock.mockResolvedValue({ status: 200, data: { data: { updateOpportunity: { id: 'opp-1' } } } });
  });

  it('returns 400 canonical_required when confirm needs manual canonical', async () => {
    const err = new Error('canonical_required');
    err.code = 'CANONICAL_REQUIRED';
    err.status = 400;
    confirmDealGroupMock.mockImplementation(() => {
      throw err;
    });

    const res = await auth(
      request(createApp()).post('/api/twenty/deal-groups').send({
        twentyOppIds: ['opp-1', 'opp-2'],
      }),
    );

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('canonical_required');
    expect(mirrorDealGroupToTwentyMock).not.toHaveBeenCalled();
  });

  it('returns 409 when a deal is already grouped', async () => {
    const err = new Error('Deal 1 is already in a group');
    err.code = 'ALREADY_GROUPED';
    err.status = 409;
    err.dealId = 1;
    confirmDealGroupMock.mockImplementation(() => {
      throw err;
    });

    const res = await auth(
      request(createApp()).post('/api/twenty/deal-groups').send({
        twentyOppIds: ['opp-1', 'opp-2'],
        canonicalTwentyOppId: 'opp-1',
      }),
    );

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_GROUPED');
    expect(mirrorDealGroupToTwentyMock).not.toHaveBeenCalled();
  });

  it('confirms group, mirrors to Twenty, and applies expense rollup', async () => {
    confirmDealGroupMock.mockReturnValue({
      id: 42,
      name: 'A7',
      canonical_deal_id: 1,
      canonical_bitrix_id: '2049067',
      twenty_parent_id: null,
    });
    mirrorDealGroupToTwentyMock.mockResolvedValue({ parentTwentyId: 'parent-tw-1' });

    const res = await auth(
      request(createApp()).post('/api/twenty/deal-groups').send({
        twentyOppIds: ['opp-1', 'opp-2'],
        name: 'A7',
        nameLocked: true,
        canonicalTwentyOppId: 'opp-1',
        canonicalBitrixId: '2049067',
        canonicalLocked: true,
      }),
    );

    expect(res.status).toBe(200);
    expect(confirmDealGroupMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        dealIds: [1, 2],
        name: 'A7',
        nameLocked: true,
        canonicalDealId: 1,
        canonicalBitrixId: '2049067',
        canonicalLocked: true,
      }),
    );
    expect(mirrorDealGroupToTwentyMock).toHaveBeenCalledWith(expect.anything(), 42);
    expect(planExpenseRollupMock).toHaveBeenCalled();
    expect(buildExpenseUpdateInputMock).toHaveBeenCalledWith({ amounts: { printing: 100 } });
    expect(gqlMock).toHaveBeenCalled();
    expect(res.body).toMatchObject({
      group: expect.objectContaining({ id: 42, name: 'A7' }),
      parentTwentyId: 'parent-tw-1',
    });
  });

  it('returns 404 for unknown twentyOppId', async () => {
    const res = await auth(
      request(createApp()).post('/api/twenty/deal-groups').send({
        twentyOppIds: ['opp-1', 'missing-opp'],
      }),
    );

    expect(res.status).toBe(404);
    expect(confirmDealGroupMock).not.toHaveBeenCalled();
  });
});
