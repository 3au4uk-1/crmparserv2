import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';

const gqlMock = vi.fn();
const requireTwentyConfigMock = vi.fn();

vi.mock('../src/services/twenty-config.js', () => ({
  requireTwentyConfig: (...args) => requireTwentyConfigMock(...args),
}));

vi.mock('../src/services/twenty-gql.js', () => ({
  gql: (...args) => gqlMock(...args),
  assertHttpSuccess: (resp, apiUrl) => {
    if (resp.status >= 400) {
      throw new Error(`Twenty API error: HTTP ${resp.status} (${apiUrl})`);
    }
  },
  assertGqlSuccess: (resp, fallbackMessage) => {
    const errors = resp.data?.errors;
    if (errors?.length) {
      throw new Error(errors[0].message || fallbackMessage);
    }
  },
}));

import {
  mirrorDealGroupToTwenty,
  clearDealGroupTwenty,
} from '../src/services/deal-group-twenty.js';

function createDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE companies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      twenty_id TEXT
    );
    CREATE TABLE deals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      crm_event_id TEXT NOT NULL,
      title TEXT NOT NULL,
      company_code TEXT,
      load_date TEXT,
      load_time TEXT,
      tony_order_id TEXT,
      payment_amount REAL,
      twenty_id TEXT
    );
    CREATE TABLE deal_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      price REAL,
      quantity TEXT,
      sum REAL,
      quantity_num REAL,
      classification TEXT NOT NULL DEFAULT 'unclassified'
    );
    CREATE TABLE deal_bitrix_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      bitrix_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('payment', 'booking', 'other')),
      is_canonical INTEGER NOT NULL DEFAULT 0,
      UNIQUE (deal_id, bitrix_id)
    );
    CREATE TABLE deal_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      twenty_parent_id TEXT,
      name TEXT NOT NULL,
      name_locked INTEGER NOT NULL DEFAULT 0,
      canonical_deal_id INTEGER NOT NULL REFERENCES deals(id),
      canonical_bitrix_id TEXT NOT NULL,
      canonical_locked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE deal_group_members (
      group_id INTEGER NOT NULL REFERENCES deal_groups(id) ON DELETE CASCADE,
      deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      UNIQUE (deal_id)
    );
  `);
  return db;
}

function seedTwoMemberGroup(db, { twentyParentId = null } = {}) {
  db.prepare(
    `INSERT INTO companies (code, full_name, twenty_id) VALUES (?, ?, ?)`,
  ).run('ПРО', 'Prointeractive', 'company-tw-1');

  db.prepare(`
    INSERT INTO deals (
      crm_event_id, title, company_code, load_date, load_time,
      tony_order_id, payment_amount, twenty_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('evt1', 'ПРО/Для оплаты А7', 'ПРО', '2026-09-10', '10:00', '999', 2189149, 'child-tw-1');

  db.prepare(`
    INSERT INTO deals (
      crm_event_id, title, company_code, load_date, payment_amount, twenty_id
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run('evt2', 'ПРО/точка А7', 'ПРО', '2026-09-11', 0, 'child-tw-2');

  db.prepare(
    `INSERT INTO deal_items (deal_id, name, sum) VALUES (1, 'item', 936900)`,
  ).run();
  db.prepare(
    `INSERT INTO deal_items (deal_id, name, sum) VALUES (2, 'item', 22950)`,
  ).run();

  db.prepare(
    `INSERT INTO deal_bitrix_links (deal_id, bitrix_id, role, is_canonical) VALUES (1, '2049067', 'payment', 1)`,
  ).run();
  db.prepare(
    `INSERT INTO deal_bitrix_links (deal_id, bitrix_id, role, is_canonical) VALUES (2, '2050903', 'booking', 1)`,
  ).run();

  db.prepare(`
    INSERT INTO deal_groups (
      twenty_parent_id, name, canonical_deal_id, canonical_bitrix_id
    ) VALUES (?, ?, ?, ?)
  `).run(twentyParentId, 'А7', 1, '2049067');

  db.prepare(`INSERT INTO deal_group_members (group_id, deal_id) VALUES (1, 1)`).run();
  db.prepare(`INSERT INTO deal_group_members (group_id, deal_id) VALUES (1, 2)`).run();

  return 1;
}

function ok(data) {
  return { status: 200, data: { data } };
}

describe('deal-group-twenty', () => {
  let db;

  beforeEach(() => {
    db = createDb();
    gqlMock.mockReset();
    requireTwentyConfigMock.mockReset();
    requireTwentyConfigMock.mockReturnValue({
      apiUrl: 'https://crm.example/graphql',
      apiToken: 'tok',
    });
  });

  afterEach(() => db.close());

  it('creates parent, attaches two children, then updates parent amount', async () => {
    const groupId = seedTwoMemberGroup(db);

    gqlMock
      .mockResolvedValueOnce(ok({ createOpportunity: { id: 'parent-tw-1' } }))
      .mockResolvedValueOnce(ok({ updateOpportunity: { id: 'child-tw-1' } }))
      .mockResolvedValueOnce(ok({ updateOpportunity: { id: 'child-tw-2' } }))
      .mockResolvedValueOnce(ok({ updateOpportunity: { id: 'parent-tw-1' } }));

    const result = await mirrorDealGroupToTwenty(db, groupId);

    expect(result).toEqual({ parentTwentyId: 'parent-tw-1' });
    expect(gqlMock).toHaveBeenCalledTimes(4);

    const [createArgs, child1Args, child2Args, parentUpdArgs] = gqlMock.mock.calls;

    expect(createArgs[2]).toMatch(/createOpportunity/);
    expect(createArgs[3].data).toMatchObject({
      name: 'А7',
      amount: { amountMicros: 959_850_000_000, currencyCode: 'RUB' },
      loadDate: '2026-09-10T10:00:00+03:00',
      companyId: 'company-tw-1',
      parentOpportunityId: null,
    });

    expect(child1Args[2]).toMatch(/updateOpportunity/);
    expect(child1Args[3]).toEqual({
      id: 'child-tw-1',
      data: { parentOpportunityId: 'parent-tw-1' },
    });
    expect(child2Args[3]).toEqual({
      id: 'child-tw-2',
      data: { parentOpportunityId: 'parent-tw-1' },
    });

    expect(parentUpdArgs[3].id).toBe('parent-tw-1');
    expect(parentUpdArgs[3].data).toMatchObject({
      amount: { amountMicros: 959_850_000_000, currencyCode: 'RUB' },
      summaPostupleniy: { amountMicros: 2_189_149_000_000, currencyCode: 'RUB' },
      rashodItogo: { amountMicros: 0, currencyCode: 'RUB' },
      tonyLink: {
        primaryLinkUrl: 'https://crm.apihide.com/orders/orders_edit/?id=999',
        primaryLinkLabel: 'Tony #999',
      },
      bitrixLink: {
        primaryLinkUrl: expect.stringContaining('/2049067/'),
        primaryLinkLabel: 'Bitrix #2049067',
      },
    });

    const group = db.prepare('SELECT twenty_parent_id FROM deal_groups WHERE id = ?').get(groupId);
    expect(group.twenty_parent_id).toBe('parent-tw-1');
  });

  it('does not store twenty_parent_id when child attach fails', async () => {
    const groupId = seedTwoMemberGroup(db);

    gqlMock
      .mockResolvedValueOnce(ok({ createOpportunity: { id: 'parent-tw-orphan' } }))
      .mockRejectedValueOnce(new Error('child attach failed'));

    await expect(mirrorDealGroupToTwenty(db, groupId)).rejects.toThrow(/child attach failed/);

    const group = db.prepare('SELECT twenty_parent_id FROM deal_groups WHERE id = ?').get(groupId);
    expect(group.twenty_parent_id).toBeNull();
  });

  it('skips create when twenty_parent_id already set', async () => {
    const groupId = seedTwoMemberGroup(db, { twentyParentId: 'parent-existing' });

    gqlMock
      .mockResolvedValueOnce(ok({ updateOpportunity: { id: 'child-tw-1' } }))
      .mockResolvedValueOnce(ok({ updateOpportunity: { id: 'child-tw-2' } }))
      .mockResolvedValueOnce(ok({ updateOpportunity: { id: 'parent-existing' } }));

    const result = await mirrorDealGroupToTwenty(db, groupId);

    expect(result).toEqual({ parentTwentyId: 'parent-existing' });
    expect(gqlMock.mock.calls.every((c) => !/createOpportunity/.test(c[2]))).toBe(true);
    expect(gqlMock).toHaveBeenCalledTimes(3);
  });

  it('clearDealGroupTwenty nulls children then deletes empty parent', async () => {
    const groupId = seedTwoMemberGroup(db, { twentyParentId: 'parent-tw-1' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    gqlMock
      .mockResolvedValueOnce(ok({ updateOpportunity: { id: 'child-tw-1' } }))
      .mockResolvedValueOnce(ok({ updateOpportunity: { id: 'child-tw-2' } }))
      .mockResolvedValueOnce(ok({ dealLineItems: { edges: [] } }))
      .mockResolvedValueOnce(ok({ deleteOpportunity: { id: 'parent-tw-1' } }));

    await clearDealGroupTwenty(db, groupId);

    expect(gqlMock.mock.calls[0][3]).toEqual({
      id: 'child-tw-1',
      data: { parentOpportunityId: null },
    });
    expect(gqlMock.mock.calls[1][3]).toEqual({
      id: 'child-tw-2',
      data: { parentOpportunityId: null },
    });
    expect(gqlMock.mock.calls[2][2]).toMatch(/dealLineItems/);
    expect(gqlMock.mock.calls[3][2]).toMatch(/deleteOpportunity/);

    const group = db.prepare('SELECT twenty_parent_id FROM deal_groups WHERE id = ?').get(groupId);
    expect(group.twenty_parent_id).toBeNull();
    warn.mockRestore();
  });

  it('clearDealGroupTwenty skips delete when parent has dealLineItems', async () => {
    const groupId = seedTwoMemberGroup(db, { twentyParentId: 'parent-tw-1' });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    gqlMock
      .mockResolvedValueOnce(ok({ updateOpportunity: { id: 'child-tw-1' } }))
      .mockResolvedValueOnce(ok({ updateOpportunity: { id: 'child-tw-2' } }))
      .mockResolvedValueOnce(ok({ dealLineItems: { edges: [{ node: { id: 'li-1' } }] } }));

    await clearDealGroupTwenty(db, groupId);

    expect(gqlMock.mock.calls.some((c) => /deleteOpportunity/.test(c[2]))).toBe(false);
    expect(warn).toHaveBeenCalled();

    const group = db.prepare('SELECT twenty_parent_id FROM deal_groups WHERE id = ?').get(groupId);
    expect(group.twenty_parent_id).toBe('parent-tw-1');
    warn.mockRestore();
  });
});
