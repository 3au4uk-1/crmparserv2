import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

let testDb;

vi.mock('../src/db/connection.js', () => ({
  getDb: () => testDb,
}));

import { migrate } from '../src/db/migrate.js';
import {
  isFreeEntryTemplateName,
  planTwentyFreeEntryRename,
  planTwentyNameDisambiguation,
  planLocalTwentyIdUntangle,
  dealNeedsFreeEntryRepair,
  runFreeEntryDuplicateRepairIfNeeded,
  REPAIR_FLAG_KEY,
  REPAIR_STARTED_AT_KEY,
} from '../src/services/free-entry-duplicate-repair.js';

const FREE_ENTRY_TEMPLATE =
  'БРЕНДИНГ свободная запись ( КОМЕНТАРИЙ ОБЯЗАТЕЛЕН )';

describe('free-entry-duplicate-repair', () => {
  describe('isFreeEntryTemplateName', () => {
    it('detects free-entry template case-insensitively', () => {
      expect(isFreeEntryTemplateName(FREE_ENTRY_TEMPLATE)).toBe(true);
      expect(isFreeEntryTemplateName('брендинг СВОБОДНАЯ запись')).toBe(true);
      expect(isFreeEntryTemplateName('Баннер 2x3')).toBe(false);
    });
  });

  describe('planTwentyFreeEntryRename', () => {
    it('plans rename from first comment line for template rows', () => {
      expect(
        planTwentyFreeEntryRename({
          id: 'li-1',
          name: FREE_ENTRY_TEMPLATE,
          kommentariy: 'Логотип на стол',
        }),
      ).toEqual({
        id: 'li-1',
        name: 'Логотип на стол',
        kommentariy: '',
      });
    });

    it('uses first line only for multiline comments', () => {
      expect(
        planTwentyFreeEntryRename({
          id: 'li-1',
          name: FREE_ENTRY_TEMPLATE,
          kommentariy: 'Первая строка\nвторая',
        }),
      ).toEqual({
        id: 'li-1',
        name: 'Первая строка',
        kommentariy: '',
      });
    });

    it('returns null when name is not a template or comment is empty', () => {
      expect(
        planTwentyFreeEntryRename({
          id: 'li-1',
          name: 'Логотип на стол',
          kommentariy: 'другой текст',
        }),
      ).toBeNull();
      expect(
        planTwentyFreeEntryRename({
          id: 'li-1',
          name: FREE_ENTRY_TEMPLATE,
          kommentariy: '  ',
        }),
      ).toBeNull();
    });
  });

  describe('planTwentyNameDisambiguation', () => {
    it('suffixes duplicate names by createdAt then id', () => {
      const plan = planTwentyNameDisambiguation([
        { id: 'b', name: 'Макет', createdAt: '2026-01-02' },
        { id: 'a', name: 'Макет', createdAt: '2026-01-01' },
        { id: 'c', name: 'Баннер', createdAt: '2026-01-01' },
      ]);
      expect(plan).toEqual([{ id: 'b', name: 'Макет (#2)' }]);
    });

    it('is idempotent when names already have (#N) suffixes', () => {
      const items = [
        { id: 'a', name: 'Макет', createdAt: '2026-01-01' },
        { id: 'b', name: 'Макет (#2)', createdAt: '2026-01-02' },
      ];
      expect(planTwentyNameDisambiguation(items)).toEqual([]);
      expect(planTwentyNameDisambiguation(items)).toEqual([]);
    });

    it('skips items that already match their expected disambig suffix', () => {
      const plan = planTwentyNameDisambiguation([
        { id: 'a', name: 'Макет', createdAt: '2026-01-01' },
        { id: 'b', name: 'Макет (#2)', createdAt: '2026-01-02' },
        { id: 'c', name: 'Макет', createdAt: '2026-01-03' },
      ]);
      expect(plan).toEqual([{ id: 'c', name: 'Макет (#3)' }]);
    });
  });

  describe('planLocalTwentyIdUntangle', () => {
    it('untangles shared twenty_id preferring amount_locked', () => {
      const local = [
        { id: 1, name: 'Макет', twenty_id: 'li-shared', amount_locked: 0 },
        { id: 2, name: 'Макет (#2)', twenty_id: 'li-shared', amount_locked: 1 },
      ];
      const twenty = [
        { id: 'li-shared', name: 'Макет' },
        { id: 'li-orphan', name: 'Макет (#2)' },
      ];
      const plan = planLocalTwentyIdUntangle(local, twenty);
      expect(plan).toEqual(
        expect.arrayContaining([
          { localId: 2, twenty_id: 'li-shared' },
          { localId: 1, twenty_id: 'li-orphan' },
        ]),
      );
    });

    it('clears twenty_id when no orphan match is available', () => {
      const local = [
        { id: 1, name: 'Макет', twenty_id: 'li-shared', amount_locked: 0 },
        { id: 2, name: 'Макет (#2)', twenty_id: 'li-shared', amount_locked: 1 },
      ];
      const twenty = [{ id: 'li-shared', name: 'Макет' }];
      const plan = planLocalTwentyIdUntangle(local, twenty);
      expect(plan).toEqual(
        expect.arrayContaining([{ localId: 1, twenty_id: null }]),
      );
    });
  });

  describe('dealNeedsFreeEntryRepair', () => {
    it('returns true for template names, shared twenty_id, or duplicate normalized names', () => {
      expect(
        dealNeedsFreeEntryRepair({
          localItems: [{ id: 1, name: FREE_ENTRY_TEMPLATE, twenty_id: 'li-1' }],
          twentyItems: [{ id: 'li-1', name: FREE_ENTRY_TEMPLATE }],
        }),
      ).toBe(true);
      expect(
        dealNeedsFreeEntryRepair({
          localItems: [
            { id: 1, name: 'A', twenty_id: 'li-shared' },
            { id: 2, name: 'B', twenty_id: 'li-shared' },
          ],
          twentyItems: [
            { id: 'li-shared', name: 'A' },
            { id: 'li-other', name: 'B' },
          ],
        }),
      ).toBe(true);
      expect(
        dealNeedsFreeEntryRepair({
          localItems: [],
          twentyItems: [
            { id: 'li-1', name: 'Макет' },
            { id: 'li-2', name: 'Макет' },
          ],
        }),
      ).toBe(true);
    });

    it('returns false when deal has no repair triggers', () => {
      expect(
        dealNeedsFreeEntryRepair({
          localItems: [
            { id: 1, name: 'Макет', twenty_id: 'li-1' },
            { id: 2, name: 'Баннер', twenty_id: 'li-2' },
          ],
          twentyItems: [
            { id: 'li-1', name: 'Макет' },
            { id: 'li-2', name: 'Баннер' },
          ],
        }),
      ).toBe(false);
    });
  });
});

