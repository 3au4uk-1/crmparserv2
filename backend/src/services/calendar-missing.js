import { extractBookingNumbers } from './booking-numbers.js';
import { isEventInRange } from '../utils/crm-dates.js';
import { CANCELLED_OPPORTUNITY_STAGE } from './twenty-opportunity.js';
import { calDealKey, isBookingDealKey, resolveBookingNumber } from './deal-keys.js';

export function collectCalendarEventIds(events, startDate, endDate) {
  const ids = new Set();
  for (const event of events) {
    if (!isEventInRange(event, startDate, endDate)) continue;
    const eventId = String(event.original_id || event.id || '');
    if (eventId) ids.add(eventId);
  }
  return ids;
}

export function collectCalendarBookingNumbers(events, startDate, endDate) {
  const numbers = new Set();
  for (const event of events) {
    if (!isEventInRange(event, startDate, endDate)) continue;
    for (const n of extractBookingNumbers(event.title || '')) {
      numbers.add(n);
    }
  }
  return numbers;
}

function isDealStillInCalendar(deal, calendarEventIds, calendarBookingNumbers) {
  const booking = resolveBookingNumber(deal);
  if (booking && (isBookingDealKey(deal.deal_key) || calendarBookingNumbers.has(booking))) {
    return calendarBookingNumbers.has(booking);
  }
  if (deal.deal_key === calDealKey(deal.crm_event_id) || deal.deal_key?.endsWith('#cal')) {
    return calendarEventIds.has(deal.crm_event_id);
  }
  if (booking && calendarBookingNumbers.has(booking)) {
    return true;
  }
  return calendarEventIds.has(deal.crm_event_id);
}

export function findDealsMissingFromCalendar(
  db,
  calendarEventIds,
  startDate,
  endDate,
  calendarBookingNumbers = new Set(),
) {
  const deals = db.prepare(`
    SELECT * FROM deals
    WHERE twenty_id IS NOT NULL
      AND (twenty_stage IS NULL OR twenty_stage != ?)
  `).all(CANCELLED_OPPORTUNITY_STAGE);

  return deals.filter((deal) => {
    if (isDealStillInCalendar(deal, calendarEventIds, calendarBookingNumbers)) return false;
    return isEventInRange({ start: deal.start_date }, startDate, endDate);
  });
}

export function findCancelledDealsBackInCalendar(
  db,
  calendarEventIds,
  startDate,
  endDate,
  calendarBookingNumbers = new Set(),
) {
  const deals = db.prepare(`
    SELECT * FROM deals
    WHERE twenty_id IS NOT NULL
      AND twenty_stage = ?
  `).all(CANCELLED_OPPORTUNITY_STAGE);

  return deals.filter((deal) => {
    if (!isDealStillInCalendar(deal, calendarEventIds, calendarBookingNumbers)) return false;
    return isEventInRange({ start: deal.start_date }, startDate, endDate);
  });
}
