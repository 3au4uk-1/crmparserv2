import { describe, it, expect } from 'vitest';
import {
  buildOpportunityInput,
  buildPaymentFieldsInput,
  computeDealItemsTotal,
  computeLineItemTotal,
  parseQuantity,
  parseQuantityNum,
  DEFAULT_OPPORTUNITY_STAGE,
} from '../src/services/twenty-opportunity.js';

describe('buildOpportunityInput', () => {
  const deal = {
    title: 'ПРО Иванов 12345',
    crm_event_id: 'evt-1',
    start_date: '2026-06-10',
    end_date: '2026-06-11',
    tony_order_id: '99',
    crm_lead_id: ' 42 ',
    arrival_time: '09:00',
    ready_time: '10:00',
    work_time: '11:00',
    dismantle_time: '18:00',
  };

  const items = [{ name: 'Баннер', price: 15000 }];

  it('builds create input with stage and amount', () => {
    const input = buildOpportunityInput(deal, items, {
      includeStage: true,
      stage: DEFAULT_OPPORTUNITY_STAGE,
      companyTwentyId: 'comp-1',
      personTwentyId: 'person-1',
    });

    expect(input.name).toBe('ПРО Иванов 12345');
    expect(input.stage).toBe('NOVYY');
    expect(input.closeDate).toBe('2026-06-10T09:00:00+03:00');
    expect(input.amount).toEqual({ amountMicros: 15000000000, currencyCode: 'RUB' });
    expect(input.companyId).toBe('comp-1');
    expect(input.pointOfContactId).toBe('person-1');
    expect(input.tonyLink.primaryLinkUrl).toContain('id=99');
    expect(input.bitrixLink.primaryLinkUrl).toContain('/42/?any');
    expect(input.arrivalTime).toBe('09:00');
  });

  it('omits stage when includeStage is false', () => {
    const input = buildOpportunityInput(deal, items, { includeStage: false });
    expect(input.stage).toBeUndefined();
    expect(input.amount.amountMicros).toBe(15000000000);
  });

  it('zero amount when no items', () => {
    const input = buildOpportunityInput(deal, [], { includeStage: false });
    expect(input.amount).toEqual({ amountMicros: 0, currencyCode: 'RUB' });
  });

  it('closeDate at midnight when no arrival_time', () => {
    const input = buildOpportunityInput(
      { ...deal, arrival_time: null },
      items,
      { includeStage: false }
    );
    expect(input.closeDate).toBe('2026-06-10T00:00:00+03:00');
  });

  it('computes amount from calendar price as line total (not price × qty)', () => {
    const d = {
      title: 'T',
      crm_event_id: 'e1',
      start_date: '2026-06-16T00:00:00+03:00',
      data_source: 'calendar',
    };
    const qtyItems = [
      { price: 23760, quantity: '9' },
      { price: 5000, quantity: '1' },
    ];
    const input = buildOpportunityInput(d, qtyItems);
    expect(input.amount.amountMicros).toBe((23760 + 5000) * 1_000_000);
  });

  it('includes loadDate when deal has load_date', () => {
    const d = { title: 'T', crm_event_id: 'e1', load_date: '2026-06-16', load_time: '04:00' };
    const input = buildOpportunityInput(d, []);
    expect(input.loadDate).toBe('2026-06-16T04:00:00+03:00');
  });

  it('omits loadDate when no load_date', () => {
    const input = buildOpportunityInput({ title: 'T', crm_event_id: 'e1' }, []);
    expect(input.loadDate).toBeUndefined();
  });

  it('includes payment fields when deal has payments', () => {
    const input = buildOpportunityInput(
      { title: 'T', crm_event_id: 'e1', payment_amount: 235752, payment_status: 'PREDOPLATA' },
      []
    );
    expect(input.summaPostupleniy).toEqual({ amountMicros: 235752_000_000, currencyCode: 'RUB' });
    expect(input.statusOplaty).toBe('PREDOPLATA');
  });

  it('buildPaymentFieldsInput always includes amount and status', () => {
    const input = buildPaymentFieldsInput({ payment_amount: 0, payment_status: 'NE_OPLACHENO' });
    expect(input.summaPostupleniy.amountMicros).toBe(0);
    expect(input.statusOplaty).toBe('NE_OPLACHENO');
  });

  it('omits payment amount when zero', () => {
    const input = buildOpportunityInput(
      { title: 'T', crm_event_id: 'e1', payment_amount: 0, payment_status: 'NE_OPLACHENO' },
      []
    );
    expect(input.summaPostupleniy).toBeUndefined();
    expect(input.statusOplaty).toBe('NE_OPLACHENO');
  });
});

