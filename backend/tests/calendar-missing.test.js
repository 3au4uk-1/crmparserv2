import { describe, it, expect } from 'vitest';
import {
  collectCalendarEventIds,
  collectCalendarBookingNumbers,
  findDealsMissingFromCalendar,
  findCancelledDealsBackInCalendar,
} from '../src/services/calendar-missing.js';
import { bookingDealKey } from '../src/services/deal-keys.js';

function makeDb(deals) {
  return {
    prepare(sql) {
      return {
        all(stageParam) {
          if (sql.includes('twenty_stage = ?') && !sql.includes('twenty_stage !=')) {
            return deals.filter(
              (deal) => deal.twenty_id && deal.twenty_stage === stageParam,
            );
          }
          return deals.filter(
            (deal) => deal.twenty_id && deal.twenty_stage !== stageParam,
          );
        },
      };
    },
  };
}

describe('calendar-missing', () => {
  const startDate = '2026-06-01T00:00:00+03:00';
  const endDate = '2026-06-30T23:59:59+03:00';

  it('collects in-range calendar event ids', () => {
    const events = [
      { id: '10', start: '2026-06-05T10:00:00+03:00' },
      { original_id: '20', start: '2026-06-15T10:00:00+03:00' },
      { id: '30', start: '2026-07-01T10:00:00+03:00' },
    ];

    const ids = collectCalendarEventIds(events, startDate, endDate);
    expect(ids).toEqual(new Set(['10', '20']));
  });

  it('collects booking numbers from in-range event titles', () => {
    const events = [
      { id: '10', title: 'АРТ // 173982 // ПРЕДОПЛАТА', start: '2026-06-05T10:00:00+03:00' },
      { id: '20', title: 'АРТ // 173982/Лоскутникова', start: '2026-06-15T10:00:00+03:00' },
      { id: '30', title: 'АРТ // 999999', start: '2026-07-01T10:00:00+03:00' },
    ];

    const numbers = collectCalendarBookingNumbers(events, startDate, endDate);
    expect(numbers).toEqual(new Set(['173982']));
  });

  it('finds synced deals missing from calendar in parse range', () => {
    const db = makeDb([
      {
        id: 1,
        crm_event_id: '10',
        deal_key: '10#cal',
        twenty_id: 'opp-1',
        start_date: '2026-06-05T10:00:00+03:00',
        twenty_stage: null,
      },
      {
        id: 2,
        crm_event_id: '99',
        deal_key: '99#cal',
        twenty_id: 'opp-2',
        start_date: '2026-06-12T10:00:00+03:00',
        twenty_stage: null,
      },
      {
        id: 3,
        crm_event_id: '88',
        deal_key: '88#cal',
        twenty_id: 'opp-3',
        start_date: '2026-07-01T10:00:00+03:00',
        twenty_stage: null,
      },
      {
        id: 4,
        crm_event_id: '77',
        deal_key: '77#cal',
        twenty_id: 'opp-4',
        start_date: '2026-06-08T10:00:00+03:00',
        twenty_stage: 'OTMENA',
      },
      {
        id: 5,
        crm_event_id: '55',
        deal_key: '55#cal',
        twenty_id: null,
        start_date: '2026-06-08T10:00:00+03:00',
        twenty_stage: null,
      },
    ]);

    const missing = findDealsMissingFromCalendar(
      db,
      new Set(['10']),
      startDate,
      endDate
    );

    expect(missing.map((deal) => deal.id)).toEqual([2]);
  });

  it('keeps a booking deal when its event id is gone but booking remains in another event title', () => {
    const db = makeDb([
      {
        id: 1,
        crm_event_id: '99',
        deal_key: bookingDealKey('173982'),
        tony_order_id: '173982',
        twenty_id: 'opp-1',
        start_date: '2026-06-05T10:00:00+03:00',
        twenty_stage: null,
      },
    ]);

    const missing = findDealsMissingFromCalendar(
      db,
      new Set(['10']),
      startDate,
      endDate,
      new Set(['173982']),
    );

    expect(missing).toEqual([]);
  });

  it('cancels a booking deal when its booking disappears from all event titles', () => {
    const db = makeDb([
      {
        id: 1,
        crm_event_id: '99',
        deal_key: bookingDealKey('173982'),
        tony_order_id: '173982',
        twenty_id: 'opp-1',
        start_date: '2026-06-05T10:00:00+03:00',
        twenty_stage: null,
      },
    ]);

    const missing = findDealsMissingFromCalendar(
      db,
      new Set(['10']),
      startDate,
      endDate,
      new Set(),
    );

    expect(missing.map((deal) => deal.id)).toEqual([1]);
  });

  it('finds cancelled deals that are back in the calendar', () => {
    const db = makeDb([
      {
        id: 1,
        crm_event_id: '10',
        deal_key: '10#cal',
        twenty_id: 'opp-1',
        start_date: '2026-06-05T10:00:00+03:00',
        twenty_stage: 'OTMENA',
      },
      {
        id: 2,
        crm_event_id: '99',
        deal_key: '99#cal',
        twenty_id: 'opp-2',
        start_date: '2026-06-12T10:00:00+03:00',
        twenty_stage: 'OTMENA',
      },
      {
        id: 3,
        crm_event_id: '88',
        deal_key: bookingDealKey('173982'),
        tony_order_id: '173982',
        twenty_id: 'opp-3',
        start_date: '2026-06-08T10:00:00+03:00',
        twenty_stage: 'OTMENA',
      },
      {
        id: 4,
        crm_event_id: '77',
        deal_key: '77#cal',
        twenty_id: 'opp-4',
        start_date: '2026-07-01T10:00:00+03:00',
        twenty_stage: 'OTMENA',
      },
    ]);

    const restored = findCancelledDealsBackInCalendar(
      db,
      new Set(['10']),
      startDate,
      endDate,
      new Set(['173982']),
    );

    expect(restored.map((deal) => deal.id).sort()).toEqual([1, 3]);
  });
});
