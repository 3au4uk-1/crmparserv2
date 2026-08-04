import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

let testDb;

vi.mock('../src/db/connection.js', () => ({
  getDb: () => testDb,
}));

import { migrate } from '../src/db/migrate.js';
import {
  runOpportunityAmountRecalcIfNeeded,
  resolveRecalcFlagState,
  opportunityAmountNeedsUpdate,
  RECALC_FLAG_KEY,
  RECALC_STARTED_AT_KEY,
  ONE_RUB_MICROS,
} from '../src/services/opportunity-amount-recalc.js';

function createTestDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  return db;
}

function readFlag(db, key) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? null;
}

function insertSyncedDeal(db, { id = 1, twentyId = 'opp-1', title = 'Deal 1' } = {}) {
  db.prepare(`
    INSERT INTO deals (id, crm_event_id, title, twenty_id)
    VALUES (?, ?, ?, ?)
  `).run(id, `evt-${id}`, title, twentyId);
}

describe('opportunityAmountNeedsUpdate', () => {
  it('returns false when amounts differ by less than 1 RUB', () => {
    expect(
      opportunityAmountNeedsUpdate(
        { amountMicros: 10_000_000_000, currencyCode: 'RUB' },
        { amountMicros: 10_000_000_000 + ONE_RUB_MICROS - 1, currencyCode: 'RUB' },
      ),
    ).toBe(false);
  });

  it('returns true when amounts differ by at least 1 RUB', () => {
    expect(
      opportunityAmountNeedsUpdate(
        { amountMicros: 10_000_000_000, currencyCode: 'RUB' },
        { amountMicros: 10_000_000_000 + ONE_RUB_MICROS, currencyCode: 'RUB' },
      ),
    ).toBe(true);
  });

  it('returns false when amounts are equal', () => {
    expect(
      opportunityAmountNeedsUpdate(
        { amountMicros: 5_000_000_000, currencyCode: 'RUB' },
        { amountMicros: 5_000_000_000, currencyCode: 'RUB' },
      ),
    ).toBe(false);
  });
});

describe('resolveRecalcFlagState', () => {
  let db;

  beforeEach(() => {
    testDb = createTestDb();
    migrate();
    db = testDb;
  });

  afterEach(() => {
    db.close();
  });

  it('skips when flag is done', () => {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(RECALC_FLAG_KEY, 'done');
    expect(resolveRecalcFlagState(db)).toEqual({ shouldRun: false, reason: 'done' });
  });

  it('skips fresh running within 6 hours', () => {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(RECALC_FLAG_KEY, 'running');
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
      RECALC_STARTED_AT_KEY,
      '2026-08-04T11:00:00.000Z',
    );
    expect(resolveRecalcFlagState(db, Date.parse('2026-08-04T12:00:00.000Z'))).toEqual({
      shouldRun: false,
      reason: 'running',
    });
  });

  it('retries stale running older than 6 hours', () => {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(RECALC_FLAG_KEY, 'running');
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
      RECALC_STARTED_AT_KEY,
      '2026-08-04T03:00:00.000Z',
    );
    expect(resolveRecalcFlagState(db, Date.parse('2026-08-04T12:00:00.000Z'))).toEqual({
      shouldRun: true,
      reason: 'stale_running',
    });
  });
});

