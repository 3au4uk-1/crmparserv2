import { describe, it, expect } from 'vitest';
import { buildOpportunityInput, DEFAULT_OPPORTUNITY_STAGE } from '../src/services/twenty-opportunity.js';

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
    expect(input.closeDate).toBe('2026-06-10');
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
});
