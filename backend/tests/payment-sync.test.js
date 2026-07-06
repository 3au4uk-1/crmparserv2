import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';

let testDb;

vi.mock('../src/db/connection.js', () => ({
  getDb: () => testDb,
}));

vi.mock('../src/services/auth.js', () => ({
  authenticate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/services/parser.js', () => ({
  fetchDescription: vi.fn(),
  parseDescriptionResponse: vi.fn(),
}));

vi.mock('../src/services/twenty-config.js', () => ({
  requireTwentyConfig: () => ({ apiUrl: 'https://crm.example/graphql', apiToken: 'tok' }),
}));

vi.mock('../src/services/twenty-gql.js', () => ({
  gql: vi.fn().mockResolvedValue({ status: 200, data: { data: { updateOpportunity: { id: 'opp-1' } } } }),
  assertHttpSuccess: vi.fn(),
  assertGqlSuccess: vi.fn(),
}));

import { migrate } from '../src/db/migrate.js';
import { fetchDescription, parseDescriptionResponse } from '../src/services/parser.js';
import {
  countPaymentSyncTargets,
  groupDealsByEvent,
  loadDealsForPaymentSync,
  normalizePaymentSyncRange,
  runPaymentSync,
} from '../src/services/payment-sync.js';
import { PAYMENT_STATUS } from '../src/services/payment-field-names.js';

const PAYMENT_HISTORY = `
<ul id="payment-history">
  <li data-payid="1">
    <span class="paysum">100 000.00</span>
    <select class="paystatus"><option value="1" selected>Предоплата</option></select>
  </li>
</ul>`;

function createDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  return db;
}

describe('payment-sync', () => {
  beforeEach(() => {
    testDb = createDb();
    migrate();
    vi.clearAllMocks();
    fetchDescription.mockResolvedValue({ payments: { history: PAYMENT_HISTORY } });
    parseDescriptionResponse.mockImplementation((data) => ({
      descHtml: data?.description || '',
      calPayments: data?.payments || null,
    }));
  });

  it('normalizePaymentSyncRange requires both dates', () => {
    expect(() => normalizePaymentSyncRange('2026-07-01', '')).toThrow(/from and to required/);
  });

  it('loadDealsForPaymentSync filters by start_date', () => {
    testDb.prepare(`
      INSERT INTO deals (crm_event_id, deal_key, title, start_date, twenty_id)
      VALUES ('evt-1', 'evt-1#cal', 'In range', '2026-07-05', 'tw-1'),
             ('evt-2', 'evt-2#cal', 'Out range', '2026-06-01', 'tw-2')
    `).run();

    const deals = loadDealsForPaymentSync(testDb, '2026-07-01', '2026-07-31');
    expect(deals).toHaveLength(1);
    expect(deals[0].crm_event_id).toBe('evt-1');
  });

  it('countPaymentSyncTargets returns range and twenty counts', () => {
    testDb.prepare(`
      INSERT INTO deals (crm_event_id, deal_key, title, start_date, twenty_id)
      VALUES ('evt-1', 'evt-1#cal', 'Synced', '2026-07-05', 'tw-1'),
             ('evt-2', 'evt-2#cal', 'Local only', '2026-07-06', NULL)
    `).run();

    expect(countPaymentSyncTargets(testDb, '2026-07-01', '2026-07-31')).toEqual({
      dealsInRange: 2,
      dealsInTwenty: 1,
    });
  });

  it('groupDealsByEvent groups multiple deals per calendar event', () => {
    const grouped = groupDealsByEvent([
      { id: 1, crm_event_id: '10' },
      { id: 2, crm_event_id: '10' },
      { id: 3, crm_event_id: '11' },
    ]);
    expect(grouped.get('10')).toHaveLength(2);
    expect(grouped.get('11')).toHaveLength(1);
  });

  it('runPaymentSync updates local DB and Twenty for deals in range', async () => {
    testDb.prepare(`
      INSERT INTO deals (crm_event_id, deal_key, title, start_date, twenty_id)
      VALUES ('evt-1', 'evt-1#cal', 'Deal A', '2026-07-05', 'tw-1')
    `).run();

    const result = await runPaymentSync({ from: '2026-07-01', to: '2026-07-31' });

    expect(fetchDescription).toHaveBeenCalledWith('evt-1');
    expect(result.dealsUpdatedLocal).toBe(1);
    expect(result.dealsUpdatedTwenty).toBe(1);
    expect(result.dealsWithPayments).toBe(1);

    const deal = testDb.prepare('SELECT payment_amount, payment_status FROM deals WHERE id = 1').get();
    expect(deal.payment_amount).toBe(100000);
    expect(deal.payment_status).toBe(PAYMENT_STATUS.PREPAYMENT);
  });
});