function createRepairTestDb() {
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

describe('runFreeEntryDuplicateRepairIfNeeded', () => {
  let db;
  let gqlMock;

  beforeEach(() => {
    testDb = createRepairTestDb();
    migrate();
    db = testDb;
    gqlMock = vi.fn().mockResolvedValue({
      status: 200,
      data: { data: { dealLineItems: { edges: [] }, updateOpportunity: { id: 'opp-1' } } },
    });
  });

  afterEach(() => {
    db.close();
  });

  it('skips when settings flag is done', async () => {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(REPAIR_FLAG_KEY, 'done');

    const result = await runFreeEntryDuplicateRepairIfNeeded({
      getDb: () => db,
      requireTwentyConfig: () => ({ apiUrl: 'https://crm.example/graphql', apiToken: 'tok' }),
      gql: gqlMock,
      assertHttpSuccess: () => {},
      assertGqlSuccess: () => {},
    });

    expect(result).toEqual({ status: 'skipped', reason: 'done' });
    expect(gqlMock).not.toHaveBeenCalled();
  });

  it('marks failed on hard gql error and does not set done', async () => {
    insertSyncedDeal(db);
    gqlMock.mockRejectedValue(new Error('Twenty API: неверный токен или нет доступа (401/403)'));

    const result = await runFreeEntryDuplicateRepairIfNeeded({
      getDb: () => db,
      requireTwentyConfig: () => ({ apiUrl: 'https://crm.example/graphql', apiToken: 'tok' }),
      gql: gqlMock,
      assertHttpSuccess: () => {},
      assertGqlSuccess: () => {},
      now: () => Date.parse('2026-08-04T12:00:00.000Z'),
      log: { error: vi.fn() },
    });

    expect(result.status).toBe('failed');
    expect(readFlag(db, REPAIR_FLAG_KEY)).toBe('failed');
    expect(readFlag(db, REPAIR_FLAG_KEY)).not.toBe('done');
  });

  it('continues repair when assertGqlSuccess fails on line item mutation', async () => {
    insertSyncedDeal(db, { id: 1, twentyId: 'opp-1' });
    insertSyncedDeal(db, { id: 2, twentyId: 'opp-2', title: 'Deal 2' });
    db.prepare(`
      INSERT INTO deal_items (deal_id, name, price, quantity, classification, twenty_id)
      VALUES (1, ?, 100, '1', 'keyword_match', 'li-1')
    `).run(FREE_ENTRY_TEMPLATE);

    gqlMock.mockImplementation(async (_url, _token, query, variables) => {
      if (query.includes('ListLineItemsForRepair')) {
        if (variables?.oppId === 'opp-1') {
          return {
            status: 200,
            data: {
              data: {
                dealLineItems: {
                  edges: [
                    {
                      node: {
                        id: 'li-1',
                        name: FREE_ENTRY_TEMPLATE,
                        kommentariy: 'Логотип на стол',
                        createdAt: '2026-01-01',
                      },
                    },
                  ],
                },
              },
            },
          };
        }
        return { status: 200, data: { data: { dealLineItems: { edges: [] } } } };
      }
      return {
        status: 200,
        data: {
          data: {
            updateDealLineItem: { id: variables?.id },
            updateOpportunity: { id: variables?.id },
          },
        },
      };
    });

    const assertGql = vi.fn((_resp, fallbackMessage) => {
      if (fallbackMessage?.includes('Failed to update line item')) {
        throw new Error(fallbackMessage);
      }
    });

    const result = await runFreeEntryDuplicateRepairIfNeeded({
      getDb: () => db,
      requireTwentyConfig: () => ({ apiUrl: 'https://crm.example/graphql', apiToken: 'tok' }),
      gql: gqlMock,
      assertHttpSuccess: () => {},
      assertGqlSuccess: assertGql,
      now: () => Date.parse('2026-08-04T12:00:00.000Z'),
      log: { error: vi.fn(), info: vi.fn() },
    });

    expect(result.status).toBe('done');
    expect(readFlag(db, REPAIR_FLAG_KEY)).toBe('done');
    expect(result.dealsFailed).toBeGreaterThanOrEqual(1);
    expect(result.dealsSkipped).toBe(1);
    expect(gqlMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.stringContaining('ListLineItemsForRepair'),
      expect.objectContaining({ oppId: 'opp-2' }),
    );
  });

  it('sets done after processing deals even with soft per-deal errors', async () => {
    insertSyncedDeal(db, { id: 1, twentyId: 'opp-1' });
    insertSyncedDeal(db, { id: 2, twentyId: 'opp-2', title: 'Deal 2' });
    db.prepare(`
      INSERT INTO deal_items (deal_id, name, price, quantity, classification, twenty_id)
      VALUES (2, 'Макет', 100, '1', 'keyword_match', 'li-shared'),
             (2, 'Макет (#2)', 200, '1', 'keyword_match', 'li-shared')
    `).run();

    gqlMock.mockImplementation(async (_url, _token, query, variables) => {
      if (query.includes('ListLineItemsForRepair')) {
        if (variables?.oppId === 'opp-1') {
          return { status: 200, data: { data: { dealLineItems: { edges: [] } } } };
        }
        return {
          status: 200,
          data: {
            data: {
              dealLineItems: {
                edges: [
                  { node: { id: 'li-shared', name: 'Макет', kommentariy: '', createdAt: '2026-01-01' } },
                  { node: { id: 'li-orphan', name: 'Макет (#2)', kommentariy: '', createdAt: '2026-01-02' } },
                ],
              },
            },
          },
        };
      }
      if (query.includes('updateOpportunity') && variables?.id === 'opp-2') {
        throw new Error('soft deal error');
      }
      if (query.includes('updateOpportunity')) {
        return { status: 200, data: { data: { updateOpportunity: { id: variables?.id } } } };
      }
      return { status: 200, data: { data: { updateDealLineItem: { id: 'li-shared' } } } };
    });

    const result = await runFreeEntryDuplicateRepairIfNeeded({
      getDb: () => db,
      requireTwentyConfig: () => ({ apiUrl: 'https://crm.example/graphql', apiToken: 'tok' }),
      gql: gqlMock,
      assertHttpSuccess: () => {},
      assertGqlSuccess: () => {},
      now: () => Date.parse('2026-08-04T12:00:00.000Z'),
      log: { error: vi.fn(), info: vi.fn() },
    });

    expect(result.status).toBe('done');
    expect(readFlag(db, REPAIR_FLAG_KEY)).toBe('done');
    expect(result.dealsFailed).toBe(1);
    expect(result.dealsSkipped).toBe(1);
  });

  it('skips when running started less than 6 hours ago', async () => {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(REPAIR_FLAG_KEY, 'running');
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
      REPAIR_STARTED_AT_KEY,
      '2026-08-04T11:00:00.000Z',
    );
    insertSyncedDeal(db);

    const result = await runFreeEntryDuplicateRepairIfNeeded({
      getDb: () => db,
      requireTwentyConfig: () => ({ apiUrl: 'https://crm.example/graphql', apiToken: 'tok' }),
      gql: gqlMock,
      now: () => Date.parse('2026-08-04T12:00:00.000Z'),
    });

    expect(result).toEqual({ status: 'skipped', reason: 'running' });
    expect(gqlMock).not.toHaveBeenCalled();
  });

  it('marks failed when list returns HTTP 401 without rejecting', async () => {
    insertSyncedDeal(db);
    gqlMock.mockResolvedValue({ status: 401, data: {} });

    const result = await runFreeEntryDuplicateRepairIfNeeded({
      getDb: () => db,
      requireTwentyConfig: () => ({ apiUrl: 'https://crm.example/graphql', apiToken: 'tok' }),
      gql: gqlMock,
      now: () => Date.parse('2026-08-04T12:00:00.000Z'),
      log: { error: vi.fn() },
    });

    expect(result.status).toBe('failed');
    expect(readFlag(db, REPAIR_FLAG_KEY)).toBe('failed');
    expect(readFlag(db, REPAIR_FLAG_KEY)).not.toBe('done');
  });

  it('retries when flag is failed and completes successfully', async () => {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(REPAIR_FLAG_KEY, 'failed');
    insertSyncedDeal(db);

    const result = await runFreeEntryDuplicateRepairIfNeeded({
      getDb: () => db,
      requireTwentyConfig: () => ({ apiUrl: 'https://crm.example/graphql', apiToken: 'tok' }),
      gql: gqlMock,
      assertHttpSuccess: () => {},
      assertGqlSuccess: () => {},
      now: () => Date.parse('2026-08-04T12:00:00.000Z'),
      log: { error: vi.fn(), info: vi.fn() },
    });

    expect(result.status).toBe('done');
    expect(readFlag(db, REPAIR_FLAG_KEY)).toBe('done');
    expect(result.reason).toBe('retry_failed');
  });

  it('retries when running started_at is older than 6 hours', async () => {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(REPAIR_FLAG_KEY, 'running');
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(
      REPAIR_STARTED_AT_KEY,
      '2026-08-04T03:00:00.000Z',
    );
    insertSyncedDeal(db);

    const result = await runFreeEntryDuplicateRepairIfNeeded({
      getDb: () => db,
      requireTwentyConfig: () => ({ apiUrl: 'https://crm.example/graphql', apiToken: 'tok' }),
      gql: gqlMock,
      assertHttpSuccess: () => {},
      assertGqlSuccess: () => {},
      now: () => Date.parse('2026-08-04T12:00:00.000Z'),
      log: { error: vi.fn(), info: vi.fn() },
    });

    expect(result.status).toBe('done');
    expect(readFlag(db, REPAIR_FLAG_KEY)).toBe('done');
    expect(gqlMock).toHaveBeenCalled();
  });
});