describe('parseQuantity', () => {
  it('parses numeric strings, defaults to 1 for non-numeric', () => {
    expect(parseQuantity('9')).toBe(9);
    expect(parseQuantity('∞')).toBe(1);
    expect(parseQuantity(null)).toBe(1);
  });
});

describe('computeDealItemsTotal', () => {
  it('sums item.sum for Tony deals', () => {
    const deal = { data_source: 'tony' };
    const items = [
      { price: 2640, quantity: '9', sum: 23760 },
      { price: 5000, quantity: '1', sum: 5000 },
    ];
    expect(computeDealItemsTotal(deal, items)).toBe(28760);
  });

  it('uses calendar price as line total (Итого), not unit × qty', () => {
    const deal = { data_source: 'calendar' };
    const items = [
      { price: 161364, quantity: '2 шт.' },
      { price: 82716, quantity: '1 шт.' },
    ];
    expect(computeDealItemsTotal(deal, items)).toBe(161364 + 82716);
  });

  it('buildOpportunityInput uses Tony sum for amount', () => {
    const deal = { data_source: 'tony', title: 'T', crm_event_id: 'e1', start_date: '2026-06-16' };
    const items = [
      { price: 2640, quantity: '9', sum: 23760 },
      { price: 5000, quantity: '1', sum: 5000 },
    ];
    const input = buildOpportunityInput(deal, items);
    expect(input.amount.amountMicros).toBe(28760 * 1_000_000);
  });

  it('falls back to price * qty for Tony items missing sum', () => {
    const deal = { data_source: 'tony' };
    const items = [
      { price: 33600, quantity: '1', quantity_num: 1 },
      { price: 40000, quantity: '1', quantity_num: 1 },
    ];
    expect(computeDealItemsTotal(deal, items)).toBe(73600);
  });
});

describe('parseQuantityNum', () => {
  it('parses integers and decimals, defaults to 1 for invalid', () => {
    expect(parseQuantityNum('9')).toBe(9);
    expect(parseQuantityNum('9,5')).toBe(9.5);
    expect(parseQuantityNum('9.5')).toBe(9.5);
    expect(parseQuantityNum(' 2 ')).toBe(2);
    expect(parseQuantityNum('∞')).toBe(1);
    expect(parseQuantityNum(null)).toBe(1);
  });
});

describe('restoration pricing', () => {
  const restorationList = [
    { id: 1, pattern: 'колесо фортуны', matchType: 'exact' },
  ];

  it('computeLineItemTotal returns 0 for restoration match', () => {
    const deal = { data_source: 'tony' };
    const item = { name: 'Колесо фортуны', price: 18900, quantity: '1', sum: 18900 };
    expect(computeLineItemTotal(item, deal, restorationList)).toBe(0);
  });

  it('computeLineItemTotal unchanged without match', () => {
    const deal = { data_source: 'tony' };
    const item = { name: 'Колесо фортуны', price: 18900, quantity: '1', sum: 18900 };
    expect(
      computeLineItemTotal({ ...item, name: 'Баннер' }, deal, restorationList)
    ).toBe(18900);
  });

  it('computeDealItemsTotal excludes restoration rubles', () => {
    const deal = { data_source: 'tony' };
    const items = [
      { name: 'Колесо фортуны', price: 18900, quantity: '1', sum: 18900 },
      { name: 'Баннер', price: 10000, quantity: '1', sum: 10000 },
    ];
    expect(computeDealItemsTotal(deal, items, restorationList)).toBe(10000);
  });

  it('buildOpportunityInput amount excludes restoration', () => {
    const d = { data_source: 'tony', title: 'T', crm_event_id: 'e1', start_date: '2026-06-16' };
    const input = buildOpportunityInput(
      d,
      [
        { name: 'Колесо фортуны', price: 18900, sum: 18900 },
        { name: 'Баннер', price: 5000, sum: 5000 },
      ],
      { includeStage: false, restorationList }
    );
    expect(input.amount.amountMicros).toBe(5000 * 1_000_000);
  });
});
