import { describe, it, expect, beforeEach } from 'vitest';
import {
  collectCalendarEventIds,
  findDealsMissingFromCalendar,
} from '../src/services/calendar-missing.js';

function makeDb(deals) {
  return {
    prepare() {
      return {
        all(cancelledStage) {
          return deals.filter(
            (deal) => deal.twenty_id && deal.twenty_stage !== cancelledStage
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

  it('finds synced deals missing from calendar in parse range', () => {
    const db = makeDb([
      {
        id: 1,
        crm_event_id: '10',
        twenty_id: 'opp-1',
        start_date: '2026-06-05T10:00:00+03:00',
        twenty_stage: null,
      },
      {
        id: 2,
        crm_event_id: '99',
        twenty_id: 'opp-2',
        start_date: '2026-06-12T10:00:00+03:00',
        twenty_stage: null,
      },
      {
        id: 3,
        crm_event_id: '88',
        twenty_id: 'opp-3',
        start_date: '2026-07-01T10:00:00+03:00',
        twenty_stage: null,
      },
      {
        id: 4,
        crm_event_id: '77',
        twenty_id: 'opp-4',
        start_date: '2026-06-08T10:00:00+03:00',
        twenty_stage: 'OTMENA',
      },
      {
        id: 5,
        crm_event_id: '55',
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
});
