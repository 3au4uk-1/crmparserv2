import { isEventInRange } from '../utils/crm-dates.js';
import { CANCELLED_OPPORTUNITY_STAGE } from './twenty-opportunity.js';

export function collectCalendarEventIds(events, startDate, endDate) {
  const ids = new Set();
  for (const event of events) {
    if (!isEventInRange(event, startDate, endDate)) continue;
    const eventId = String(event.original_id || event.id || '');
    if (eventId) ids.add(eventId);
  }
  return ids;
}

export function findDealsMissingFromCalendar(db, calendarEventIds, startDate, endDate) {
  const deals = db.prepare(`
    SELECT * FROM deals
    WHERE twenty_id IS NOT NULL
      AND (twenty_stage IS NULL OR twenty_stage != ?)
  `).all(CANCELLED_OPPORTUNITY_STAGE);

  return deals.filter((deal) => {
    if (calendarEventIds.has(deal.crm_event_id)) return false;
    return isEventInRange({ start: deal.start_date }, startDate, endDate);
  });
}
