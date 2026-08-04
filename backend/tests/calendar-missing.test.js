import { describe, it, expect } from 'vitest';
import {
  collectCalendarEventIds,
  collectCalendarBookingNumbers,
  findDealsMissingFromCalendar,
  findCancelledDealsBackInCalendar,
  CALENDAR_MISS_CANCEL_THRESHOLD,
  bumpCalendarMissStreak,
  resetCalendarMissStreak,
  collectDealsReadyToCancelFromCalendar,
} from '../src/services/calendar-missing.js';
import { bookingDealKey } from '../src/services/deal-keys.js';

function makeDb(deals) {
  const byId = new Map(deals.map((d) => [d.id, { calendar_miss_streak: 0, ...d }]));
  return {
    prepare(sql) {
      return {
        all(stageParam) {
          const rows = [...byId.values()];
          if (sql.includes('twenty_stage = ?') && !sql.includes('twenty_stage !=')) {
            return rows.filter((deal) => deal.twenty_id && deal.twenty_stage === stageParam);
          }
          return rows.filter(
            (deal) => deal.twenty_id && (deal.twenty_stage == null || deal.twenty_stage !== stageParam),
          );
        },
        get(dealId) {
          if (sql.includes('calendar_miss_streak') && sql.includes('WHERE id')) {
            const deal = byId.get(dealId);
            return deal ? { calendar_miss_streak: deal.calendar_miss_streak ?? 0 } : null;
          }
          return byId.get(dealId) || null;
        },
        run(...params) {
          if (sql.includes('calendar_miss_streak = 0')) {
            const deal = byId.get(params[0]);
            if (deal) deal.calendar_miss_streak = 0;
            return { changes: deal ? 1 : 0 };
          }
          if (sql.includes('calendar_miss_streak = calendar_miss_streak + 1')
            || sql.includes('COALESCE(calendar_miss_streak, 0) + 1')
            || sql.includes('calendar_miss_streak = ?')) {
            const dealId = params[params.length - 1];
            const deal = byId.get(dealId);
            if (!deal) return { changes: 0 };
            if (params.length === 2 && typeof params[0] === 'number') {
              deal.calendar_miss_streak = params[0];
            } else {
              deal.calendar_miss_streak = (deal.calendar_miss_streak ?? 0) + 1;
            }
            return { changes: 1 };
          }
          return { changes: 0 };
        },
      };
    },
    __get(id) {
      return byId.get(id);
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

  it('exports miss cancel threshold of 3', () => {
    expect(CALENDAR_MISS_CANCEL_THRESHOLD).toBe(3);
  });

  it('bumps and resets calendar_miss_streak', () => {
    const db = makeDb([
      {
        id: 1,
        crm_event_id: '99',
        deal_key: '99#cal',
        twenty_id: 'opp-1',
        start_date: '2026-06-12T10:00:00+03:00',
        twenty_stage: null,
        calendar_miss_streak: 0,
      },
    ]);
    expect(bumpCalendarMissStreak(db, 1)).toBe(1);
    expect(db.__get(1).calendar_miss_streak).toBe(1);
    expect(bumpCalendarMissStreak(db, 1)).toBe(2);
    resetCalendarMissStreak(db, 1);
    expect(db.__get(1).calendar_miss_streak).toBe(0);
  });

  it('collectDealsReadyToCancelFromCalendar requires 3 consecutive misses', () => {
    const db = makeDb([
      {
        id: 2,
        crm_event_id: '99',
        deal_key: '99#cal',
        twenty_id: 'opp-2',
        start_date: '2026-06-12T10:00:00+03:00',
        twenty_stage: null,
        calendar_miss_streak: 0,
      },
    ]);
    const calendarIds = new Set(['10']);
    const r1 = collectDealsReadyToCancelFromCalendar(db, calendarIds, startDate, endDate);
    expect(r1).toEqual([]);
    expect(db.__get(2).calendar_miss_streak).toBe(1);

    const r2 = collectDealsReadyToCancelFromCalendar(db, calendarIds, startDate, endDate);
    expect(r2).toEqual([]);
    expect(db.__get(2).calendar_miss_streak).toBe(2);

    const r3 = collectDealsReadyToCancelFromCalendar(db, calendarIds, startDate, endDate);
    expect(r3.map((d) => d.id)).toEqual([2]);
    expect(db.__get(2).calendar_miss_streak).toBe(3);
  });

  it('resets streak when deal reappears in calendar before threshold', () => {
    const db = makeDb([
      {
        id: 2,
        crm_event_id: '99',
        deal_key: '99#cal',
        twenty_id: 'opp-2',
        start_date: '2026-06-12T10:00:00+03:00',
        twenty_stage: null,
        calendar_miss_streak: 0,
      },
    ]);
    collectDealsReadyToCancelFromCalendar(db, new Set(['10']), startDate, endDate);
    collectDealsReadyToCancelFromCalendar(db, new Set(['10']), startDate, endDate);
    expect(db.__get(2).calendar_miss_streak).toBe(2);

    const ready = collectDealsReadyToCancelFromCalendar(db, new Set(['99']), startDate, endDate);
    expect(ready).toEqual([]);
    expect(db.__get(2).calendar_miss_streak).toBe(0);
  });

  it('does not cancel-ready already OTMENA deals', () => {
    const db = makeDb([
      {
        id: 4,
        crm_event_id: '77',
        deal_key: '77#cal',
        twenty_id: 'opp-4',
        start_date: '2026-06-08T10:00:00+03:00',
        twenty_stage: 'OTMENA',
        calendar_miss_streak: 10,
      },
    ]);
    const ready = collectDealsReadyToCancelFromCalendar(db, new Set(['10']), startDate, endDate);
    expect(ready).toEqual([]);
  });
});