describe('runOpportunityAmountRecalcIfNeeded', () => {
  let db;
  let gqlMock;
  let listLineItemsMock;

  beforeEach(() => {
    testDb = createTestDb();
    migrate();
    db = testDb;
    gqlMock = vi.fn();
    listLineItemsMock = vi.fn();
  });

  afterEach(() => {
    db.close();
  });

  const baseDeps = () => ({
    getDb: () => db,
    requireTwentyConfig: () => ({ apiUrl: 'https://crm.example/graphql', apiToken: 'tok' }),
    gql: gqlMock,
    assertHttpSuccess: () => {},
    assertGqlSuccess: () => {},
    listLineItems: listLineItemsMock,
    now: () => Date.parse('2026-08-04T12:00:00.000Z'),
    log: { error: vi.fn(), info: vi.fn() },
  });

  it('skips when settings flag is done', async () => {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(RECALC_FLAG_KEY, 'done');

    const result = await runOpportunityAmountRecalcIfNeeded(baseDeps());

    expect(result).toEqual({ status: 'skipped', reason: 'done' });
    expect(gqlMock).not.toHaveBeenCalled();
    expect(listLineItemsMock).not.toHaveBeenCalled();
  });

  it('skips when running started less than 6 hours ago', async () => {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(RECALC_FLAG_KEY, 'running');
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
      RECALC_STARTED_AT_KEY,
      '2026-08-04T11:00:00.000Z',
    );
    insertSyncedDeal(db);

    const result = await runOpportunityAmountRecalcIfNeeded(baseDeps());

    expect(result).toEqual({ status: 'skipped', reason: 'running' });
    expect(listLineItemsMock).not.toHaveBeenCalled();
  });

  it('retries when running started_at is older than 6 hours', async () => {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(RECALC_FLAG_KEY, 'running');
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
      RECALC_STARTED_AT_KEY,
      '2026-08-04T03:00:00.000Z',
    );
    insertSyncedDeal(db);
    listLineItemsMock.mockResolvedValue([
      { id: 'li-1', stage: 'NOVYY', amount: { amountMicros: 10_000_000_000, currencyCode: 'RUB' } },
    ]);
    gqlMock.mockResolvedValue({
      status: 200,
      data: {
        data: {
          opportunities: {
            edges: [{ node: { id: 'opp-1', amount: { amountMicros: 10_000_000_000, currencyCode: 'RUB' } } }],
          },
        },
      },
    });

    const result = await runOpportunityAmountRecalcIfNeeded(baseDeps());

    expect(result.status).toBe('done');
    expect(readFlag(db, RECALC_FLAG_KEY)).toBe('done');
    expect(listLineItemsMock).toHaveBeenCalled();
  });

  it('updates opportunity amount when it differs by at least 1 RUB excluding OTMENA lines', async () => {
    insertSyncedDeal(db);
    listLineItemsMock.mockResolvedValue([
      { id: 'li-active', stage: 'NOVYY', amount: { amountMicros: 10_000_000_000, currencyCode: 'RUB' } },
      { id: 'li-cancelled', stage: 'OTMENA', amount: { amountMicros: 5_000_000_000, currencyCode: 'RUB' } },
    ]);
    gqlMock.mockImplementation(async (_url, _token, query, variables) => {
      if (query.includes('GetOpportunityAmount')) {
        return {
          status: 200,
          data: {
            data: {
              opportunities: {
                edges: [{ node: { id: 'opp-1', amount: { amountMicros: 15_000_000_000, currencyCode: 'RUB' } } }],
              },
            },
          },
        };
      }
      if (query.includes('updateOpportunity')) {
        return { status: 200, data: { data: { updateOpportunity: { id: variables?.id } } } };
      }
      return { status: 200, data: { data: {} } };
    });

    const result = await runOpportunityAmountRecalcIfNeeded(baseDeps());

    expect(result.status).toBe('done');
    expect(result.updated).toBe(1);
    expect(readFlag(db, RECALC_FLAG_KEY)).toBe('done');
    const updateCall = gqlMock.mock.calls.find(([, , q]) => q.includes('updateOpportunity'));
    expect(updateCall?.[3]).toEqual({
      id: 'opp-1',
      input: { amount: { amountMicros: 10_000_000_000, currencyCode: 'RUB' } },
    });
    expect(gqlMock.mock.calls.some(([, , q]) => q.includes('updateDealLineItem'))).toBe(false);
  });

  it('skips update when opportunity amount already matches non-OTMENA sum', async () => {
    insertSyncedDeal(db);
    listLineItemsMock.mockResolvedValue([
      { id: 'li-active', stage: 'NOVYY', amount: { amountMicros: 10_000_000_000, currencyCode: 'RUB' } },
      { id: 'li-cancelled', stage: 'OTMENA', amount: { amountMicros: 5_000_000_000, currencyCode: 'RUB' } },
    ]);
    gqlMock.mockResolvedValue({
      status: 200,
      data: {
        data: {
          opportunities: {
            edges: [{ node: { id: 'opp-1', amount: { amountMicros: 10_000_000_000, currencyCode: 'RUB' } } }],
          },
        },
      },
    });

    const result = await runOpportunityAmountRecalcIfNeeded(baseDeps());

    expect(result.status).toBe('done');
    expect(result.updated).toBe(0);
    expect(gqlMock.mock.calls.some(([, , q]) => q.includes('updateOpportunity'))).toBe(false);
  });

  it('continues when a deal fails with a soft error', async () => {
    insertSyncedDeal(db, { id: 1, twentyId: 'opp-1' });
    insertSyncedDeal(db, { id: 2, twentyId: 'opp-2', title: 'Deal 2' });
    listLineItemsMock.mockImplementation(async (_gql, _url, _token, oppId) => {
      if (oppId === 'opp-1') throw new Error('soft deal error');
      return [{ id: 'li-1', stage: 'NOVYY', amount: { amountMicros: 3_000_000_000, currencyCode: 'RUB' } }];
    });
    gqlMock.mockImplementation(async (_url, _token, query) => {
      if (query.includes('GetOpportunityAmount')) {
        return {
          status: 200,
          data: {
            data: {
              opportunities: {
                edges: [{ node: { id: 'opp-2', amount: { amountMicros: 0, currencyCode: 'RUB' } } }],
              },
            },
          },
        };
      }
      return { status: 200, data: { data: { updateOpportunity: { id: 'opp-2' } } } };
    });

    const result = await runOpportunityAmountRecalcIfNeeded(baseDeps());

    expect(result.status).toBe('done');
    expect(readFlag(db, RECALC_FLAG_KEY)).toBe('done');
    expect(result.dealsFailed).toBe(1);
    expect(result.updated).toBe(1);
  });

  it('marks failed on hard gql error and does not set done', async () => {
    insertSyncedDeal(db);
    listLineItemsMock.mockRejectedValue(new Error('Twenty API: неверный токен или нет доступа (401/403)'));

    const result = await runOpportunityAmountRecalcIfNeeded(baseDeps());

    expect(result.status).toBe('failed');
    expect(readFlag(db, RECALC_FLAG_KEY)).toBe('failed');
    expect(readFlag(db, RECALC_FLAG_KEY)).not.toBe('done');
  });
});
